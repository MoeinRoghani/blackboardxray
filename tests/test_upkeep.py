"""Retention, rate limits and the record of what changed."""

from __future__ import annotations

import threading
import time
from types import SimpleNamespace
from typing import Any

import pytest
from fastapi.testclient import TestClient

from blackboardxray.events import Event, EventKind
from blackboardxray.server.app import build
from blackboardxray.server.limits import Limiter
from blackboardxray.server.roles import Role
from blackboardxray.server.settings import Settings
from blackboardxray.server.upkeep import sweep

PASSWORD = "a long enough phrase"


@pytest.fixture
def world(database: Any):
    people = database.people
    owner = people.create_user("owner@example.com", PASSWORD, "Owner")
    org = people.create_organization("acme", "Acme", owner.id)
    project = people.create_project(org.id, "production", "Production", owner.id)
    key = people.issue_key(project.id, "ci")
    return SimpleNamespace(
        people=people, owner=owner, org=org, project=project, key=key
    )


@pytest.fixture
def client(database: Any, dsn: str, world: Any):
    settings = Settings(database_url=dsn)
    with TestClient(build(settings, database=database)) as made:
        made.headers["origin"] = "http://testserver"
        made.post(
            "/api/v1/auth/signin",
            json={"email": "owner@example.com", "password": PASSWORD},
        )
        yield made


def put(database: Any, project_id: int, board: str, age_days: int) -> None:
    """Records one run and backdates everything about it."""
    database.ingest(
        project_id,
        [
            Event(board_id=board, kind=EventKind.RUN_OPENED),
            Event(board_id=board, kind=EventKind.WRITE_ADMITTED, sequence=1, agent="a"),
        ],
    )
    database.run(
        "UPDATE xray_events SET received_at = now() - make_interval(days => %s)"
        " WHERE board_id = %s",
        (age_days, board),
    )
    database.run(
        "UPDATE xray_runs SET last_event_at = now() - make_interval(days => %s)"
        " WHERE board_id = %s",
        (age_days, board),
    )


class TestRetention:
    def test_a_project_with_no_window_keeps_everything(
        self, database: Any, world: Any
    ) -> None:
        # Which is what a project does until somebody decides otherwise.
        put(database, world.project.id, "old", 400)
        assert sweep(database).events == 0
        assert database.rows("SELECT count(*)::int AS n FROM xray_runs")[0]["n"] == 1

    def test_what_is_older_than_the_window_goes(
        self, database: Any, world: Any
    ) -> None:
        put(database, world.project.id, "old", 40)
        put(database, world.project.id, "recent", 2)
        world.people.set_retention(world.project.id, 30)

        swept = sweep(database)
        assert swept.events == 2
        assert swept.runs == 1

        left = [
            row["board_id"] for row in database.rows("SELECT board_id FROM xray_runs")
        ]
        assert left == ["recent"]

    def test_sweeping_again_finds_nothing(self, database: Any, world: Any) -> None:
        put(database, world.project.id, "old", 40)
        world.people.set_retention(world.project.id, 30)
        sweep(database)
        assert not sweep(database).anything

    def test_one_project_keeping_things_does_not_protect_another(
        self, database: Any, world: Any
    ) -> None:
        other = world.people.create_project(
            world.org.id, "staging", "Staging", world.owner.id
        )
        put(database, world.project.id, "swept", 40)
        put(database, other.id, "kept", 40)
        world.people.set_retention(world.project.id, 30)

        sweep(database)
        left = {
            row["board_id"] for row in database.rows("SELECT board_id FROM xray_runs")
        }
        assert left == {"kept"}

    def test_expired_sessions_go_too(self, database: Any, world: Any) -> None:
        signed = world.people.sign_in("owner@example.com", PASSWORD)
        assert signed is not None
        database.run("UPDATE xray_sessions SET expires_at = now() - interval '1 day'")
        assert sweep(database).sessions == 1


class TestIngestLimits:
    def test_a_sender_within_the_rate_is_not_delayed(self) -> None:
        limiter = Limiter(rate=100.0, burst=100.0)
        assert limiter.take("k", 50) == 0.0
        assert limiter.take("k", 50) == 0.0

    def test_a_sender_past_the_burst_is_told_how_long_to_wait(self) -> None:
        limiter = Limiter(rate=100.0, burst=100.0)
        limiter.take("k", 100)
        wait = limiter.take("k", 50)
        assert 0.4 < wait < 0.6

    def test_one_key_does_not_spend_another_key_s_allowance(self) -> None:
        limiter = Limiter(rate=100.0, burst=100.0)
        limiter.take("one", 100)
        assert limiter.take("two", 100) == 0.0

    def test_a_batch_larger_than_the_whole_bucket_waits_for_a_full_one(
        self,
    ) -> None:
        # Refusing it for ever would mean a batch bigger than the burst could
        # never be sent at all. Letting it straight through, which is what this
        # did first, meant a sender whose batches were all oversized was never
        # limited at any rate.
        limiter = Limiter(rate=10.0, burst=10.0)
        assert limiter.take("k", 500) == 0.0
        assert limiter.take("k", 500) > 0.0

    def test_the_platform_answers_429_with_a_retry_after(
        self, client: Any, world: Any, database: Any, dsn: str
    ) -> None:
        # The client reads this header, waits, and sends the same batch again,
        # so being limited costs a delay rather than the events.
        settings = Settings(database_url=dsn, ingest_rate=1.0, ingest_burst=1.0)
        with TestClient(build(settings, database=database)) as tight:
            body = {
                "events": [
                    Event(board_id="b", kind=EventKind.RUN_OPENED).to_json()
                    for _ in range(5)
                ]
            }
            headers = {"authorization": f"Bearer {world.key.value}"}
            tight.post("/api/v1/ingest", json=body, headers=headers)
            answer = tight.post("/api/v1/ingest", json=body, headers=headers)
            assert answer.status_code == 429
            assert answer.json()["error"] == "too_fast"
            assert int(answer.headers["retry-after"]) >= 1


