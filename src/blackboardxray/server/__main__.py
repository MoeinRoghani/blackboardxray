"""Running the platform, and getting into it when nobody can.

    blackboardxray serve
    blackboardxray owner <email> [name]
    blackboardxray key <organization> <project> [name]
    blackboardxray migrate

`serve` runs the server, and is the only one of these a normal deployment
needs. Organizations, projects, keys and people are made in the interface.

The rest are the way back in when the interface cannot help: nobody has an
account yet and the setup screen is not reachable, or the last owner has left,
or an application needs a key at three in the morning and the person who can
issue one is asleep. Each prints what it made once.
"""

from __future__ import annotations

import getpass
import sys

from blackboardxray.server.db import Database
from blackboardxray.server.identity import WeakPassword
from blackboardxray.server.people import AlreadyExists, PeopleError
from blackboardxray.server.roles import Role
from blackboardxray.server.settings import Settings


def main(argv: list[str] | None = None) -> int:
    arguments = list(sys.argv[1:] if argv is None else argv)
    command = arguments[0] if arguments else "serve"
    settings = Settings.from_env()

    if command == "serve":
        import uvicorn

        from blackboardxray.server.app import build

        uvicorn.run(build(settings), host=settings.host, port=settings.port)
        return 0

    database = Database(settings.database_url)
    try:
        if command == "migrate":
            # Opening the database applied them. Saying which is the point.
            print("the database is up to date")
            return 0
        if command == "owner":
            return _owner(database, arguments)
        if command == "key":
            return _key(database, arguments)
        print(__doc__)
        return 2
    finally:
        database.close()


def _owner(database: Database, arguments: list[str]) -> int:
    """Makes an account and an organization it owns.

    The way back in when nobody can sign in. Safe to run on an install that
    already has people: it adds one more owner and takes nothing away.
    """
    if len(arguments) < 2:
        print("usage: blackboardxray owner <email> [name]")
        return 2
    email = arguments[1]
    name = arguments[2] if len(arguments) > 2 else ""
    password = getpass.getpass("password: ")
    if password != getpass.getpass("again: "):
        print("those did not match")
        return 2
    try:
        user = database.people.create_user(email, password, name)
    except WeakPassword as weak:
        print(weak)
        return 2
    except AlreadyExists:
        print(f"{email} already has an account. Sign in, or reset it in the interface.")
        return 2
    except PeopleError as refused:
        print(refused)
        return 2

    slug = "default"
    existing = database.rows(
        "SELECT public_id FROM xray_organizations WHERE slug = %s", (slug,)
    )
    if existing:
        organization = database.people.find_organization(existing[0]["public_id"])
        assert organization is not None
        database.people.set_member_role(organization.id, user.id, Role.OWNER)
    else:
        organization = database.people.create_organization(slug, "Default", user.id)
    print(f"account:      {user.email}")
    print(f"organization: {organization.slug}, and you own it")
    return 0


def _key(database: Database, arguments: list[str]) -> int:
    """Issues a key for one project. Printed once."""
    if len(arguments) < 3:
        print("usage: blackboardxray key <organization> <project> [name]")
        return 2
    org_slug, project_slug = arguments[1], arguments[2]
    name = arguments[3] if len(arguments) > 3 else ""
    rows = database.rows(
        "SELECT p.id FROM xray_projects p JOIN xray_organizations o ON o.id = p.org_id"
        " WHERE o.slug = %s AND p.slug = %s",
        (org_slug, project_slug),
    )
    if not rows:
        print(f"no project {project_slug!r} in organization {org_slug!r}")
        return 2
    issued = database.people.issue_key(int(rows[0]["id"]), name)
    print(f"project: {org_slug}/{project_slug}")
    print(f"token:   {issued.value}")
    print("This token is shown once. The database holds its hash.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
