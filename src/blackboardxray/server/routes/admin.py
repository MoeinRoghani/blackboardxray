"""Running the place: organizations, projects, keys, members and invitations.

Everything a person used to do by shelling into the container. Each route names
the permission it needs and the guard answers whether this caller has it, so
what an admin may do is readable from the route rather than assembled from
conditionals inside it.

Two rules are enforced here rather than in the role table, because both are
about a pair of people rather than about one role. Nobody grants a role at or
above their own, and nobody acts on somebody who outranks them. Without the
first, an admin makes themselves an owner in two steps.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field

from blackboardxray.server.db import Database
from blackboardxray.server.people import AlreadyExists, NotAllowed, PeopleError
from blackboardxray.server.roles import Permission, Role, may_grant, outranks
from blackboardxray.server.roles import read as read_role
from blackboardxray.server.security import Caller, Guard, fail


class NewOrganization(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    slug: str = Field(default="", max_length=60)


class Renaming(BaseModel):
    name: str = Field(min_length=1, max_length=200)


class NewProject(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    slug: str = Field(default="", max_length=60)


class ProjectSettings(BaseModel):
    name: str | None = Field(default=None, max_length=200)
    #: Null means keep forever, which is what a project has until somebody
    #: decides otherwise.
    retention_days: int | None = Field(default=None, ge=1, le=3650)


class NewKey(BaseModel):
    name: str = Field(default="", max_length=120)


class NewInvite(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    role: str = Field(default=Role.MEMBER.value, max_length=20)


class MemberRole(BaseModel):
    role: str = Field(max_length=20)


def _address(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for", "")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else ""


def router(store: Database, guard: Guard) -> APIRouter:
    api = APIRouter(prefix="/api/v1", tags=["admin"])
    people = store.people

    # Organizations

    @api.get("/orgs")
    def organizations(caller: Caller = Depends(guard.caller)) -> dict[str, Any]:
        return {"organizations": people.organizations_for(caller.user.id)}

    @api.post("/orgs", status_code=201)
    def create_organization(
        body: NewOrganization, caller: Caller = Depends(guard.caller)
    ) -> dict[str, Any]:
        # Anybody signed in may make one, and owns what they made. Gating this
        # on a permission would need a role above owner, which is a role that
        # exists only to be the person who forgot to hand it over.
        slug = _slug(body.slug or body.name)
        try:
            made = people.create_organization(slug, body.name, caller.user.id)
        except AlreadyExists as taken:
            raise fail(409, "already_exists", str(taken)) from taken
        return {"id": made.public_id, "slug": made.slug, "name": made.name}

    @api.patch("/orgs/{org}")
    def rename_organization(
        org: str, body: Renaming, caller: Caller = Depends(guard.caller)
    ) -> dict[str, Any]:
        found, _ = guard.organization(org, caller, Permission.MANAGE_ORG)
        people.rename_organization(found.id, body.name)
        return {"id": found.public_id, "slug": found.slug, "name": body.name}

    @api.delete("/orgs/{org}", status_code=204)
    def delete_organization(org: str, caller: Caller = Depends(guard.caller)) -> None:
        found, _ = guard.organization(org, caller, Permission.DELETE_ORG)
        people.delete_organization(found.id)

    # Projects

    @api.get("/orgs/{org}/projects")
    def projects(org: str, caller: Caller = Depends(guard.caller)) -> dict[str, Any]:
        found, _ = guard.organization(org, caller)
        return {"projects": people.projects_for(caller.user.id, found.id)}

    @api.post("/orgs/{org}/projects", status_code=201)
    def create_project(
        org: str, body: NewProject, caller: Caller = Depends(guard.caller)
    ) -> dict[str, Any]:
        found, _ = guard.organization(org, caller, Permission.CREATE_PROJECT)
        try:
            made = people.create_project(
                found.id, _slug(body.slug or body.name), body.name, caller.user.id
            )
        except AlreadyExists as taken:
            raise fail(409, "already_exists", str(taken)) from taken
        return {
            "id": made.public_id,
            "slug": made.slug,
            "name": made.name,
            "org_id": found.public_id,
        }

    @api.patch("/projects/{project}")
    def configure_project(
        project: str, body: ProjectSettings, caller: Caller = Depends(guard.caller)
    ) -> dict[str, Any]:
        access = guard.project(project, caller, Permission.MANAGE_PROJECT)
        if body.name is not None:
            people.rename_project(access.project.id, body.name)
        # A retention of null is a deliberate "keep forever" and is written as
        # such, so it can be turned back off after being turned on.
        people.set_retention(access.project.id, body.retention_days)
        return {
            "id": access.project.public_id,
            "name": body.name or access.project.name,
            "retention_days": body.retention_days,
        }

    @api.delete("/projects/{project}", status_code=204)
    def delete_project(
        request: Request, project: str, caller: Caller = Depends(guard.caller)
    ) -> None:
        access = guard.project(project, caller, Permission.DELETE_PROJECT)
        # Recorded before the delete, because the project's own rows go with it
        # and a line pointing at nothing is still a line saying who did it.
        people.record(
            "project.deleted",
            actor=caller.user,
            org_id=access.organization.id,
            target=access.project.name,
            address=_address(request),
        )
        people.delete_project(access.project.id)

    # Keys

    @api.get("/projects/{project}/keys")
    def keys(project: str, caller: Caller = Depends(guard.caller)) -> dict[str, Any]:
        access = guard.project(project, caller, Permission.MANAGE_KEYS)
        return {"keys": people.list_keys(access.project.id)}

    @api.post("/projects/{project}/keys", status_code=201)
    def create_key(
        request: Request,
        project: str,
        body: NewKey,
        caller: Caller = Depends(guard.caller),
    ) -> dict[str, Any]:
        access = guard.project(project, caller, Permission.MANAGE_KEYS)
        made = people.issue_key(access.project.id, body.name, caller.user.id)
        people.record(
            "key.created",
            actor=caller.user,
            org_id=access.organization.id,
            project_id=access.project.id,
            target=body.name or made.value[:12],
            address=_address(request),
        )
        # The one moment this value exists outside the sender's memory.
        return {"token": made.value, "name": body.name}

    @api.delete("/projects/{project}/keys/{key}", status_code=204)
    def revoke_key(
        request: Request, project: str, key: str, caller: Caller = Depends(guard.caller)
    ) -> None:
        access = guard.project(project, caller, Permission.MANAGE_KEYS)
        if not people.revoke_key(access.project.id, key):
            raise fail(404, "unknown_key", "No such key, or it is already revoked.")
        people.record(
            "key.revoked",
            actor=caller.user,
            org_id=access.organization.id,
            project_id=access.project.id,
            target=key,
            address=_address(request),
        )

    # Members

    @api.get("/orgs/{org}/members")
    def members(org: str, caller: Caller = Depends(guard.caller)) -> dict[str, Any]:
        found, _ = guard.organization(org, caller)
        return {"members": people.list_members(found.id)}

    @api.patch("/orgs/{org}/members/{member}")
    def set_role(
        request: Request,
        org: str,
        member: str,
        body: MemberRole,
        caller: Caller = Depends(guard.caller),
    ) -> dict[str, Any]:
        found, mine = guard.organization(org, caller, Permission.MANAGE_MEMBERS)
        wanted = read_role(body.role)
        if wanted is None:
            raise fail(422, "unknown_role", f"{body.role!r} is not a role.")
        subject = people.find_user(member)
        if subject is None:
            raise fail(404, "unknown_member", "No such person in this organization.")
        theirs = people.org_role(found.id, subject.id)
        if theirs is None:
            raise fail(404, "unknown_member", "No such person in this organization.")
        if not may_grant(mine, wanted):
            raise fail(
                403,
                "not_allowed",
                f"You are {mine.value} here and cannot make somebody {wanted.value}.",
            )
        if not outranks(mine, theirs) and subject.id != caller.user.id:
            raise fail(
                403,
                "not_allowed",
                f"{subject.email} is {theirs.value} here, which you do not outrank.",
            )
        people.set_member_role(found.id, subject.id, wanted)
        people.record(
            "member.role_changed",
            actor=caller.user,
            org_id=found.id,
            target=subject.email,
            detail={"from": theirs.value, "to": wanted.value},
            address=_address(request),
        )
        return {"id": subject.public_id, "role": wanted.value}

    @api.delete("/orgs/{org}/members/{member}", status_code=204)
    def remove_member(
        request: Request, org: str, member: str, caller: Caller = Depends(guard.caller)
    ) -> None:
        found, mine = guard.organization(org, caller)
        subject = people.find_user(member)
        if subject is None:
            raise fail(404, "unknown_member", "No such person in this organization.")
        theirs = people.org_role(found.id, subject.id)
        if theirs is None:
            raise fail(404, "unknown_member", "No such person in this organization.")
        # Leaving is not an act of administration, so it is not gated on the
        # permission to manage members. Removing somebody else is both.
        if subject.id != caller.user.id:
            guard.organization(org, caller, Permission.MANAGE_MEMBERS)
        if subject.id != caller.user.id and not outranks(mine, theirs):
            raise fail(
                403,
                "not_allowed",
                f"{subject.email} is {theirs.value} here, which you do not outrank.",
            )
        try:
            people.remove_member(found.id, subject.id)
        except NotAllowed as refused:
            raise fail(409, "last_owner", str(refused)) from refused
        people.record(
            "member.left" if subject.id == caller.user.id else "member.removed",
            actor=caller.user,
            org_id=found.id,
            target=subject.email,
            detail={"was": theirs.value},
            address=_address(request),
        )

    # Invitations

    @api.get("/orgs/{org}/invites")
    def invites(org: str, caller: Caller = Depends(guard.caller)) -> dict[str, Any]:
        found, _ = guard.organization(org, caller, Permission.MANAGE_MEMBERS)
        return {"invites": people.list_invites(found.id)}

    @api.post("/orgs/{org}/invites", status_code=201)
    def create_invite(
        request: Request,
        org: str,
        body: NewInvite,
        caller: Caller = Depends(guard.caller),
    ) -> dict[str, Any]:
        found, mine = guard.organization(org, caller, Permission.MANAGE_MEMBERS)
        wanted = read_role(body.role)
        if wanted is None:
            raise fail(422, "unknown_role", f"{body.role!r} is not a role.")
        if not may_grant(mine, wanted):
            raise fail(
                403,
                "not_allowed",
                f"You are {mine.value} here and cannot invite somebody as"
                f" {wanted.value}.",
            )
        try:
            made = people.create_invite(found.id, body.email, wanted, caller.user.id)
        except PeopleError as refused:
            raise fail(422, "cannot_invite", str(refused)) from refused
        people.record(
            "invite.created",
            actor=caller.user,
            org_id=found.id,
            target=body.email,
            detail={"role": wanted.value},
            address=_address(request),
        )
        # The token, once. The interface turns it into a link to copy and the
        # database keeps only a digest of it.
        return {"token": made.value, "email": body.email, "role": wanted.value}

    @api.delete("/orgs/{org}/invites/{invite}", status_code=204)
    def revoke_invite(
        org: str, invite: str, caller: Caller = Depends(guard.caller)
    ) -> None:
        found, _ = guard.organization(org, caller, Permission.MANAGE_MEMBERS)
        if not people.revoke_invite(found.id, invite):
            raise fail(404, "unknown_invite", "No such invitation.")

    @api.get("/orgs/{org}/audit")
    def audit(org: str, caller: Caller = Depends(guard.caller)) -> dict[str, Any]:
        """What has been changed here, and by whom."""
        found, _ = guard.organization(org, caller, Permission.MANAGE_MEMBERS)
        return {"entries": people.audit(found.id)}

    # A role on one project

    @api.put("/projects/{project}/members/{member}")
    def set_project_role(
        project: str,
        member: str,
        body: MemberRole,
        caller: Caller = Depends(guard.caller),
    ) -> dict[str, Any]:
        access = guard.project(project, caller, Permission.MANAGE_PROJECT)
        subject = people.find_user(member)
        if subject is None:
            raise fail(404, "unknown_member", "No such person.")
        wanted = None if body.role == "" else read_role(body.role)
        if body.role != "" and wanted is None:
            raise fail(422, "unknown_role", f"{body.role!r} is not a role.")
        if wanted is not None and not may_grant(access.role, wanted):
            raise fail(
                403,
                "not_allowed",
                f"You are {access.role.value} here and cannot grant {wanted.value}.",
            )
        people.set_project_role(access.project.id, subject.id, wanted)
        return {"id": subject.public_id, "role": body.role}

    return api


def _slug(text: str) -> str:
    kept = [c.lower() if c.isalnum() else "-" for c in text.strip()]
    slug = "".join(kept).strip("-")
    while "--" in slug:
        slug = slug.replace("--", "-")
    if not slug:
        raise fail(422, "bad_name", "A name needs a letter or a number in it.")
    return slug[:60]