class TestTheRecordOfWhatChanged:
    def test_making_a_key_is_recorded_with_who_made_it(
        self, client: Any, world: Any
    ) -> None:
        client.post(
            f"/api/v1/projects/{world.project.public_id}/keys", json={"name": "ci-2"}
        )
        entries = client.get(f"/api/v1/orgs/{world.org.public_id}/audit").json()[
            "entries"
        ]
        assert entries[0]["action"] == "key.created"
        assert entries[0]["actor_email"] == "owner@example.com"
        assert entries[0]["target"] == "ci-2"

    def test_a_role_change_records_what_it_was_and_what_it_became(
        self, client: Any, world: Any
    ) -> None:
        # A role change nobody can attribute is a role change nobody can review.
        other = world.people.create_user("other@example.com", PASSWORD)
        world.people.set_member_role(world.org.id, other.id, Role.MEMBER)
        client.patch(
            f"/api/v1/orgs/{world.org.public_id}/members/{other.public_id}",
            json={"role": "admin"},
        )
        entries = client.get(f"/api/v1/orgs/{world.org.public_id}/audit").json()[
            "entries"
        ]
        assert entries[0]["action"] == "member.role_changed"
        assert entries[0]["detail"] == {"from": "member", "to": "admin"}
        assert entries[0]["target"] == "other@example.com"

    def test_deleting_a_project_leaves_the_line_that_says_who_did_it(
        self, client: Any, world: Any
    ) -> None:
        # The project's own rows go with it, so the line is written first and
        # points at nothing afterwards. It still says who.
        client.delete(f"/api/v1/projects/{world.project.public_id}")
        entries = client.get(f"/api/v1/orgs/{world.org.public_id}/audit").json()[
            "entries"
        ]
        assert entries[0]["action"] == "project.deleted"
        assert entries[0]["target"] == "Production"

    def test_reading_is_not_recorded(self, client: Any, world: Any) -> None:
        # A row per page view would be most of this table and answers nothing.
        client.get(f"/api/v1/projects/{world.project.public_id}/runs")
        client.get(f"/api/v1/projects/{world.project.public_id}/overview")
        entries = client.get(f"/api/v1/orgs/{world.org.public_id}/audit").json()[
            "entries"
        ]
        assert entries == []

    def test_a_member_may_not_read_the_record(self, client: Any, world: Any) -> None:
        member = world.people.create_user("member@example.com", PASSWORD)
        world.people.set_member_role(world.org.id, member.id, Role.MEMBER)
        client.post(
            "/api/v1/auth/signin",
            json={"email": "member@example.com", "password": PASSWORD},
        )
        answer = client.get(f"/api/v1/orgs/{world.org.public_id}/audit")
        assert answer.status_code == 403


class TestRequestIdentifiers:
    def test_every_answer_carries_one(self, client: Any) -> None:
        answer = client.get("/api/v1/health")
        assert answer.headers["x-request-id"]

    def test_one_the_caller_gave_is_kept(self, client: Any) -> None:
        # A request traced through a proxy keeps the name it had there.
        answer = client.get(
            "/api/v1/health", headers={"x-request-id": "from-the-proxy"}
        )
        assert answer.headers["x-request-id"] == "from-the-proxy"


class TestTheSweeperIsActuallyRunning:
    """That it works when called is not the same as that anything calls it.

    The sweeper was written, unit tested and never started. Retention was a
    window a project could set, an interface that offered it, and documentation
    that described it, with nothing anywhere acting on any of it. Every test
    called `sweep` directly and every one of them passed.
    """

    def test_the_application_starts_it(self, database: Any, dsn: str) -> None:
        settings = Settings(database_url=dsn)
        app = build(settings, database=database)
        with TestClient(app):
            running = [
                one
                for one in threading.enumerate()
                if one.name == "blackboardxray-upkeep"
            ]
            assert running, "the application came up without its sweeper"
            assert running[0].daemon

    def test_it_stops_when_the_application_does(self, database: Any, dsn: str) -> None:
        # A container being replaced must not have a chunked delete killed
        # halfway through one.
        settings = Settings(database_url=dsn)
        with TestClient(build(settings, database=database)):
            pass
        for _ in range(50):
            alive = [
                one
                for one in threading.enumerate()
                if one.name == "blackboardxray-upkeep" and one.is_alive()
            ]
            if not alive:
                return
            time.sleep(0.1)
        raise AssertionError("the sweeper outlived the application")
