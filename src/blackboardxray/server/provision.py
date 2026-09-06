"""Making an install useful before anybody has touched it.

A deployment with no hands on it sets a handful of environment variables and
comes up with an organization, a project, an account and a key already in
place. That is what makes this runnable from a compose file or a chart without
a person opening a browser first.

Everything here is applied only where the thing is absent, so restarting the
container does not undo a change somebody made afterwards. Renaming the
organization in the interface and then restarting must not rename it back.

The key is the one value that has to be given rather than generated. A key the
platform invented on boot would be printed into a log and then be unreadable
forever, and the application that needs it is configured from the same file
these variables came from.
"""

from __future__ import annotations

from blackboardxray.server.db import Database
from blackboardxray.server.identity import digest, public_id
from blackboardxray.server.people import AlreadyExists, PeopleError
from blackboardxray.server.settings import Provision


def provision(store: Database, wanted: Provision) -> list[str]:
    """Creates what was asked for and is missing. Answers what it made."""
    if not wanted.wanted:
        return []
    made: list[str] = []
    people = store.people

    user = None
    if wanted.user_email and wanted.user_password:
        rows = store.rows(
            "SELECT id FROM xray_users WHERE email_folded = lower(%s)",
            (wanted.user_email,),
        )
        if rows:
            user = people.find_user(
                store.rows(
                    "SELECT public_id FROM xray_users WHERE id = %s", (rows[0]["id"],)
                )[0]["public_id"]
            )
        else:
            try:
                user = people.create_user(
                    wanted.user_email, wanted.user_password, wanted.user_name
                )
                made.append(f"the account {wanted.user_email}")
            except (PeopleError, ValueError) as refused:
                # A bad value in the environment must not stop the server
                # coming up. Whoever set it can read the log and fix it, and
                # meanwhile the setup screen still works.
                made.append(f"could not create {wanted.user_email}: {refused}")

    organization = None
    if wanted.org_slug:
        rows = store.rows(
            "SELECT public_id FROM xray_organizations WHERE slug = %s",
            (wanted.org_slug,),
        )
        if rows:
            organization = people.find_organization(rows[0]["public_id"])
        elif user is not None:
            try:
                organization = people.create_organization(
                    wanted.org_slug, wanted.org_name or wanted.org_slug, user.id
                )
                made.append(f"the organization {wanted.org_slug}")
            except AlreadyExists:  # pragma: no cover - checked above
                pass

    project = None
    if wanted.project_slug and organization is not None:
        rows = store.rows(
            "SELECT public_id FROM xray_projects WHERE org_id = %s AND slug = %s",
            (organization.id, wanted.project_slug),
        )
        if rows:
            project = people.find_project(rows[0]["public_id"])
        else:
            try:
                project = people.create_project(
                    organization.id,
                    wanted.project_slug,
                    wanted.project_name or wanted.project_slug,
                    user.id if user else None,
                )
                made.append(f"the project {wanted.project_slug}")
            except AlreadyExists:  # pragma: no cover - checked above
                pass

    if wanted.api_key and project is not None:
        held = digest(wanted.api_key)
        rows = store.rows("SELECT 1 FROM xray_api_keys WHERE token_hash = %s", (held,))
        if not rows:
            store.run(
                "INSERT INTO xray_api_keys"
                " (public_id, project_id, name, prefix, token_hash, created_by)"
                " VALUES (%s, %s, %s, %s, %s, %s)",
                (
                    public_id("key"),
                    project.id,
                    "Provisioned",
                    wanted.api_key[:12],
                    held,
                    user.id if user else None,
                ),
            )
            made.append("the key from the environment")

    return made
