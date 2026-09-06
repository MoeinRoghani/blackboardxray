"""Ingestion and the read API, against a real Postgres."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from typing import Any

import pytest
from fastapi.testclient import TestClient

from blackboardxray.events import Event, EventKind
from blackboardxray.server.app import MAX_BATCH, build
from blackboardxray.server.settings import Settings

PASSWORD = "a long enough phrase"


@pytest.fixture
def client(database: Any, dsn: str):
    settings = Settings(database_url=dsn)
    with TestClient(build(settings, database=database)) as made:
        yield made


@pytest.fixture
def owner(database: Any):
    """The person who set the install up, and what they own."""
    people = database.people
    user = people.create_user("owner@example.com", PASSWORD, "Owner")
    organization = people.create_organization("acme", "Acme", user.id)
    project = people.create_project(
        organization.id, "production", "Production", user.id
    )
    return SimpleNamespace(
        user=user, organization=organization, project=project, people=people
    )


@pytest.fixture
def project(owner: Any) -> str:
    """The identifier every data route is scoped by."""
    return owner.project.public_id


@pytest.fixture
def token(owner: Any) -> str:
    return owner.people.issue_key(owner.project.id, "test").value


@pytest.fixture
def signed_in(client: Any, owner: Any):
    """A client carrying a session cookie. Origin set, as a browser sends one."""
    client.headers["origin"] = "http://testserver"
    answer = client.post(
        "/api/v1/auth/signin",
        json={"email": "owner@example.com", "password": PASSWORD},
    )
    assert answer.status_code == 200, answer.text
    return client


def an_event(board_id: str, kind: str = EventKind.WRITE_ADMITTED, **rest: Any) -> dict:
    return Event(board_id=board_id, kind=kind, **rest).to_json()


def sum_of(bucket: dict) -> int:
    return bucket["open"] + bucket["settled"] + bucket["aborted"] + bucket["expired"]


def send(client: Any, token: str, events: list[dict]) -> Any:
    return client.post(
        "/api/v1/ingest",
        json={"events": events},
        headers={"authorization": f"Bearer {token}"},
    )


class TestIngestion:
    def test_a_batch_is_stored(
        self, signed_in, client, token, project, board_id
    ) -> None:
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
        self, signed_in, client, token, project, board_id
    ) -> None:
        # A batch resent after a timeout adds nothing, so the counters do not
        # double and a retry is free.
        events = [an_event(board_id, sequence=1), an_event(board_id, sequence=2)]
        assert send(client, token, events).json()["stored"] == 2
        again = send(client, token, events).json()
        assert again["stored"] == 0
        assert again["repeated"] == 2
        run = signed_in.get(f"/api/v1/projects/{project}/runs/{board_id}").json()
        assert run["n_writes"] == 2
        assert run["n_events"] == 2

    def test_one_unreadable_event_does_not_cost_the_batch(
        self, signed_in, client, token, project, board_id
    ) -> None:
        answer = send(
            client, token, [an_event(board_id), {"kind": "no board here"}]
        ).json()
        assert answer["stored"] == 1
        assert answer["unreadable"] == 1

    def test_a_wrong_token_is_refused(
        self, signed_in, client, project, board_id
    ) -> None:
        answer = send(client, "bxr_not_a_key", [an_event(board_id)])
        assert answer.status_code == 401
        assert answer.json()["error"] == "unknown_token"

    def test_no_token_is_refused(self, signed_in, client, project, board_id) -> None:
        assert (
            client.post(
                "/api/v1/ingest", json={"events": [an_event(board_id)]}
            ).status_code
            == 401
        )

    def test_a_body_that_is_not_a_batch_is_refused(
        self, signed_in, client, token, project
    ) -> None:
        answer = client.post(
            "/api/v1/ingest",
            json={"nope": []},
            headers={"authorization": f"Bearer {token}"},
        )
        assert answer.status_code == 400
        assert answer.json()["error"] == "unreadable_body"

    def test_a_batch_beyond_the_cap_is_refused(
        self, signed_in, client, token, project, board_id
    ) -> None:
        answer = send(client, token, [an_event(board_id)] * (MAX_BATCH + 1))
        assert answer.status_code == 413

    def test_opening_and_closing_fill_the_run(
        self, signed_in, client, token, project, board_id
    ) -> None:
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
        run = signed_in.get(f"/api/v1/projects/{project}/runs/{board_id}").json()
        assert run["outcome"] == "settled"
        assert run["unfinished"] == ["netops"]
        assert run["store"] == "PostgresStore"
        assert run["regions"][0]["name"] == "signals"


class TestReading:
    def test_a_run_that_was_never_sent_answers_404(
        self, signed_in, client, token, project
    ) -> None:
        answer = signed_in.get(f"/api/v1/projects/{project}/runs/never-existed")
        assert answer.status_code == 404
        assert answer.json()["error"] == "unknown_run"

    def test_the_runs_list_filters_by_outcome_and_by_agent(
        self, signed_in, client, token, project, board_id
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
        assert signed_in.get(f"/api/v1/projects/{project}/runs").json()["total"] == 2
        aborted = signed_in.get(
            f"/api/v1/projects/{project}/runs?outcome=aborted"
        ).json()
        assert [run["board_id"] for run in aborted["runs"]] == [board_id]
        assert (
            signed_in.get(f"/api/v1/projects/{project}/runs?outcome=open").json()[
                "total"
            ]
            == 1
        )
        by_agent = signed_in.get(f"/api/v1/projects/{project}/runs?agent=triage").json()
        assert [run["board_id"] for run in by_agent["runs"]] == [f"{board_id}-other"]

    def test_events_come_back_in_arrival_order_and_page(
        self, signed_in, client, token, project, board_id
    ) -> None:
        send(client, token, [an_event(board_id, sequence=n) for n in range(1, 8)])
        first = signed_in.get(
            f"/api/v1/projects/{project}/runs/{board_id}/events?limit=3"
        ).json()
        assert len(first["events"]) == 3
        assert first["has_more"] is True
        second = client.get(
            f"/api/v1/projects/{project}/runs/{board_id}/events?after={first['next_after']}"
        ).json()
        assert second["events"][0]["sequence"] == 4

    def test_events_filter_by_kind(
        self, signed_in, client, token, project, board_id
    ) -> None:
        send(
            client,
            token,
            [
                an_event(board_id, EventKind.WRITE_ADMITTED, sequence=1),
                an_event(board_id, EventKind.WRITE_REFUSED, agent="ocp"),
            ],
        )
        only = client.get(
            f"/api/v1/projects/{project}/runs/{board_id}/events?kind={EventKind.WRITE_REFUSED}"
        ).json()
        assert [one["kind"] for one in only["events"]] == [EventKind.WRITE_REFUSED]

    def test_an_agent_is_summarised_across_runs(
        self, signed_in, client, token, project, board_id
    ) -> None:
        for board in (board_id, f"{board_id}-two"):
            send(
                client,
                token,
                [
                    an_event(board, EventKind.WRITE_ADMITTED, sequence=1, agent="ocp"),
                    an_event(board, EventKind.WRITE_REFUSED, agent="ocp"),
                ],
            )
        agents = signed_in.get(f"/api/v1/projects/{project}/agents").json()["agents"]
        ocp = next(one for one in agents if one["agent"] == "ocp")
        assert ocp["runs"] == 2
        assert ocp["writes"] == 2
        assert ocp["refusals"] == 2

    def test_an_agents_answer_time_is_measured_from_its_own_notification(
        self, signed_in, client, token, project, board_id
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
        ocp = signed_in.get(f"/api/v1/projects/{project}/agents/ocp").json()
        assert ocp["dispatched"] == 1
        assert ocp["acked"] == 1
        assert ocp["median_response"] is not None

    def test_an_unknown_agent_answers_404(
        self, signed_in, client, token, project
    ) -> None:
        assert (
            signed_in.get(f"/api/v1/projects/{project}/agents/nobody").status_code
            == 404
        )

    def test_the_overview_counts_what_the_runs_hold(
        self, signed_in, client, token, project, board_id
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
        overview = signed_in.get(f"/api/v1/projects/{project}/overview").json()
        assert overview["runs"] == 1
        assert overview["settled"] == 1
        assert overview["writes"] == 1
        assert overview["failed"] == 1
        assert overview["with_unfinished"] == 1
        # The counts are integers, not strings a sum returned as numeric.
        assert isinstance(overview["writes"], int)

    def test_health_names_every_kind_the_platform_understands(
        self, signed_in, client, project
    ) -> None:
        health = client.get("/api/v1/health").json()
        assert health["status"] == "ok"
        assert health["kinds"] == list(EventKind.ALL)


class TestTheIndex:
    """The two aggregates the index is built on, and the range it selects."""

    def _a_day(self, client, token) -> None:
        """Opens four runs, one an hour apart, each ending differently."""
        now = datetime.now(UTC).replace(minute=0, second=0, microsecond=0)
        for hours, outcome in (
            (4, "settled"),
            (3, "settled"),
            (2, "aborted"),
            (1, None),
        ):
            opened = now - timedelta(hours=hours)
            board = f"board-{hours}"
            events = [
                an_event(board, EventKind.RUN_OPENED, at=opened),
                an_event(board, sequence=1, agent="ocp", region="signals", at=opened),
            ]
            if outcome is not None:
                events.append(
                    an_event(
                        board,
                        EventKind.RUN_CLOSED,
                        at=opened + timedelta(seconds=30),
                        body={"outcome": outcome, "unfinished": ["changelog"]},
                    )
                )
            send(client, token, events)

    def test_an_interval_with_no_run_arrives_as_a_zero(
        self, signed_in, client, token, project
    ) -> None:
        # The chart is continuous. A missing bucket and a quiet one look the
        # same once they are drawn side by side, and the quiet one is the
        # reading an operator most needs.
        self._a_day(client, token)
        answer = signed_in.get(
            f"/api/v1/projects/{project}/histogram?step=3600&buckets=6"
        ).json()
        assert len(answer["buckets"]) == 6
        assert all(
            {"open", "settled", "aborted", "expired"} <= set(bucket)
            for bucket in answer["buckets"]
        )
        assert any(sum_of(bucket) == 0 for bucket in answer["buckets"])

    def test_a_run_is_counted_in_the_interval_it_opened_in(
        self, signed_in, client, token, project
    ) -> None:
        self._a_day(client, token)
        answer = signed_in.get(
            f"/api/v1/projects/{project}/histogram?step=3600&buckets=6"
        ).json()
        assert sum(sum_of(bucket) for bucket in answer["buckets"]) == 4
        assert sum(bucket["settled"] for bucket in answer["buckets"]) == 2
        assert sum(bucket["aborted"] for bucket in answer["buckets"]) == 1
        assert sum(bucket["open"] for bucket in answer["buckets"]) == 1

    def test_the_bars_do_not_slide_between_two_reads(
        self, signed_in, client, token, project
    ) -> None:
        # The grid is anchored to the epoch and not to now, so a chart redrawn
        # a second later has the same boundaries.
        self._a_day(client, token)
        first = signed_in.get(
            f"/api/v1/projects/{project}/histogram?step=3600&buckets=6"
        ).json()
        second = signed_in.get(
            f"/api/v1/projects/{project}/histogram?step=3600&buckets=6"
        ).json()
        assert [b["at"] for b in first["buckets"]] == [
            b["at"] for b in second["buckets"]
        ]

    def test_a_facet_count_ignores_its_own_filter(
        self, signed_in, client, token, project
    ) -> None:
        # A count taken with its own filter applied reads one for the choice
        # already made and zero for every other, which tells nobody where to go.
        self._a_day(client, token)
        facets = signed_in.get(f"/api/v1/projects/{project}/facets").json()
        assert facets["total"] == 4
        assert facets["settled"] == 2
        assert facets["aborted"] == 1
        assert facets["open"] == 1
        assert facets["unfinished"] == 3
        assert [one["name"] for one in facets["agents"]] == ["ocp"]

    def test_a_facet_count_honours_every_other_filter(
        self, signed_in, client, token, project
    ) -> None:
        self._a_day(client, token)
        assert (
            signed_in.get(f"/api/v1/projects/{project}/facets?agent=ocp").json()[
                "total"
            ]
            == 4
        )
        assert (
            signed_in.get(f"/api/v1/projects/{project}/facets?agent=netops").json()[
                "total"
            ]
            == 0
        )
        assert (
            signed_in.get(f"/api/v1/projects/{project}/facets?search=board-2").json()[
                "total"
            ]
            == 1
        )

    def test_a_range_is_half_open(self, signed_in, client, token, project) -> None:
        # A run opened exactly on a bar's right edge belongs to the next bar.
        # Closing both ends would count it in two.
        self._a_day(client, token)
        buckets = signed_in.get(
            f"/api/v1/projects/{project}/histogram?step=3600&buckets=6"
        ).json()["buckets"]
        busy = next(b for b in buckets if sum_of(b) > 0)
        edge = datetime.fromisoformat(busy["at"])
        inside = client.get(
            f"/api/v1/projects/{project}/runs?since={edge.isoformat()}"
            f"&until={(edge + timedelta(hours=1)).isoformat()}"
        ).json()
        later = edge + timedelta(hours=1)
        after = client.get(
            f"/api/v1/projects/{project}/runs?since={later.isoformat()}"
            f"&until={(later + timedelta(hours=1)).isoformat()}"
        ).json()
        assert inside["total"] == sum_of(busy)
        assert not {r["board_id"] for r in inside["runs"]} & {
            r["board_id"] for r in after["runs"]
        }

    def test_the_table_and_the_chart_agree_on_an_interval(
        self, signed_in, client, token, project
    ) -> None:
        # Selecting a bar has to show the runs the bar counted. Two queries
        # that disagree would make the chart a decoration.
        self._a_day(client, token)
        buckets = signed_in.get(
            f"/api/v1/projects/{project}/histogram?step=3600&buckets=6"
        ).json()["buckets"]
        for bucket in buckets:
            since = datetime.fromisoformat(bucket["at"])
            listed = client.get(
                f"/api/v1/projects/{project}/runs?since={since.isoformat()}"
                f"&until={(since + timedelta(hours=1)).isoformat()}"
            ).json()
            assert listed["total"] == sum_of(bucket)

    def test_unfinished_narrows_the_list(
        self, signed_in, client, token, project
    ) -> None:
        self._a_day(client, token)
        assert (
            signed_in.get(f"/api/v1/projects/{project}/runs?unfinished=true").json()[
                "total"
            ]
            == 3
        )
        assert signed_in.get(f"/api/v1/projects/{project}/runs").json()["total"] == 4

    def test_a_bucket_count_past_what_a_chart_can_draw_is_refused(
        self, signed_in, client, token, project
    ) -> None:
        assert (
            signed_in.get(
                f"/api/v1/projects/{project}/histogram?buckets=1000"
            ).status_code
            == 422
        )


class TestProjects:
    def test_a_project_this_person_is_not_in_is_not_found(
        self, signed_in, project
    ) -> None:
        # The same answer as a project that does not exist. A different one
        # would let a stranger confirm which projects a deployment holds.
        assert (
            signed_in.get("/api/v1/projects/proj_invented/overview").status_code == 404
        )

    def test_two_projects_do_not_share_a_board_identifier(
        self, signed_in, client, database, owner, board_id
    ) -> None:
        people = database.people
        other = people.create_project(
            owner.organization.id, "staging", "Staging", owner.user.id
        )
        first = people.issue_key(owner.project.id, "one").value
        second = people.issue_key(other.id, "two").value
        send(client, first, [an_event(board_id, sequence=1, agent="ocp")])
        send(client, second, [an_event(board_id, sequence=9, agent="netops")])

        here = signed_in.get(
            f"/api/v1/projects/{owner.project.public_id}/runs/{board_id}"
        ).json()
        there = signed_in.get(
            f"/api/v1/projects/{other.public_id}/runs/{board_id}"
        ).json()
        assert here["last_sequence"] == 1
        assert there["last_sequence"] == 9
        assert here["agents"] == ["ocp"]
        assert there["agents"] == ["netops"]

    def test_a_key_is_stored_as_a_hash_and_never_read_back(
        self, database, owner
    ) -> None:
        issued = database.people.issue_key(owner.project.id, "test")
        listed = database.people.list_keys(owner.project.id)
        assert issued.value not in str(listed)
        rows = database.rows("SELECT token_hash FROM xray_api_keys")
        assert all(row["token_hash"] != issued.value for row in rows)

    def test_a_revoked_key_stops_sending(
        self, client, database, owner, board_id
    ) -> None:
        # The whole point of revocation. A key that still ingests after being
        # revoked is a key that was never revoked.
        issued = database.people.issue_key(owner.project.id, "doomed")
        assert send(client, issued.value, [an_event(board_id)]).status_code == 202
        public = next(
            one["id"]
            for one in database.people.list_keys(owner.project.id)
            if one["name"] == "doomed"
        )
        database.people.revoke_key(owner.project.id, public)
        assert send(client, issued.value, [an_event(board_id)]).status_code == 401
