"""What the HTTP surface refuses.

The role model is tested directly in `test_identity.py`. This checks that the
routes actually consult it, which is the failure that matters: a permission
table nothing reads is a permission table that permits everything.
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import pytest
from fastapi.testclient import TestClient

from blackboardxray.events import Event, EventKind
from blackboardxray.server.app import build
from blackboardxray.server.roles import Role
from blackboardxray.server.settings import Settings

PASSWORD = "a long enough phrase"
ORIGIN = "http://testserver"


@pytest.fixture
def client(database: Any, dsn: str):
    settings = Settings(database_url=dsn)
    with TestClient(build(settings, database=database)) as made:
        made.headers["origin"] = ORIGIN
        yield made


@pytest.fixture
def world(database: Any):
    """An owner, an organization, a project, and a run inside it."""
    people = database.people
    owner = people.create_user("owner@example.com", PASSWORD, "Owner")
    org = people.create_organization("acme", "Acme", owner.id)
    project = people.create_project(org.id, "production", "Production", owner.id)
    key = people.issue_key(project.id, "ci")
    database.ingest(
        project.id,
        [
            Event(board_id="incident-1", kind=EventKind.RUN_OPENED),
            Event(
                board_id="incident-1",
                kind=EventKind.WRITE_ADMITTED,
                sequence=1,
                agent="ocp",
                region="signals",
                body={"content": {"bytes": 20, "type": "object", "content": {"a": 1}}},
            ),
        ],
    )
    return SimpleNamespace(
        people=people, owner=owner, org=org, project=project, key=key
    )


def as_person(client: Any, email: str) -> Any:
    answer = client.post(
        "/api/v1/auth/signin", json={"email": email, "password": PASSWORD}
    )
    assert answer.status_code == 200, answer.text
    return client


def person(world: Any, email: str, role: Role | None) -> Any:
    made = world.people.create_user(email, PASSWORD)
    if role is not None:
        world.people.set_member_role(world.org.id, made.id, role)
    return made


class TestReadingNeedsASession:
    @pytest.mark.parametrize(
        "path",
        ["overview", "runs", "agents", "facets", "histogram", "runs/incident-1"],
    )
    def test_every_read_refuses_a_stranger(
        self, client: Any, world: Any, path: str
    ) -> None:
        # Reading used to be open to whoever could reach the port.
        answer = client.get(f"/api/v1/projects/{world.project.public_id}/{path}")
        assert answer.status_code == 401
        assert answer.json()["error"] == "not_signed_in"

    def test_an_invented_session_is_not_a_session(
        self, client: Any, world: Any
    ) -> None:
        client.cookies.set("bxr_session", "bxs_invented")
        answer = client.get(f"/api/v1/projects/{world.project.public_id}/overview")
        assert answer.status_code == 401

    def test_a_signed_in_stranger_still_reads_nothing(
        self, client: Any, world: Any
    ) -> None:
        # Having an account is not having access. The answer is 404, the same
        # as a project that does not exist, so belonging cannot be probed.
        person(world, "stranger@example.com", None)
        as_person(client, "stranger@example.com")
        answer = client.get(f"/api/v1/projects/{world.project.public_id}/overview")
        assert answer.status_code == 404
        assert answer.json()["error"] == "unknown_project"


class TestWhatEachRoleMayDo:
    @pytest.mark.parametrize(
        ("role", "expected"),
        [
            (Role.OWNER, 200),
            (Role.ADMIN, 200),
            (Role.MEMBER, 200),
            (Role.VIEWER, 200),
            (Role.NONE, 404),
        ],
    )
    def test_reading_a_project(
        self, client: Any, world: Any, role: Role, expected: int
    ) -> None:
        person(world, f"r{role.value}@example.com", role)
        as_person(client, f"r{role.value}@example.com")
        answer = client.get(f"/api/v1/projects/{world.project.public_id}/overview")
        assert answer.status_code == expected

    @pytest.mark.parametrize(
        ("role", "expected"),
        [
            (Role.OWNER, 200),
            (Role.ADMIN, 200),
            (Role.MEMBER, 403),
            (Role.VIEWER, 403),
        ],
    )
    def test_listing_keys(
        self, client: Any, world: Any, role: Role, expected: int
    ) -> None:
        # A member reads runs and does not hold the credentials that write them.
        person(world, f"k{role.value}@example.com", role)
        as_person(client, f"k{role.value}@example.com")
        answer = client.get(f"/api/v1/projects/{world.project.public_id}/keys")
        assert answer.status_code == expected

    @pytest.mark.parametrize(
        ("role", "expected"),
        [(Role.OWNER, 204), (Role.ADMIN, 204), (Role.MEMBER, 403)],
    )
    def test_deleting_a_project(
        self, client: Any, world: Any, role: Role, expected: int
    ) -> None:
        person(world, f"d{role.value}@example.com", role)
        as_person(client, f"d{role.value}@example.com")
        answer = client.delete(f"/api/v1/projects/{world.project.public_id}")
        assert answer.status_code == expected

    @pytest.mark.parametrize(
        ("role", "expected"), [(Role.OWNER, 204), (Role.ADMIN, 403)]
    )
    def test_deleting_the_organization(
        self, client: Any, world: Any, role: Role, expected: int
    ) -> None:
        person(world, f"x{role.value}@example.com", role)
        as_person(client, f"x{role.value}@example.com")
        answer = client.delete(f"/api/v1/orgs/{world.org.public_id}")
        assert answer.status_code == expected


class TestAViewerDoesNotReadContent:
    def test_a_member_reads_what_was_written(self, client: Any, world: Any) -> None:
        person(world, "member@example.com", Role.MEMBER)
        as_person(client, "member@example.com")
        answer = client.get(
            f"/api/v1/projects/{world.project.public_id}/runs/incident-1/events"
        )
        written = [
            one for one in answer.json()["events"] if one["kind"] == "write.admitted"
        ]
        assert written[0]["body"]["content"]["content"] == {"a": 1}

    def test_a_viewer_reads_the_shape_and_not_the_value(
        self, client: Any, world: Any
    ) -> None:
        # A contribution is the application's own data. The lowest role that
        # can be handed out sees that four kilobytes of an object were admitted
        # at sequence nine, and not what was in it.
        person(world, "viewer@example.com", Role.VIEWER)
        as_person(client, "viewer@example.com")
        answer = client.get(
            f"/api/v1/projects/{world.project.public_id}/runs/incident-1/events"
        )
        written = [
            one for one in answer.json()["events"] if one["kind"] == "write.admitted"
        ]
        carried = written[0]["body"]["content"]
        assert "content" not in carried
        assert carried["withheld"] is True
        assert carried["bytes"] == 20
        assert carried["type"] == "object"


class TestGrantingAndRemoving:
    def test_an_admin_cannot_make_somebody_an_owner(
        self, client: Any, world: Any
    ) -> None:
        # Otherwise an admin makes themselves an owner in two steps.
        admin = person(world, "admin@example.com", Role.ADMIN)
        other = person(world, "other@example.com", Role.MEMBER)
        as_person(client, "admin@example.com")
        answer = client.patch(
            f"/api/v1/orgs/{world.org.public_id}/members/{other.public_id}",
            json={"role": "owner"},
        )
        assert answer.status_code == 403
        assert world.people.org_role(world.org.id, admin.id) is Role.ADMIN

    def test_an_admin_cannot_remove_an_owner(self, client: Any, world: Any) -> None:
        person(world, "admin2@example.com", Role.ADMIN)
        as_person(client, "admin2@example.com")
        answer = client.delete(
            f"/api/v1/orgs/{world.org.public_id}/members/{world.owner.public_id}"
        )
        assert answer.status_code == 403
        assert world.people.org_role(world.org.id, world.owner.id) is Role.OWNER

    def test_an_owner_may_make_another_owner(self, client: Any, world: Any) -> None:
        other = person(world, "second@example.com", Role.MEMBER)
        as_person(client, "owner@example.com")
        answer = client.patch(
            f"/api/v1/orgs/{world.org.public_id}/members/{other.public_id}",
            json={"role": "owner"},
        )
        assert answer.status_code == 200
        assert world.people.org_role(world.org.id, other.id) is Role.OWNER

    def test_the_last_owner_cannot_remove_themselves(
        self, client: Any, world: Any
    ) -> None:
        as_person(client, "owner@example.com")
        answer = client.delete(
            f"/api/v1/orgs/{world.org.public_id}/members/{world.owner.public_id}"
        )
        assert answer.status_code == 409
        assert answer.json()["error"] == "last_owner"

    def test_anybody_may_leave(self, client: Any, world: Any) -> None:
        leaving = person(world, "leaving@example.com", Role.MEMBER)
        as_person(client, "leaving@example.com")
        answer = client.delete(
            f"/api/v1/orgs/{world.org.public_id}/members/{leaving.public_id}"
        )
        assert answer.status_code == 204


class TestCrossSiteRequests:
    def test_a_session_from_another_origin_is_refused(
        self, client: Any, world: Any
    ) -> None:
        # SameSite=Lax stops a cross site form post. This stops the rest.
        as_person(client, "owner@example.com")
        answer = client.delete(
            f"/api/v1/projects/{world.project.public_id}",
            headers={"origin": "https://somewhere-else.example"},
        )
        assert answer.status_code == 403
        assert answer.json()["error"] == "wrong_origin"

    def test_a_read_from_another_origin_is_allowed_through_to_the_session(
        self, client: Any, world: Any
    ) -> None:
        # A GET changes nothing, and the browser will not hand the answer to a
        # cross site caller anyway. The origin check is for what writes.
        as_person(client, "owner@example.com")
        answer = client.get(
            f"/api/v1/projects/{world.project.public_id}/overview",
            headers={"origin": "https://somewhere-else.example"},
        )
        assert answer.status_code == 200

    def test_ingestion_needs_no_origin(self, client: Any, world: Any) -> None:
        # The sending client is a Python process, not a browser, and sends none.
        answer = client.post(
            "/api/v1/ingest",
            json={"events": [Event(board_id="b", kind=EventKind.RUN_OPENED).to_json()]},
            headers={"authorization": f"Bearer {world.key.value}", "origin": ""},
        )
        assert answer.status_code == 202


class TestARoleOnOneProject:
    """The override the tenancy model turns on, over HTTP."""

    def test_the_screen_is_told_both_roles(self, client: Any, world: Any) -> None:
        # A control that showed only the effective role could not tell "admin
        # because the organization says so" from "admin because somebody set it
        # here", and those are undone differently.
        person(world, "both@example.com", Role.MEMBER)
        as_person(client, "owner@example.com")
        listed = client.get(
            f"/api/v1/projects/{world.project.public_id}/members"
        ).json()["members"]
        theirs = next(one for one in listed if one["email"] == "both@example.com")
        assert theirs["org_role"] == "member"
        assert theirs["project_role"] is None

    def test_setting_one_changes_what_they_may_do_here_only(
        self, client: Any, world: Any
    ) -> None:
        other = world.people.create_project(
            world.org.id, "staging", "Staging", world.owner.id
        )
        subject = person(world, "raised@example.com", Role.MEMBER)
        as_person(client, "owner@example.com")

        answer = client.put(
            f"/api/v1/projects/{world.project.public_id}/members/{subject.public_id}",
            json={"role": "admin"},
        )
        assert answer.status_code == 200

        # Admin here, still a member on the project next to it.
        assert world.people.access(subject, world.project).role is Role.ADMIN
        assert world.people.access(subject, other).role is Role.MEMBER

    def test_it_lowers_as_well_as_raises(self, client: Any, world: Any) -> None:
        # Taking the greater of the two would make it impossible to give
        # somebody less on one project than they have everywhere else.
        subject = person(world, "lowered@example.com", Role.ADMIN)
        as_person(client, "owner@example.com")
        client.put(
            f"/api/v1/projects/{world.project.public_id}/members/{subject.public_id}",
            json={"role": "viewer"},
        )
        assert world.people.access(subject, world.project).role is Role.VIEWER

    def test_clearing_it_returns_them_to_the_organization(
        self, client: Any, world: Any
    ) -> None:
        subject = person(world, "cleared@example.com", Role.MEMBER)
        as_person(client, "owner@example.com")
        path = f"/api/v1/projects/{world.project.public_id}/members/{subject.public_id}"
        client.put(path, json={"role": "viewer"})
        assert world.people.access(subject, world.project).role is Role.VIEWER
        client.put(path, json={"role": ""})
        assert world.people.access(subject, world.project).role is Role.MEMBER

    def test_a_member_may_not_see_who_reads_the_project(
        self, client: Any, world: Any
    ) -> None:
        person(world, "nosy@example.com", Role.MEMBER)
        as_person(client, "nosy@example.com")
        answer = client.get(f"/api/v1/projects/{world.project.public_id}/members")
        assert answer.status_code == 403

    def test_nobody_grants_above_their_own(self, client: Any, world: Any) -> None:
        admin = person(world, "granting@example.com", Role.ADMIN)
        subject = person(world, "granted@example.com", Role.MEMBER)
        as_person(client, "granting@example.com")
        answer = client.put(
            f"/api/v1/projects/{world.project.public_id}/members/{subject.public_id}",
            json={"role": "owner"},
        )
        assert answer.status_code == 403
        assert world.people.access(admin, world.project).role is Role.ADMIN


class TestASecondOrganization:
    def test_anybody_signed_in_may_make_one_and_owns_it(
        self, client: Any, world: Any
    ) -> None:
        # Gating this on a permission would need a role above owner, which is a
        # role that exists only to be the person who forgot to hand it over.
        joiner = person(world, "founder@example.com", Role.VIEWER)
        as_person(client, "founder@example.com")
        answer = client.post("/api/v1/orgs", json={"name": "Their Own Thing"})
        assert answer.status_code == 201
        made = answer.json()
        assert made["slug"] == "their-own-thing"

        listed = client.get("/api/v1/orgs").json()["organizations"]
        theirs = next(one for one in listed if one["id"] == made["id"])
        assert theirs["role"] == "owner"
        assert world.people.org_role(world.org.id, joiner.id) is Role.VIEWER

    def test_it_is_separate_from_the_one_they_were_in(
        self, client: Any, world: Any
    ) -> None:
        person(world, "separate@example.com", Role.MEMBER)
        as_person(client, "separate@example.com")
        made = client.post("/api/v1/orgs", json={"name": "Separate"}).json()
        # Nobody else is in it, which is the point of a second organization.
        members = client.get(f"/api/v1/orgs/{made['id']}/members").json()["members"]
        assert [one["email"] for one in members] == ["separate@example.com"]
