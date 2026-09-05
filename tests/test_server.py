"""Ingestion and the read API, against a real Postgres."""

from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient

from blackboardxray.events import Event, EventKind
from blackboardxray.server.app import MAX_BATCH, build
from blackboardxray.server.settings import Settings


@pytest.fixture
def client(database: Any, dsn: str):
    settings = Settings(database_url=dsn)
    with TestClient(build(settings, database=database)) as made:
        yield made


@pytest.fixture
def token(database: Any) -> str:
    project = database.create_project("production", "Production")
    return database.issue_key(project.id, "test").token


def an_event(board_id: str, kind: str = EventKind.WRITE_ADMITTED, **rest: Any) -> dict:
    return Event(board_id=board_id, kind=kind, **rest).to_json()


def send(client: Any, token: str, events: list[dict]) -> Any:
    return client.post(
        "/api/v1/ingest",
        json={"events": events},
        headers={"authorization": f"Bearer {token}"},
    )


class TestIngestion:
    def test_a_batch_is_stored(self, client, token, board_id) -> None:
        answer = send(
            client,
            token,
            [
                an_event(board_id, EventKind.RUN_OPENED),
                an_event(board_id, sequence=1, agent="ocp", region="signals"),
            ],
        )
        assert answer.status_code == 202
        assert answer.json()["stored"] == 2

    def test_an_identifier_is_written_once_however_many_times_it_arrives(
        self, client, token, board_id
    ) -> None:
        # A batch resent after a timeout adds nothing, so the counters do not
        # double and a retry is free.
        events = [an_event(board_id, sequence=1), an_event(board_id, sequence=2)]
        assert send(client, token, events).json()["stored"] == 2
        again = send(client, token, events).json()
        assert again["stored"] == 0
        assert again["repeated"] == 2
        run = client.get(f"/api/v1/runs/{board_id}").json()
        assert run["n_writes"] == 2
        assert run["n_events"] == 2

    def test_one_unreadable_event_does_not_cost_the_batch(
        self, client, token, board_id
    ) -> None:
        answer = send(
            client, token, [an_event(board_id), {"kind": "no board here"}]
        ).json()
        assert answer["stored"] == 1
        assert answer["unreadable"] == 1

    def test_a_wrong_token_is_refused(self, client, board_id) -> None:
        answer = send(client, "bxr_not_a_key", [an_event(board_id)])
        assert answer.status_code == 401
        assert answer.json()["error"] == "unknown_token"

    def test_no_token_is_refused(self, client, board_id) -> None:
        assert (
            client.post(
                "/api/v1/ingest", json={"events": [an_event(board_id)]}
            ).status_code
            == 401
        )

    def test_a_body_that_is_not_a_batch_is_refused(self, client, token) -> None:
        answer = client.post(
            "/api/v1/ingest",
            json={"nope": []},
            headers={"authorization": f"Bearer {token}"},
        )
        assert answer.status_code == 400
        assert answer.json()["error"] == "unreadable_body"

    def test_a_batch_beyond_the_cap_is_refused(self, client, token, board_id) -> None:
        answer = send(client, token, [an_event(board_id)] * (MAX_BATCH + 1))
        assert answer.status_code == 413

    def test_opening_and_closing_fill_the_run(self, client, token, board_id) -> None:
        send(
            client,
            token,
            [
                an_event(
                    board_id,
                    EventKind.RUN_OPENED,
                    body={
                        "regions": [{"name": "signals", "kind": "level"}],
                        "limits": {"wall_clock_seconds": 60, "idle_seconds": 5},
                        "store": "PostgresStore",
                    },
                ),
                an_event(
                    board_id,
                    EventKind.RUN_CLOSED,
                    body={
                        "outcome": "settled",
                        "reason": None,
                        "unfinished": ["netops"],
                    },
                ),
            ],
        )
        run = client.get(f"/api/v1/runs/{board_id}").json()
        assert run["outcome"] == "settled"
        assert run["unfinished"] == ["netops"]
        assert run["store"] == "PostgresStore"
        assert run["regions"][0]["name"] == "signals"


