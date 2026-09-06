"""Getting an install from nothing to useful.

Two ways: a person opens it in a browser, or a compose file set the variables
and nobody opens anything. Both have to end in the same place, and neither may
undo the other.
"""

from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient

from blackboardxray.server.app import build
from blackboardxray.server.provision import provision
from blackboardxray.server.roles import Role
from blackboardxray.server.settings import Provision, Settings

PASSWORD = "a long enough phrase"


def serve(database: Any, dsn: str, **rest: Any) -> TestClient:
    made = TestClient(build(Settings(database_url=dsn, **rest), database=database))
    made.headers["origin"] = "http://testserver"
    return made


@pytest.fixture
def client(database: Any, dsn: str):
    with serve(database, dsn) as made:
        yield made


class TestTheFirstRun:
    def test_an_install_with_nobody_in_it_says_it_needs_setting_up(
        self, client: Any
    ) -> None:
        state = client.get("/api/v1/auth/state").json()
        assert state["needs_setup"] is True
        assert state["user"] is None

    def test_setting_up_makes_everything_needed_to_be_useful(self, client: Any) -> None:
        # An owner, an organization, a project and a key, in one request, so
        # the first screen ends with something an application can send to.
        answer = client.post(
            "/api/v1/setup",
            json={
                "email": "first@example.com",
                "password": PASSWORD,
                "name": "First",
                "organization": "Acme Inc",
                "project": "Production",
            },
        )
        assert answer.status_code == 201, answer.text
        made = answer.json()
        assert made["user"]["email"] == "first@example.com"
        assert made["organization"]["slug"] == "acme-inc"
        assert made["project"]["slug"] == "production"
        assert made["api_key"].startswith("bxr_")

    def test_setting_up_signs_the_first_person_in(self, client: Any) -> None:
        client.post(
            "/api/v1/setup",
            json={"email": "first@example.com", "password": PASSWORD},
        )
        state = client.get("/api/v1/auth/state").json()
        assert state["needs_setup"] is False
        assert state["user"]["email"] == "first@example.com"

    def test_the_key_it_prints_can_actually_send(
        self, client: Any, board_id: str
    ) -> None:
        # The whole point of handing one over on that screen.
        made = client.post(
            "/api/v1/setup",
            json={"email": "first@example.com", "password": PASSWORD},
        ).json()
        answer = client.post(
            "/api/v1/ingest",
            json={"events": [{"board_id": board_id, "kind": "run.opened"}]},
            headers={"authorization": f"Bearer {made['api_key']}"},
        )
        assert answer.status_code == 202

    def test_it_is_offered_once(self, client: Any) -> None:
        # This is the one route on an unconfigured install that answers without
        # a session. It must stop doing that the moment somebody exists who
        # could have invited you instead.
        client.post(
            "/api/v1/setup",
            json={"email": "first@example.com", "password": PASSWORD},
        )
        answer = client.post(
            "/api/v1/setup",
            json={"email": "second@example.com", "password": PASSWORD},
        )
        assert answer.status_code == 409
        assert answer.json()["error"] == "already_set_up"

    def test_a_password_below_the_floor_is_refused_with_a_reason(
        self, client: Any
    ) -> None:
        answer = client.post(
            "/api/v1/setup", json={"email": "first@example.com", "password": "short"}
        )
        assert answer.status_code == 422
        assert answer.json()["error"] == "weak_password"


class TestInvitations:
    def test_somebody_invited_can_join_and_lands_in_the_organization(
        self, client: Any
    ) -> None:
        client.post(
            "/api/v1/setup",
            json={"email": "first@example.com", "password": PASSWORD},
        )
        org = client.get("/api/v1/orgs").json()["organizations"][0]
        invited = client.post(
            f"/api/v1/orgs/{org['id']}/invites",
            json={"email": "second@example.com", "role": "member"},
        )
        assert invited.status_code == 201, invited.text
        token = invited.json()["token"]

        offered = client.get(f"/api/v1/auth/invite/{token}").json()
        assert offered["organization"] == "Default"
        assert offered["has_account"] is False

        joined = client.post(
            "/api/v1/auth/join",
            json={"token": token, "password": PASSWORD, "name": "Second"},
        )
        assert joined.status_code == 200, joined.text
        assert joined.json()["user"]["email"] == "second@example.com"

    def test_a_link_is_spent_once(self, client: Any) -> None:
        client.post(
            "/api/v1/setup",
            json={"email": "first@example.com", "password": PASSWORD},
        )
        org = client.get("/api/v1/orgs").json()["organizations"][0]
        token = client.post(
            f"/api/v1/orgs/{org['id']}/invites",
            json={"email": "second@example.com", "role": "member"},
        ).json()["token"]
        client.post("/api/v1/auth/join", json={"token": token, "password": PASSWORD})
        again = client.get(f"/api/v1/auth/invite/{token}")
        assert again.status_code == 404

    def test_a_link_nobody_issued_offers_nothing(self, client: Any) -> None:
        assert client.get("/api/v1/auth/invite/bxi_invented").status_code == 404


