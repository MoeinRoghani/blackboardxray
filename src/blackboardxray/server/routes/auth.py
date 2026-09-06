"""Getting in: the first account, every account after it, and the way out.

The shape of the first run is the whole reason this is not just a sign in page.
An install with nobody in it has exactly one thing it will do, which is make the
first person, give them an organization, a project and a key, and then never
offer that again. Anything else answered before that is a conflict.

After that, people arrive by invitation. A link an admin copies and sends
however they already talk to their colleagues, because an install that needs a
mail server before a second person can sign in is an install that does not get
a second person.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel, Field

from blackboardxray.server.db import Database
from blackboardxray.server.identity import SESSION_IDLE_DAYS, WeakPassword
from blackboardxray.server.people import AlreadyExists, Locked, PeopleError
from blackboardxray.server.roles import Role
from blackboardxray.server.security import (
    Caller,
    Guard,
    clear_session,
    fail,
    is_secure,
    same_origin,
    set_session,
)
from blackboardxray.server.settings import Settings


class SignIn(BaseModel):
    email: str = Field(max_length=320)
    password: str = Field(max_length=1024)


class Setup(BaseModel):
    """Everything the first run needs, in one request."""

    email: str = Field(max_length=320)
    password: str = Field(max_length=1024)
    name: str = Field(default="", max_length=200)
    organization: str = Field(default="", max_length=200)
    project: str = Field(default="", max_length=200)


class Join(BaseModel):
    token: str = Field(max_length=200)
    password: str = Field(max_length=1024)
    name: str = Field(default="", max_length=200)


class ChangePassword(BaseModel):
    current: str = Field(max_length=1024)
    replacement: str = Field(max_length=1024)


def slugify(text: str, fallback: str) -> str:
    """A name reduced to something that belongs in a URL."""
    kept = [c.lower() if c.isalnum() else "-" for c in text.strip()]
    slug = "".join(kept).strip("-")
    while "--" in slug:
        slug = slug.replace("--", "-")
    return slug[:60] or fallback


def router(store: Database, guard: Guard, settings: Settings) -> APIRouter:
    api = APIRouter(prefix="/api/v1", tags=["auth"])
    people = store.people

    def sign_in_response(response: Response, request: Request, token: str) -> None:
        set_session(response, token, secure=is_secure(request), days=SESSION_IDLE_DAYS)

    @api.get("/auth/state")
    def state(request: Request) -> dict[str, Any]:
        """What the interface needs before it knows which screen to draw."""
        caller = guard.optional_caller(request)
        return {
            "needs_setup": people.count_users() == 0,
            "allow_signup": settings.allow_signup,
            "user": _who(caller) if caller else None,
        }

    @api.post("/setup", status_code=201)
    def setup(body: Setup, request: Request, response: Response) -> dict[str, Any]:
        """Makes the first account, and everything it needs to be useful.

        Offered once. A second call is a conflict rather than a second owner,
        because this route is the one thing on an unconfigured install that
        answers without a session, and it must stop doing that the moment
        there is somebody who could have invited you instead.
        """
        if people.count_users() > 0:
            raise fail(
                409,
                "already_set_up",
                "This platform already has an account. Sign in, or ask"
                " somebody who is already here for an invitation.",
            )
        if not same_origin(request, settings.allowed_origins):
            raise fail(403, "wrong_origin", "This did not come from the interface.")
        try:
            user = people.create_user(body.email, body.password, body.name)
        except WeakPassword as weak:
            raise fail(422, "weak_password", str(weak)) from weak
        except PeopleError as refused:
            raise fail(422, "cannot_create", str(refused)) from refused

        org_name = body.organization.strip() or "Default"
        organization = people.create_organization(
            slugify(org_name, "default"), org_name, user.id
        )
        project_name = body.project.strip() or "Production"
        project = people.create_project(
            organization.id,
            slugify(project_name, "production"),
            project_name,
            user.id,
        )
        key = people.issue_key(project.id, "First key", user.id)
        signed = people.sign_in(
            body.email,
            body.password,
            user_agent=request.headers.get("user-agent", ""),
            address=_address(request),
        )
        assert signed is not None
        sign_in_response(response, request, signed.session.value)
        return {
            "user": _user(user),
            "organization": _org(organization),
            "project": _project(project, organization),
            # Shown once, on the screen that made it. The database holds a
            # digest and can never show it again.
            "api_key": key.value,
        }

    @api.post("/auth/signin")
    def signin(body: SignIn, request: Request, response: Response) -> dict[str, Any]:
        if not same_origin(request, settings.allowed_origins):
            raise fail(403, "wrong_origin", "This did not come from the interface.")
        try:
            signed = people.sign_in(
                body.email,
                body.password,
                user_agent=request.headers.get("user-agent", ""),
                address=_address(request),
            )
        except Locked as locked:
            raise fail(
                429,
                "too_many_attempts",
                "Too many attempts. Try again in a few minutes.",
            ) from locked
        if signed is None:
            # One answer for a wrong address and a wrong password. Two answers
            # is how a stranger learns which addresses have accounts here.
            raise fail(
                401, "wrong_credentials", "That email and password do not match."
            )
        sign_in_response(response, request, signed.session.value)
        return {"user": _user(signed.user)}

    @api.post("/auth/signout", status_code=204)
    def signout(request: Request, response: Response) -> Response:
        token = request.cookies.get("bxr_session", "")
        if token:
            people.end_session(token)
        clear_session(response, secure=is_secure(request))
        return Response(status_code=204)

    @api.get("/auth/invite/{token}")
    def invite(token: str) -> dict[str, Any]:
        """What this link offers, so the join screen can name it."""
        offered = people.read_invite(token)
        if offered is None:
            raise fail(
                404,
                "unknown_invite",
                "This invitation has been used, withdrawn, or has expired."
                " Ask whoever sent it for another.",
            )
        return {
            "email": offered["email"],
            "role": offered["role"],
            "organization": offered["org_name"],
            # Whether the address already has an account decides whether the
            # screen asks for a password or asks them to sign in.
            "has_account": people.count_users() > 0
            and _has_account(store, offered["email"]),
        }

    @api.post("/auth/join")
    def join(body: Join, request: Request, response: Response) -> dict[str, Any]:
        """Accepts an invitation, making the account if there is not one."""
        if not same_origin(request, settings.allowed_origins):
            raise fail(403, "wrong_origin", "This did not come from the interface.")
        offered = people.read_invite(body.token)
        if offered is None:
            raise fail(404, "unknown_invite", "This invitation cannot be accepted.")

        existing = _find_by_email(store, offered["email"])
        if existing is None:
            try:
                user = people.create_user(offered["email"], body.password, body.name)
            except WeakPassword as weak:
                raise fail(422, "weak_password", str(weak)) from weak
            except AlreadyExists as taken:  # pragma: no cover - checked above
                raise fail(409, "already_exists", str(taken)) from taken
            password = body.password
        else:
            # The address already has an account. The password given must be
            # its own, so an invitation to a colleague's address cannot be used
            # by whoever intercepted the link to get into their account.
            user = existing
            password = body.password

        signed = people.sign_in(
            offered["email"],
            password,
            user_agent=request.headers.get("user-agent", ""),
            address=_address(request),
        )
        if signed is None:
            raise fail(
                401,
                "wrong_credentials",
                "This address already has an account here. Enter its password"
                " to accept the invitation.",
            )
        organization = people.accept_invite(body.token, user.id)
        if organization is None:  # pragma: no cover - read above in the same second
            raise fail(404, "unknown_invite", "This invitation cannot be accepted.")
        sign_in_response(response, request, signed.session.value)
        return {"user": _user(signed.user), "organization": _org(organization)}

    # The account

    @api.get("/me")
    def me(caller: Caller = Depends(guard.caller)) -> dict[str, Any]:
        """Who this is, what they belong to, and what they may read."""
        return {
            "user": _user(caller.user),
            "organizations": people.organizations_for(caller.user.id),
            "projects": people.projects_for(caller.user.id),
        }

    @api.get("/me/sessions")
    def sessions(caller: Caller = Depends(guard.caller)) -> dict[str, Any]:
        return {"sessions": people.list_sessions(caller.user.id, caller.token)}

    @api.delete("/me/sessions")
    def end_others(caller: Caller = Depends(guard.caller)) -> dict[str, Any]:
        """Ends every session but this one."""
        return {"ended": people.end_other_sessions(caller.user.id, caller.token)}

    @api.post("/me/password", status_code=204)
    def change_password(
        body: ChangePassword,
        request: Request,
        response: Response,
        caller: Caller = Depends(guard.caller),
    ) -> Response:
        # The current password is required even though there is a session,
        # because a session is what somebody borrowing an unlocked laptop has.
        if people.sign_in(caller.user.email, body.current) is None:
            raise fail(403, "wrong_credentials", "That is not your current password.")
        try:
            people.set_password(caller.user.id, body.replacement)
        except WeakPassword as weak:
            raise fail(422, "weak_password", str(weak)) from weak
        # Every session went, including this one. Signing back in is the honest
        # consequence of having said every session should end.
        signed = people.sign_in(caller.user.email, body.replacement)
        assert signed is not None
        ended = Response(status_code=204)
        set_session(
            ended,
            signed.session.value,
            secure=is_secure(request),
            days=SESSION_IDLE_DAYS,
        )
        return ended

    return api


def _has_account(store: Database, email: str) -> bool:
    return _find_by_email(store, email) is not None


def _find_by_email(store: Database, email: str) -> Any:
    rows = store.rows(
        "SELECT id, public_id, email, name FROM xray_users"
        " WHERE email_folded = lower(%s)",
        (email,),
    )
    if not rows:
        return None
    from blackboardxray.server.people import User

    return User(
        id=int(rows[0]["id"]),
        public_id=rows[0]["public_id"],
        email=rows[0]["email"],
        name=rows[0]["name"],
    )


def _address(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for", "")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else ""


def _who(caller: Caller) -> dict[str, Any]:
    return _user(caller.user)


def _user(user: Any) -> dict[str, Any]:
    return {"id": user.public_id, "email": user.email, "name": user.name}


def _org(organization: Any) -> dict[str, Any]:
    return {
        "id": organization.public_id,
        "slug": organization.slug,
        "name": organization.name,
        "role": Role.OWNER.value,
    }


def _project(project: Any, organization: Any) -> dict[str, Any]:
    return {
        "id": project.public_id,
        "slug": project.slug,
        "name": project.name,
        "org_id": organization.public_id,
    }