class TestReading:
    def test_a_run_that_was_never_sent_answers_404(self, client, token) -> None:
        answer = client.get("/api/v1/runs/never-existed")
        assert answer.status_code == 404
        assert answer.json()["error"] == "unknown_run"

    def test_the_runs_list_filters_by_outcome_and_by_agent(
        self, client, token, board_id
    ) -> None:
        send(
            client,
            token,
            [
                an_event(board_id, sequence=1, agent="ocp"),
                an_event(
                    board_id,
                    EventKind.RUN_CLOSED,
                    body={
                        "outcome": "aborted",
                        "reason": "rolled back",
                        "unfinished": [],
                    },
                ),
                an_event(f"{board_id}-other", sequence=1, agent="triage"),
            ],
        )
        assert client.get("/api/v1/runs").json()["total"] == 2
        aborted = client.get("/api/v1/runs?outcome=aborted").json()
        assert [run["board_id"] for run in aborted["runs"]] == [board_id]
        assert client.get("/api/v1/runs?outcome=open").json()["total"] == 1
        by_agent = client.get("/api/v1/runs?agent=triage").json()
        assert [run["board_id"] for run in by_agent["runs"]] == [f"{board_id}-other"]

    def test_events_come_back_in_arrival_order_and_page(
        self, client, token, board_id
    ) -> None:
        send(client, token, [an_event(board_id, sequence=n) for n in range(1, 8)])
        first = client.get(f"/api/v1/runs/{board_id}/events?limit=3").json()
        assert len(first["events"]) == 3
        assert first["has_more"] is True
        second = client.get(
            f"/api/v1/runs/{board_id}/events?after={first['next_after']}"
        ).json()
        assert second["events"][0]["sequence"] == 4

    def test_events_filter_by_kind(self, client, token, board_id) -> None:
        send(
            client,
            token,
            [
                an_event(board_id, EventKind.WRITE_ADMITTED, sequence=1),
                an_event(board_id, EventKind.WRITE_REFUSED, agent="ocp"),
            ],
        )
        only = client.get(
            f"/api/v1/runs/{board_id}/events?kind={EventKind.WRITE_REFUSED}"
        ).json()
        assert [one["kind"] for one in only["events"]] == [EventKind.WRITE_REFUSED]

    def test_an_agent_is_summarised_across_runs(self, client, token, board_id) -> None:
        for board in (board_id, f"{board_id}-two"):
            send(
                client,
                token,
                [
                    an_event(board, EventKind.WRITE_ADMITTED, sequence=1, agent="ocp"),
                    an_event(board, EventKind.WRITE_REFUSED, agent="ocp"),
                ],
            )
        agents = client.get("/api/v1/agents").json()["agents"]
        ocp = next(one for one in agents if one["agent"] == "ocp")
        assert ocp["runs"] == 2
        assert ocp["writes"] == 2
        assert ocp["refusals"] == 2

    def test_an_agents_answer_time_is_measured_from_its_own_notification(
        self, client, token, board_id
    ) -> None:
        send(
            client,
            token,
            [
                Event(
                    board_id=board_id,
                    kind=EventKind.NOTIFICATION_DISPATCHED,
                    agent="ocp",
                    body={"notification_id": 1, "from_sequence": 1, "to_sequence": 2},
                ).to_json(),
                Event(
                    board_id=board_id,
                    kind=EventKind.NOTIFICATION_ACKNOWLEDGED,
                    agent="ocp",
                    body={"notification_id": 1},
                ).to_json(),
            ],
        )
        ocp = client.get("/api/v1/agents/ocp").json()
        assert ocp["dispatched"] == 1
        assert ocp["acked"] == 1
        assert ocp["median_response"] is not None

    def test_an_unknown_agent_answers_404(self, client, token) -> None:
        assert client.get("/api/v1/agents/nobody").status_code == 404

    def test_the_overview_counts_what_the_runs_hold(
        self, client, token, board_id
    ) -> None:
        send(
            client,
            token,
            [
                an_event(board_id, EventKind.WRITE_ADMITTED, sequence=1, agent="ocp"),
                an_event(board_id, EventKind.NOTIFICATION_FAILED, agent="changelog"),
                an_event(
                    board_id,
                    EventKind.RUN_CLOSED,
                    body={
                        "outcome": "settled",
                        "reason": None,
                        "unfinished": ["changelog"],
                    },
                ),
            ],
        )
        overview = client.get("/api/v1/overview").json()
        assert overview["runs"] == 1
        assert overview["settled"] == 1
        assert overview["writes"] == 1
        assert overview["failed"] == 1
        assert overview["with_unfinished"] == 1
        # The counts are integers, not strings a sum returned as numeric.
        assert isinstance(overview["writes"], int)

    def test_health_names_every_kind_the_platform_understands(self, client) -> None:
        health = client.get("/api/v1/health").json()
        assert health["status"] == "ok"
        assert health["kinds"] == list(EventKind.ALL)


class TestProjects:
    def test_a_read_names_the_only_project_without_being_told(
        self, client, token
    ) -> None:
        assert client.get("/api/v1/overview").json()["project"] == "production"

    def test_a_project_that_does_not_exist_answers_404(self, client, token) -> None:
        answer = client.get("/api/v1/overview?project=staging")
        assert answer.status_code == 404
        assert answer.json()["error"] == "unknown_project"

    def test_two_projects_do_not_share_a_board_identifier(
        self, client, database, token, board_id
    ) -> None:
        other = database.create_project("staging")
        second = database.issue_key(other.id, "test").token
        send(client, token, [an_event(board_id, sequence=1, agent="ocp")])
        send(client, second, [an_event(board_id, sequence=9, agent="netops")])
        production = client.get(f"/api/v1/runs/{board_id}?project=production").json()
        staging = client.get(f"/api/v1/runs/{board_id}?project=staging").json()
        assert production["last_sequence"] == 1
        assert staging["last_sequence"] == 9
        assert production["agents"] == ["ocp"]
        assert staging["agents"] == ["netops"]

    def test_a_key_is_stored_as_a_hash_and_never_read_back(
        self, database, token
    ) -> None:
        project = database.list_projects()[0]
        keys = database.list_keys(project["id"])
        assert keys[0]["prefix"] == token[:10]
        assert "token" not in keys[0]
        assert token not in str(keys[0])
