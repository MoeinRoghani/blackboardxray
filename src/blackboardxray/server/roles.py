"""Who may do what.

Five roles and one rule: a role on a project replaces the role from the
organization, in either direction. It raises a member to admin on the project
they run, and it is how somebody whose organization role is `none` is given
exactly one project and nothing else.

The permissions are a table rather than a chain of conditionals, because the
question an operator asks is "what can a viewer do", and a table answers it by
being read. A conditional has to be traced.

Nothing here touches the database or the request. It is the model, so every
role against every permission is a test that runs in no time and cannot be
wrong about the deployment it happens to run in.
"""

from __future__ import annotations

from enum import StrEnum


class Role(StrEnum):
    """What somebody is, in an organization or on one project."""

    OWNER = "owner"
    ADMIN = "admin"
    MEMBER = "member"
    VIEWER = "viewer"
    #: No access by way of the organization. Only meaningful as an
    #: organization role, and only useful beside a project role.
    NONE = "none"


class Permission(StrEnum):
    """One thing somebody may be allowed to do."""

    # Reading
    READ_PROJECT = "project:read"
    #: The contents of a contribution, where the application chose to send it.
    READ_CONTENT = "content:read"

    # A project
    MANAGE_PROJECT = "project:manage"
    DELETE_PROJECT = "project:delete"
    MANAGE_KEYS = "keys:manage"

    # An organization
    CREATE_PROJECT = "org:create-project"
    MANAGE_MEMBERS = "org:manage-members"
    MANAGE_ORG = "org:manage"
    DELETE_ORG = "org:delete"
    #: Change somebody's role to or from owner, or remove an owner.
    MANAGE_OWNERS = "org:manage-owners"


#: Every role, and everything it may do. A role absent from a row may not do
#: that thing; there is no inheritance and no fallthrough, so reading one row
#: is the whole answer for that role.
GRANTS: dict[Role, frozenset[Permission]] = {
    Role.OWNER: frozenset(Permission),
    Role.ADMIN: frozenset(
        {
            Permission.READ_PROJECT,
            Permission.READ_CONTENT,
            Permission.MANAGE_PROJECT,
            Permission.DELETE_PROJECT,
            Permission.MANAGE_KEYS,
            Permission.CREATE_PROJECT,
            Permission.MANAGE_MEMBERS,
            Permission.MANAGE_ORG,
        }
    ),
    Role.MEMBER: frozenset({Permission.READ_PROJECT, Permission.READ_CONTENT}),
    # A viewer reads what happened and not what was written. A contribution is
    # the application's own data and may be anything it is allowed to hold, so
    # the lowest role that can be handed out reads the shape of a run without
    # reading its contents.
    Role.VIEWER: frozenset({Permission.READ_PROJECT}),
    Role.NONE: frozenset(),
}

#: How the roles rank, for the one comparison that is not a permission: an
#: admin may not change an owner, and nobody may raise somebody above
#: themselves.
RANK: dict[Role, int] = {
    Role.NONE: 0,
    Role.VIEWER: 1,
    Role.MEMBER: 2,
    Role.ADMIN: 3,
    Role.OWNER: 4,
}


def read(given: str | None) -> Role | None:
    """Reads a role from what the database or a request said."""
    if given is None:
        return None
    try:
        return Role(given.strip().lower())
    except ValueError:
        return None


def effective(org_role: Role | None, project_role: Role | None) -> Role:
    """The role that applies, given what the organization and project each say.

    A project role replaces the organization role rather than adding to it.
    Taking the greater of the two would make it impossible to give somebody
    less on one project than they have everywhere else, which is the case the
    override mostly exists for.
    """
    if project_role is not None:
        return project_role
    return org_role if org_role is not None else Role.NONE


def allows(role: Role, permission: Permission) -> bool:
    """Whether this role may do this."""
    return permission in GRANTS[role]


def outranks(actor: Role, subject: Role) -> bool:
    """Whether the actor may act on somebody who is currently the subject role.

    Strict, so an admin cannot remove another admin and an owner is the only
    role that can act on an owner. Equal ranks acting on each other is how an
    organization loses both its administrators in one afternoon.
    """
    return RANK[actor] > RANK[subject]


def may_grant(actor: Role, role: Role) -> bool:
    """Whether the actor may give somebody this role.

    Nobody grants a role at or above their own. An admin who could make
    somebody an owner could make themselves one the next minute.
    """
    if role is Role.OWNER:
        return actor is Role.OWNER
    return RANK[actor] > RANK[role]
