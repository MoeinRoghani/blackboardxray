"""Who is asking, and whether they may.

Two ways in, and they are not the same door.

**An application sends** with a key belonging to one project. It is a machine,
it holds a bearer token, and it may only write. That path is unchanged and is
in the ingest route.

**A person reads** with a session cookie. Everything that answers what a run
did now goes through here first: a session, a membership, a role, and a
permission. Reading used to be open to whoever could reach the port, which is
fine for a laptop and is not a thing to publish.

The cookie is `SameSite=Lax` and `HttpOnly`, and every unsafe method that
carries one also has its `Origin` checked. Lax alone stops a cross site form
post but says nothing about a same site subdomain, and the origin check costs a
header comparison. The check applies only to requests carrying a session,
because a cross site request cannot forge a bearer token and the ingesting
client sends no `Origin` at all.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from urllib.parse import urlsplit

from fastapi import Depends, HTTPException, Request, Response

from blackboardxray.server.db import Database
from blackboardxray.server.people import Access, Organization, Project, User
from blackboardxray.server.roles import Permission, Role, allows

#: The cookie a browser carries. Named for the platform so two of these behind
#: one hostname do not sign each other's people in.
SESSION_COOKIE = "bxr_session"

#: Methods that change something. A session carrying one of these has its
#: origin checked.
UNSAFE = frozenset({"POST", "PUT", "PATCH", "DELETE"})


@dataclass(frozen=True)
class Caller:
    """The person behind a request, and the session that says so."""

    user: User
    token: str


def fail(status: int, error: str, detail: str) -> HTTPException:
    """Every refusal answers the same shape: a stable name and a sentence."""
    return HTTPException(status_code=status, detail={"error": error, "detail": detail})


def set_session(response: Response, token: str, *, secure: bool, days: int) -> None:
    response.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=days * 24 * 60 * 60,
        httponly=True,
        samesite="lax",
        secure=secure,
        path="/",
    )


def clear_session(response: Response, *, secure: bool) -> None:
    response.delete_cookie(
        SESSION_COOKIE, httponly=True, samesite="lax", secure=secure, path="/"
    )


def is_secure(request: Request) -> bool:
    """Whether to mark the cookie `Secure`.

    Taken from the scheme the request arrived on, including what a proxy said
    it was, because a deployment behind TLS termination sees plain HTTP and
    would otherwise never set the flag.
    """
    forwarded = request.headers.get("x-forwarded-proto", "")
    if forwarded:
        return forwarded.split(",")[0].strip() == "https"
    return request.url.scheme == "https"


def same_origin(request: Request, allowed: tuple[str, ...]) -> bool:
    """Whether this request came from somewhere allowed to send it."""
    origin = request.headers.get("origin")
    if origin is None:
        # A referer is the fallback for the few clients that omit `Origin` on
        # same origin requests. Neither present means it is not a browser doing
        # a cross site request either, so it is allowed through to the session
        # check, which is what actually refuses a stranger.
        referer = request.headers.get("referer")
        if referer is None:
            return True
        origin = _origin_of(referer)
    if origin in allowed:
        return True
    return origin == _origin_of(str(request.url), forwarded=request)


def _origin_of(url: str, forwarded: Request | None = None) -> str:
    parts = urlsplit(url)
    scheme = parts.scheme
    host = parts.netloc
    if forwarded is not None:
        scheme = "https" if is_secure(forwarded) else scheme
        host = forwarded.headers.get("host", host)
    return f"{scheme}://{host}"


class Guard:
    """The dependencies every authenticated route reads.

    Built once against a database and a policy, so a route says what it needs
    rather than repeating how to find it.
    """

    def __init__(self, database: Database, allowed_origins: tuple[str, ...]) -> None:
        self._db = database
        self._origins = allowed_origins

    def caller(self, request: Request) -> Caller:
        """The person behind this request, or a 401."""
        token = request.cookies.get(SESSION_COOKIE, "")
        if not token:
            raise fail(401, "not_signed_in", "Sign in to read this.")
        if request.method in UNSAFE and not same_origin(request, self._origins):
            # A session was presented on a request that came from elsewhere.
            # Whatever it is, it is not this interface asking.
            raise fail(
                403,
                "wrong_origin",
                "This request did not come from this platform's own interface.",
            )
        user = self._db.people.read_session(token)
        if user is None:
            raise fail(401, "not_signed_in", "This session has ended. Sign in again.")
        return Caller(user=user, token=token)

    def optional_caller(self, request: Request) -> Caller | None:
        """The person behind this request, where there may not be one."""
        try:
            return self.caller(request)
        except HTTPException:
            return None

    def organization(
        self, org: str, caller: Caller, need: Permission | None = None
    ) -> tuple[Organization, Role]:
        """An organization this person belongs to, and what they are in it."""
        found = self._db.people.find_organization(org)
        role = (
            None
            if found is None
            else self._db.people.org_role(found.id, caller.user.id)
        )
        if found is None or role is None:
            # The same answer for an organization that does not exist and one
            # this person is not in. A different answer would let a stranger
            # confirm which organizations a deployment holds.
            raise fail(404, "unknown_organization", f"No organization {org!r}.")
        if need is not None and not allows(role, need):
            raise fail(403, "not_allowed", _refusal(role, need))
        return found, role

    def project(
        self, project: str, caller: Caller, need: Permission | None = None
    ) -> Access:
        """A project this person may read, and what they may do with it."""
        found = self._db.people.find_project(project)
        access = None if found is None else self._db.people.access(caller.user, found)
        if access is None:
            raise fail(404, "unknown_project", f"No project {project!r}.")
        if need is not None and not access.may(need):
            raise fail(403, "not_allowed", _refusal(access.role, need))
        return access


def _refusal(role: Role, need: Permission) -> str:
    return (
        f"You are {_article(role.value)} here, and {need.value} needs more than"
        " that. Ask an admin of this organization."
    )


def _article(role: str) -> str:
    return f"an {role}" if role[0] in "aeiou" else f"a {role}"


def needs(
    guard: Guard, permission: Permission
) -> Callable[[str, Caller], Access]:  # pragma: no cover - wired in app.py
    """A dependency that resolves a project and checks one permission."""

    def resolve(project: str, caller: Caller = Depends(guard.caller)) -> Access:
        return guard.project(project, caller, permission)

    return resolve


__all__ = [
    "SESSION_COOKIE",
    "Access",
    "Caller",
    "Guard",
    "Organization",
    "Project",
    "User",
    "clear_session",
    "fail",
    "is_secure",
    "needs",
    "same_origin",
    "set_session",
]