class TestProvisioningFromTheEnvironment:
    def _wanted(self) -> Provision:
        return Provision(
            org_slug="acme",
            org_name="Acme",
            project_slug="production",
            project_name="Production",
            user_email="ops@example.com",
            user_password=PASSWORD,
            user_name="Ops",
            api_key="bxr_a_key_from_the_compose_file",
        )

    def test_a_deployment_comes_up_ready(self, database: Any) -> None:
        made = provision(database, self._wanted())
        assert len(made) == 4
        assert database.people.count_users() == 1
        rows = database.rows("SELECT slug FROM xray_organizations")
        assert [row["slug"] for row in rows] == ["acme"]
        rows = database.rows("SELECT slug FROM xray_projects")
        assert [row["slug"] for row in rows] == ["production"]

    def test_the_key_it_was_given_is_the_key_that_works(self, database: Any) -> None:
        provision(database, self._wanted())
        found = database.authenticate("bxr_a_key_from_the_compose_file")
        assert found is not None and found.slug == "production"

    def test_running_again_changes_nothing(self, database: Any) -> None:
        # A container restarts. It must not make a second organization, a
        # second key, or a second anything.
        provision(database, self._wanted())
        assert provision(database, self._wanted()) == []
        assert (
            database.rows("SELECT count(*)::int AS n FROM xray_api_keys")[0]["n"] == 1
        )

    def test_a_change_made_afterwards_survives_a_restart(self, database: Any) -> None:
        # Renaming the organization in the interface and then restarting must
        # not rename it back.
        provision(database, self._wanted())
        rows = database.rows("SELECT public_id FROM xray_organizations")
        organization = database.people.find_organization(rows[0]["public_id"])
        assert organization is not None
        database.people.rename_organization(organization.id, "Renamed By A Person")
        provision(database, self._wanted())
        assert (
            database.rows("SELECT name FROM xray_organizations")[0]["name"]
            == "Renamed By A Person"
        )

    def test_nothing_asked_for_means_nothing_made(self, database: Any) -> None:
        assert provision(database, Provision()) == []
        assert database.people.count_users() == 0

    def test_the_provisioned_person_owns_what_was_made(self, database: Any) -> None:
        provision(database, self._wanted())
        rows = database.rows("SELECT public_id FROM xray_organizations")
        organization = database.people.find_organization(rows[0]["public_id"])
        assert organization is not None
        members = database.people.list_members(organization.id)
        assert [(one["email"], one["role"]) for one in members] == [
            ("ops@example.com", Role.OWNER.value)
        ]

    def test_a_bad_value_does_not_stop_the_server_coming_up(
        self, database: Any
    ) -> None:
        # Whoever set it can read the log and fix it. Refusing to start would
        # mean one typo in a compose file takes the platform down.
        wanted = Provision(
            org_slug="acme",
            project_slug="production",
            user_email="not-an-address",
            user_password=PASSWORD,
        )
        made = provision(database, wanted)
        assert any("could not create" in line for line in made)


class TestGettingBackIn:
    """The only path back for somebody who forgot their password."""

    def test_nothing_in_the_interface_recovers_an_account(
        self, client: Any, database: Any
    ) -> None:
        # Worth stating as a test, because it is the reason the command line
        # carries `password` and the reason an admin cannot set somebody
        # else's: if they could, every account in the organization would be
        # inside an admin's reach, including an owner's.
        client.post(
            "/api/v1/setup",
            json={"email": "first@example.com", "password": PASSWORD},
        )
        org = client.get("/api/v1/orgs").json()["organizations"][0]

        # An invitation to an address that already has an account asks for that
        # account's password, which is exactly what has been lost.
        token = client.post(
            f"/api/v1/orgs/{org['id']}/invites",
            json={"email": "first@example.com", "role": "member"},
        ).json()["token"]
        answer = client.post(
            "/api/v1/auth/join",
            json={"token": token, "password": "a guess at the old one"},
        )
        assert answer.status_code == 401

    def test_the_command_line_sets_a_new_one(self, database: Any) -> None:
        people = database.people
        user = people.create_user("locked@example.com", PASSWORD)
        signed = people.sign_in("locked@example.com", PASSWORD)
        assert signed is not None

        people.set_password(user.id, "a brand new long phrase")

        assert people.sign_in("locked@example.com", PASSWORD) is None
        assert people.sign_in("locked@example.com", "a brand new long phrase")
        # Somebody who could not sign in has no session worth keeping, and one
        # still open is one somebody else may be holding.
        assert people.read_session(signed.session.value) is None
