"""Everyone who uses the platform, and everything they own.

Split from `db.py` because the two answer different questions. That file is
about what a run did; this one is about who may read it. They share one pool,
because they are one database and a second would be a second thing to back up.

Every credential leaves this module exactly once, at the moment it is made.
After that the database holds a digest, so a leaked backup yields no session,
no key and no invite anybody can use.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING, Any

from blackboardxray.server.identity import (
    INVITE_DAYS,
    SESSION_IDLE_DAYS,
    Secret,
    digest,
    hash_password,
    issue,
    needs_rehash,
    public_id,
    verify_password,
)
from blackboardxray.server.roles import Permission, Role, allows, effective, read

if TYPE_CHECKING:  # pragma: no cover
    from blackboardxray.server.db import Database

#: What a token looks like. The prefix is shown in the interface; the rest is
#: shown once and never again.
KEY_PREFIX = "bxr_"

#: How many characters of a key are stored in the clear, so a person can tell
#: which of their keys a row is about without the platform being able to
#: reconstruct it.
PREFIX_SHOWN = 12

#: How many failed sign ins before an account stops answering, and for how
#: long. Held in the database rather than in memory, because a counter that
#: resets when the process does is a counter an attacker restarts for free.
LOCKOUT_AFTER = 10
LOCKOUT_MINUTES = 15

#: How stale a session's last seen may get before the platform writes it down.
#: Updating on every request would turn a read only page into a write.
SESSION_TOUCH_MINUTES = 30

#: A hash of nothing in particular, verified against when an address matches no
#: account, so that answering "no such person" costs the same as answering
#: "wrong password". Without it the difference in timing says which addresses
#: have accounts.
_ABSENT = hash_password("this password belongs to nobody at all")


class PeopleError(Exception):
    """Something about a person or what they own could not be done."""


class AlreadyExists(PeopleError):
    """An address, a slug or a name is taken."""


class NotAllowed(PeopleError):
    """The action is understood and refused."""


@dataclass(frozen=True)
class User:
    id: int
    public_id: str
    email: str
    name: str


@dataclass(frozen=True)
class Organization:
    id: int
    public_id: str
    slug: str
    name: str


@dataclass(frozen=True)
class Project:
    id: int
    public_id: str
    org_id: int
    slug: str
    name: str


@dataclass(frozen=True)
class Access:
    """A person, a project, and what they may do with it."""

    user: User
    project: Project
    organization: Organization
    role: Role

    def may(self, permission: Permission) -> bool:
        return allows(self.role, permission)


@dataclass(frozen=True)
class SignedIn:
    """The result of a successful sign in."""

    user: User
    session: Secret


class Locked(PeopleError):
    """The account is not answering, and when it will."""

    def __init__(self, until: datetime) -> None:
        super().__init__("too many attempts")
        self.until = until


def _now() -> datetime:
    return datetime.now(UTC)


class People:
    """Users, sessions, organizations, memberships, projects, keys, invites."""

    def __init__(self, database: Database) -> None:
        self._db = database

    # Users

    def count_users(self) -> int:
        """How many accounts exist. Zero means the install has not been set up."""
        rows = self._db.rows("SELECT count(*)::int AS n FROM xray_users")
        return int(rows[0]["n"]) if rows else 0

    def create_user(self, email: str, password: str, name: str = "") -> User:
        """Makes an account. Raises `AlreadyExists` if the address is taken."""
        email = email.strip()
        if "@" not in email or email.startswith("@") or email.endswith("@"):
            raise PeopleError(f"{email!r} is not an address this can send to")
        stored = hash_password(password)
        with self._db.connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    "SELECT 1 FROM xray_users WHERE email_folded = lower(%s)", (email,)
                )
                if cursor.fetchone() is not None:
                    raise AlreadyExists(f"{email} already has an account")
                cursor.execute(
                    "INSERT INTO xray_users (public_id, email, name, password_hash)"
                    " VALUES (%s, %s, %s, %s)"
                    " RETURNING id, public_id, email, name",
                    (public_id("usr"), email, name.strip(), stored),
                )
                row = cursor.fetchone()
            connection.commit()
        assert row is not None
        return _user(row)

    def find_user(self, public: str) -> User | None:
        rows = self._db.rows(
            "SELECT id, public_id, email, name FROM xray_users WHERE public_id = %s",
            (public,),
        )
        return _user(rows[0]) if rows else None

    def set_password(self, user_id: int, password: str) -> None:
        """Replaces a password and ends every session but leaves none behind.

        Every session goes, because the reason somebody changes a password is
        usually that they think somebody else has it.
        """
        stored = hash_password(password)
        with self._db.connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    "UPDATE xray_users SET password_hash = %s,"
                    " failed_logins = 0, locked_until = NULL WHERE id = %s",
                    (stored, user_id),
                )
                cursor.execute(
                    "DELETE FROM xray_sessions WHERE user_id = %s", (user_id,)
                )
            connection.commit()

    # Signing in

    def sign_in(
        self,
        email: str,
        password: str,
        *,
        user_agent: str = "",
        address: str = "",
    ) -> SignedIn | None:
        """Answers a session, or None when the credentials are wrong.

        None rather than a reason, because the caller must not be able to tell
        a wrong address from a wrong password: that difference is how a stranger
        learns which addresses have accounts here.
        """
        with self._db.connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    "SELECT id, public_id, email, name, password_hash,"
                    " failed_logins, locked_until, disabled_at"
                    " FROM xray_users WHERE email_folded = lower(%s)",
                    (email.strip(),),
                )
                row = cursor.fetchone()

                if row is None:
                    # Verified against a hash of nothing, so that no account and
                    # a wrong password take the same time to answer.
                    verify_password(password, _ABSENT)
                    connection.commit()
                    return None

                locked = row["locked_until"]
                if locked is not None and locked > _now():
                    connection.commit()
                    raise Locked(locked)

                if row["disabled_at"] is not None:
                    verify_password(password, _ABSENT)
                    connection.commit()
                    return None

                if not verify_password(password, row["password_hash"]):
                    failures = int(row["failed_logins"]) + 1
                    until = (
                        _now() + timedelta(minutes=LOCKOUT_MINUTES)
                        if failures >= LOCKOUT_AFTER
                        else None
                    )
                    cursor.execute(
                        "UPDATE xray_users SET failed_logins = %s, locked_until = %s"
                        " WHERE id = %s",
                        (0 if until else failures, until, row["id"]),
                    )
                    connection.commit()
                    return None

                # The one moment the password is in hand and can be hashed
                # again, which is what makes raising the cost possible at all.
                if needs_rehash(row["password_hash"]):
                    cursor.execute(
                        "UPDATE xray_users SET password_hash = %s WHERE id = %s",
                        (hash_password(password), row["id"]),
                    )

                token = issue("bxs_")
                cursor.execute(
                    "UPDATE xray_users SET failed_logins = 0, locked_until = NULL,"
                    " last_seen_at = now() WHERE id = %s",
                    (row["id"],),
                )
                cursor.execute(
                    "INSERT INTO xray_sessions"
                    " (token_hash, user_id, expires_at, user_agent, address)"
                    " VALUES (%s, %s, %s, %s, %s)",
                    (
                        token.digest,
                        row["id"],
                        _now() + timedelta(days=SESSION_IDLE_DAYS),
                        user_agent[:400],
                        address[:100],
                    ),
                )
            connection.commit()
        return SignedIn(user=_user(row), session=token)

    def read_session(self, token: str) -> User | None:
        """The person this token signs in, sliding its expiry as it goes."""
        if not token:
            return None
        with self._db.connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    "SELECT s.id, s.last_seen_at, u.id AS user_id, u.public_id,"
                    " u.email, u.name"
                    " FROM xray_sessions s JOIN xray_users u ON u.id = s.user_id"
                    " WHERE s.token_hash = %s AND s.expires_at > now()"
                    "   AND u.disabled_at IS NULL",
                    (digest(token),),
                )
                row = cursor.fetchone()
                if row is None:
                    connection.commit()
                    return None
                stale = _now() - row["last_seen_at"] > timedelta(
                    minutes=SESSION_TOUCH_MINUTES
                )
                if stale:
                    # Only now and then. Writing on every request would make
                    # every read of a dashboard a write to this table.
                    cursor.execute(
                        "UPDATE xray_sessions SET last_seen_at = now(),"
                        " expires_at = now() + %s WHERE id = %s",
                        (timedelta(days=SESSION_IDLE_DAYS), row["id"]),
                    )
            connection.commit()
        return User(
            id=int(row["user_id"]),
            public_id=row["public_id"],
            email=row["email"],
            name=row["name"],
        )

    def end_session(self, token: str) -> None:
        self._db.run(
            "DELETE FROM xray_sessions WHERE token_hash = %s", (digest(token),)
        )

    def end_other_sessions(self, user_id: int, keep: str) -> int:
        return self._db.run(
            "DELETE FROM xray_sessions WHERE user_id = %s AND token_hash <> %s",
            (user_id, digest(keep)),
        )

    def list_sessions(self, user_id: int, current: str) -> list[dict[str, Any]]:
        rows = self._db.rows(
            "SELECT id, created_at, last_seen_at, expires_at, user_agent, address,"
            " token_hash = %s AS is_current"
            " FROM xray_sessions WHERE user_id = %s AND expires_at > now()"
            " ORDER BY last_seen_at DESC",
            (digest(current), user_id),
        )
        for row in rows:
            row.pop("token_hash", None)
        return rows

    def sweep_sessions(self) -> int:
        """Removes what has expired. Nothing depends on when this runs."""
        return self._db.run("DELETE FROM xray_sessions WHERE expires_at < now()")

    # Organizations and membership

    def create_organization(self, slug: str, name: str, owner: int) -> Organization:
        with self._db.connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    "SELECT 1 FROM xray_organizations WHERE slug = %s", (slug,)
                )
                if cursor.fetchone() is not None:
                    raise AlreadyExists(f"an organization is already called {slug!r}")
                cursor.execute(
                    "INSERT INTO xray_organizations (public_id, slug, name)"
                    " VALUES (%s, %s, %s) RETURNING id, public_id, slug, name",
                    (public_id("org"), slug, name or slug),
                )
                row = cursor.fetchone()
                assert row is not None
                cursor.execute(
                    "INSERT INTO xray_memberships (org_id, user_id, role)"
                    " VALUES (%s, %s, %s)",
                    (row["id"], owner, Role.OWNER.value),
                )
            connection.commit()
        return Organization(
            id=int(row["id"]),
            public_id=row["public_id"],
            slug=row["slug"],
            name=row["name"],
        )

    def find_organization(self, public: str) -> Organization | None:
        rows = self._db.rows(
            "SELECT id, public_id, slug, name FROM xray_organizations"
            " WHERE public_id = %s",
            (public,),
        )
        if not rows:
            return None
        row = rows[0]
        return Organization(
            id=int(row["id"]),
            public_id=row["public_id"],
            slug=row["slug"],
            name=row["name"],
        )

    def organizations_for(self, user_id: int) -> list[dict[str, Any]]:
        return self._db.rows(
            "SELECT o.public_id AS id, o.slug, o.name, m.role,"
            " (SELECT count(*)::int FROM xray_projects p WHERE p.org_id = o.id)"
            "   AS projects"
            " FROM xray_organizations o"
            " JOIN xray_memberships m ON m.org_id = o.id"
            " WHERE m.user_id = %s ORDER BY o.name",
            (user_id,),
        )

    def org_role(self, org_id: int, user_id: int) -> Role | None:
        rows = self._db.rows(
            "SELECT role FROM xray_memberships WHERE org_id = %s AND user_id = %s",
            (org_id, user_id),
        )
        return read(rows[0]["role"]) if rows else None

    def list_members(self, org_id: int) -> list[dict[str, Any]]:
        return self._db.rows(
            "SELECT u.public_id AS id, u.email, u.name, m.role, m.created_at,"
            " u.last_seen_at"
            " FROM xray_memberships m JOIN xray_users u ON u.id = m.user_id"
            " WHERE m.org_id = %s ORDER BY u.email",
            (org_id,),
        )

    def set_member_role(self, org_id: int, user_id: int, role: Role) -> None:
        self._db.run(
            "INSERT INTO xray_memberships (org_id, user_id, role)"
            " VALUES (%s, %s, %s)"
            " ON CONFLICT (org_id, user_id) DO UPDATE SET role = EXCLUDED.role",
            (org_id, user_id, role.value),
        )

    def remove_member(self, org_id: int, user_id: int) -> None:
        """Removes somebody, unless they are the last owner.

        An organization with no owner is one nobody can add an owner to, which
        is a support ticket rather than a state worth allowing.
        """
        with self._db.connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    "SELECT count(*)::int AS owners FROM xray_memberships"
                    " WHERE org_id = %s AND role = 'owner' AND user_id <> %s",
                    (org_id, user_id),
                )
                row = cursor.fetchone()
                cursor.execute(
                    "SELECT role FROM xray_memberships"
                    " WHERE org_id = %s AND user_id = %s",
                    (org_id, user_id),
                )
                theirs = cursor.fetchone()
                if (
                    theirs is not None
                    and read(theirs["role"]) is Role.OWNER
                    and row is not None
                    and int(row["owners"]) == 0
                ):
                    raise NotAllowed(
                        "this is the only owner. Make somebody else an owner"
                        " first, or delete the organization."
                    )
                cursor.execute(
                    "DELETE FROM xray_memberships WHERE org_id = %s AND user_id = %s",
                    (org_id, user_id),
                )
            connection.commit()

    # Projects

    def create_project(
        self, org_id: int, slug: str, name: str, created_by: int | None = None
    ) -> Project:
        with self._db.connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    "SELECT 1 FROM xray_projects WHERE org_id = %s AND slug = %s",
                    (org_id, slug),
                )
                if cursor.fetchone() is not None:
                    raise AlreadyExists(
                        f"this organization already has a project called {slug!r}"
                    )
                cursor.execute(
                    "INSERT INTO xray_projects"
                    " (public_id, org_id, slug, name, created_by)"
                    " VALUES (%s, %s, %s, %s, %s)"
                    " RETURNING id, public_id, org_id, slug, name",
                    (public_id("proj"), org_id, slug, name or slug, created_by),
                )
                row = cursor.fetchone()
            connection.commit()
        assert row is not None
        return _project(row)

    def find_project(self, public: str) -> Project | None:
        rows = self._db.rows(
            "SELECT id, public_id, org_id, slug, name FROM xray_projects"
            " WHERE public_id = %s",
            (public,),
        )
        return _project(rows[0]) if rows else None

    def projects_for(
        self, user_id: int, org_id: int | None = None
    ) -> list[dict[str, Any]]:
        """Every project this person may read, and the role they read it with.

        A project is visible when the organization role allows it or when a
        project role does, which is the same rule `access` applies and is
        written once here so a list cannot show what a read would refuse.
        """
        allowed = [role.value for role in Role if allows(role, Permission.READ_PROJECT)]
        return self._db.rows(
            "SELECT p.public_id AS id, p.slug, p.name, p.retention_days,"
            " p.created_at,"
            " o.public_id AS org_id, o.slug AS org_slug, o.name AS org_name,"
            " coalesce(pr.role, m.role) AS role,"
            " (SELECT count(*)::int FROM xray_runs r WHERE r.project_id = p.id)"
            "   AS runs"
            " FROM xray_projects p"
            " JOIN xray_organizations o ON o.id = p.org_id"
            " LEFT JOIN xray_memberships m ON m.org_id = p.org_id AND m.user_id = %s"
            " LEFT JOIN xray_project_roles pr"
            "   ON pr.project_id = p.id AND pr.user_id = %s"
            " WHERE coalesce(pr.role, m.role) = ANY(%s)"
            "   AND (%s::bigint IS NULL OR p.org_id = %s)"
            " ORDER BY o.name, p.name",
            (user_id, user_id, allowed, org_id, org_id),
        )

    def access(self, user: User, project: Project) -> Access | None:
        """What this person may do with this project, or None if nothing."""
        organization = self._organization(project.org_id)
        if organization is None:  # pragma: no cover - a foreign key guarantees it
            return None
        rows = self._db.rows(
            "SELECT m.role AS org_role, pr.role AS project_role"
            " FROM xray_projects p"
            " LEFT JOIN xray_memberships m"
            "   ON m.org_id = p.org_id AND m.user_id = %s"
            " LEFT JOIN xray_project_roles pr"
            "   ON pr.project_id = p.id AND pr.user_id = %s"
            " WHERE p.id = %s",
            (user.id, user.id, project.id),
        )
        if not rows:
            return None
        role = effective(read(rows[0]["org_role"]), read(rows[0]["project_role"]))
        if not allows(role, Permission.READ_PROJECT):
            return None
        return Access(user=user, project=project, organization=organization, role=role)

    def set_project_role(
        self, project_id: int, user_id: int, role: Role | None
    ) -> None:
        """Sets or clears the role that overrides the organization's."""
        if role is None:
            self._db.run(
                "DELETE FROM xray_project_roles WHERE project_id = %s AND user_id = %s",
                (project_id, user_id),
            )
            return
        self._db.run(
            "INSERT INTO xray_project_roles (project_id, user_id, role)"
            " VALUES (%s, %s, %s)"
            " ON CONFLICT (project_id, user_id) DO UPDATE SET role = EXCLUDED.role",
            (project_id, user_id, role.value),
        )

    def rename_project(self, project_id: int, name: str) -> None:
        self._db.run(
            "UPDATE xray_projects SET name = %s WHERE id = %s", (name, project_id)
        )

    def set_retention(self, project_id: int, days: int | None) -> None:
        self._db.run(
            "UPDATE xray_projects SET retention_days = %s WHERE id = %s",
            (days, project_id),
        )

    def delete_project(self, project_id: int) -> None:
        """Deletes a project and everything recorded under it."""
        self._db.run("DELETE FROM xray_projects WHERE id = %s", (project_id,))

    def delete_organization(self, org_id: int) -> None:
        self._db.run("DELETE FROM xray_organizations WHERE id = %s", (org_id,))

    def rename_organization(self, org_id: int, name: str) -> None:
        self._db.run(
            "UPDATE xray_organizations SET name = %s WHERE id = %s", (name, org_id)
        )

    # Keys

    def issue_key(
        self, project_id: int, name: str = "", created_by: int | None = None
    ) -> Secret:
        """Mints a key. The value is readable here and never again."""
        token = issue(KEY_PREFIX, size=24)
        self._db.run(
            "INSERT INTO xray_api_keys"
            " (public_id, project_id, name, prefix, token_hash, created_by)"
            " VALUES (%s, %s, %s, %s, %s, %s)",
            (
                public_id("key"),
                project_id,
                name.strip(),
                token.value[:PREFIX_SHOWN],
                token.digest,
                created_by,
            ),
        )
        return token

    def list_keys(self, project_id: int) -> list[dict[str, Any]]:
        return self._db.rows(
            "SELECT k.public_id AS id, k.name, k.prefix, k.created_at,"
            " k.last_used_at,"
            " k.disabled_at, u.email AS created_by"
            " FROM xray_api_keys k LEFT JOIN xray_users u ON u.id = k.created_by"
            " WHERE k.project_id = %s ORDER BY k.created_at DESC",
            (project_id,),
        )

    def revoke_key(self, project_id: int, public: str) -> bool:
        """Stops a key answering. The row stays, so the record of it stays."""
        return (
            self._db.run(
                "UPDATE xray_api_keys SET disabled_at = now()"
                " WHERE project_id = %s AND public_id = %s AND disabled_at IS NULL",
                (project_id, public),
            )
            > 0
        )

    # Invites

    def create_invite(
        self, org_id: int, email: str, role: Role, created_by: int
    ) -> Secret:
        """Mints an invite. The link is readable here and never again."""
        token = issue("bxi_", size=24)
        self._db.run(
            "INSERT INTO xray_invites"
            " (public_id, org_id, email, role, token_hash, created_by, expires_at)"
            " VALUES (%s, %s, %s, %s, %s, %s, %s)",
            (
                public_id("inv"),
                org_id,
                email.strip(),
                role.value,
                token.digest,
                created_by,
                _now() + timedelta(days=INVITE_DAYS),
            ),
        )
        return token

    def read_invite(self, token: str) -> dict[str, Any] | None:
        """What an invite offers, or None if it cannot be accepted."""
        rows = self._db.rows(
            "SELECT i.id, i.org_id, i.email, i.role, o.name AS org_name,"
            " o.slug AS org_slug"
            " FROM xray_invites i JOIN xray_organizations o ON o.id = i.org_id"
            " WHERE i.token_hash = %s AND i.accepted_at IS NULL"
            "   AND i.expires_at > now()",
            (digest(token),),
        )
        return rows[0] if rows else None

    def accept_invite(self, token: str, user_id: int) -> Organization | None:
        """Takes the invite and makes the membership, in one transaction.

        Marked accepted in the same statement that reads it, so a link opened
        twice at once cannot make two memberships or be spent twice.
        """
        with self._db.connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    "UPDATE xray_invites SET accepted_at = now(), accepted_by = %s"
                    " WHERE token_hash = %s AND accepted_at IS NULL"
                    "   AND expires_at > now()"
                    " RETURNING org_id, role",
                    (user_id, digest(token)),
                )
                row = cursor.fetchone()
                if row is None:
                    connection.commit()
                    return None
                cursor.execute(
                    "INSERT INTO xray_memberships (org_id, user_id, role)"
                    " VALUES (%s, %s, %s) ON CONFLICT (org_id, user_id) DO NOTHING",
                    (row["org_id"], user_id, row["role"]),
                )
                cursor.execute(
                    "SELECT id, public_id, slug, name FROM xray_organizations"
                    " WHERE id = %s",
                    (row["org_id"],),
                )
                found = cursor.fetchone()
            connection.commit()
        if found is None:  # pragma: no cover - a foreign key guarantees it
            return None
        return Organization(
            id=int(found["id"]),
            public_id=found["public_id"],
            slug=found["slug"],
            name=found["name"],
        )

    def list_invites(self, org_id: int) -> list[dict[str, Any]]:
        return self._db.rows(
            "SELECT i.public_id AS id, i.email, i.role, i.created_at, i.expires_at,"
            " i.accepted_at, u.email AS created_by"
            " FROM xray_invites i LEFT JOIN xray_users u ON u.id = i.created_by"
            " WHERE i.org_id = %s AND i.accepted_at IS NULL AND i.expires_at > now()"
            " ORDER BY i.created_at DESC",
            (org_id,),
        )

    def revoke_invite(self, org_id: int, public: str) -> bool:
        return (
            self._db.run(
                "DELETE FROM xray_invites WHERE org_id = %s AND public_id = %s"
                " AND accepted_at IS NULL",
                (org_id, public),
            )
            > 0
        )

    def _organization(self, org_id: int) -> Organization | None:
        rows = self._db.rows(
            "SELECT id, public_id, slug, name FROM xray_organizations WHERE id = %s",
            (org_id,),
        )
        if not rows:
            return None
        row = rows[0]
        return Organization(
            id=int(row["id"]),
            public_id=row["public_id"],
            slug=row["slug"],
            name=row["name"],
        )


def _user(row: dict[str, Any]) -> User:
    return User(
        id=int(row["id"]),
        public_id=row["public_id"],
        email=row["email"],
        name=row["name"],
    )


def _project(row: dict[str, Any]) -> Project:
    return Project(
        id=int(row["id"]),
        public_id=row["public_id"],
        org_id=int(row["org_id"]),
        slug=row["slug"],
        name=row["name"],
    )
