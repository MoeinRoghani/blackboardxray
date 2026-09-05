"""The wrappers, against a real run.

Nothing is faked but the transport. A real `blackboard` model is created
through `Xray.create_model`, real agents write and acknowledge through the
objects the library hands them, and the assertions are about what the wrappers
recorded.
"""

from __future__ import annotations

from datetime import timedelta
from typing import Any

import pytest
from blackboard import (
    Accept,
    Agent,
    InMemoryStore,
    Level,
    Notification,
    Premise,
    ProposedContribution,
    ProposedWrite,
    Reject,
    RunLimits,
    Settled,
    Written,
)

from blackboardxray.events import EventKind
from blackboardxray.observe import Xray


class Collected:
    """A transport that keeps every event instead of sending it."""

    def __init__(self) -> None:
        self.events: list[dict[str, Any]] = []

    def send(self, url: str, token: str, batch: list[dict[str, Any]]) -> None:
        self.events.extend(batch)

    def close(self) -> None:
        return None

    def kinds(self) -> list[str]:
        return [one["kind"] for one in self.events]

    def of(self, kind: str) -> list[dict[str, Any]]:
        return [one for one in self.events if one["kind"] == kind]


@pytest.fixture
def collected() -> Collected:
    return Collected()


@pytest.fixture
def xray(collected: Collected):
    instance = Xray(
        endpoint="http://platform",
        token="bxr_test",
        content_limit=1024,
        transport=collected,
        flush_interval=0.05,
    )
    yield instance
    instance.close(5)


def regions() -> list[Level | Premise]:
    return [Level("signals"), Level("findings"), Premise("severity")]


def test_a_run_records_its_shape_when_it_opens(
    xray: Xray, collected: Collected
) -> None:
    xray.create_model(
        board_id="b1",
        store=InMemoryStore(),
        regions=regions(),
        premises={"severity": "sev2"},
        agents=[Agent(name="ocp", notify=lambda notification: None)],
        limits=RunLimits(wall_clock=timedelta(seconds=30), idle=timedelta(seconds=30)),
    )
    xray.flush(5)
    opened = collected.of(EventKind.RUN_OPENED)
    assert len(opened) == 1
    body = opened[0]["body"]
    assert [region["name"] for region in body["regions"]] == [
        "signals",
        "findings",
        "severity",
    ]
    assert body["limits"]["wall_clock_seconds"] == 30
    assert body["store"] == "InMemoryStore"
    assert body["has_admission_rule"] is False
    assert [one["name"] for one in body["agents"]] == ["ocp"]
    assert collected.of(EventKind.AGENT_REGISTERED)[0]["body"]["at_creation"] is True


def test_a_write_and_its_notification_and_its_acknowledgment_are_recorded(
    xray: Xray, collected: Collected
) -> None:
    seen: list[Notification] = []
    model = xray.create_model(
        board_id="b2",
        store=InMemoryStore(),
        regions=regions(),
        premises={"severity": "sev2"},
        agents=[Agent(name="ocp", notify=seen.append, subscribes_to={"signals"})],
        limits=RunLimits(wall_clock=timedelta(seconds=30), idle=timedelta(seconds=30)),
    )
    result = model.control.write("signals", {"alert": "oom"}, writer="triage")
    assert isinstance(result, Written)
    assert seen, "the agent subscribed to signals and should have been woken"
    model.control.ack(seen[-1].notification_id, agent="ocp")
    xray.flush(5)

    admitted = collected.of(EventKind.WRITE_ADMITTED)
    assert len(admitted) == 1
    assert admitted[0]["agent"] == "triage"
    assert admitted[0]["region"] == "signals"
    assert admitted[0]["sequence"] == result.sequence
    assert admitted[0]["body"]["content"]["content"] == {"alert": "oom"}

    dispatched = collected.of(EventKind.NOTIFICATION_DISPATCHED)
    assert dispatched and dispatched[0]["agent"] == "ocp"
    # A notification carries no values and changes nothing on the board, so it
    # takes no address. This is what keeps it off the spine.
    assert dispatched[0]["sequence"] is None
    assert dispatched[0]["body"]["to_sequence"] == result.sequence

    acknowledged = collected.of(EventKind.NOTIFICATION_ACKNOWLEDGED)
    assert acknowledged and acknowledged[0]["agent"] == "ocp"


def test_a_refusal_carries_the_rules_own_reason(
    xray: Xray, collected: Collected
) -> None:
    def refuse(proposed: ProposedWrite, reader: object) -> Accept | Reject:
        if isinstance(proposed, ProposedContribution) and proposed.level == "findings":
            return Reject(reason="a finding below 0.5 confidence is not admitted")
        return Accept()

    model = xray.create_model(
        board_id="b3",
        store=InMemoryStore(),
        regions=regions(),
        premises={"severity": "sev2"},
        admission_rule=refuse,
        limits=RunLimits(wall_clock=timedelta(seconds=30), idle=timedelta(seconds=30)),
    )
    model.control.write("findings", {"confidence": 0.1}, writer="ocp")
    xray.flush(5)

    refused = collected.of(EventKind.WRITE_REFUSED)
    assert len(refused) == 1
    assert (
        refused[0]["body"]["reason"] == "a finding below 0.5 confidence is not admitted"
    )
    assert refused[0]["body"]["cause"] == "admission"
    # A refused write never reached the board, so it took no sequence number.
    assert refused[0]["sequence"] is None


def test_a_premise_that_moved_is_recorded_as_a_conflict(
    xray: Xray, collected: Collected
) -> None:
    model = xray.create_model(
        board_id="b4",
        store=InMemoryStore(),
        regions=regions(),
        premises={"severity": "sev2"},
        limits=RunLimits(wall_clock=timedelta(seconds=30), idle=timedelta(seconds=30)),
    )
    at = model.reader.read_premise("severity").version
    model.control.set_premise("severity", "sev1", at, writer="ocp")
    model.control.set_premise("severity", "sev3", at, writer="dependency")
    xray.flush(5)

    assert len(collected.of(EventKind.PREMISE_SET)) == 1
    conflicted = collected.of(EventKind.WRITE_CONFLICTED)
    assert len(conflicted) == 1
    assert conflicted[0]["body"]["expected_version"] == at
    assert conflicted[0]["body"]["current_version"] == at + 1


def test_a_delivery_that_raised_is_recorded_and_still_contained(
    xray: Xray, collected: Collected
) -> None:
    def unreachable(notification: Notification) -> None:
        raise ConnectionError("the agent is not answering on port 8081")

    model = xray.create_model(
        board_id="b5",
        store=InMemoryStore(),
        regions=regions(),
        premises={"severity": "sev2"},
        agents=[Agent(name="changelog", notify=unreachable, subscribes_to={"signals"})],
        limits=RunLimits(wall_clock=timedelta(seconds=30), idle=timedelta(seconds=30)),
    )
    # The control component contains the exception, so the write still lands.
    assert isinstance(
        model.control.write("signals", {"a": 1}, writer="triage"), Written
    )
    xray.flush(5)

    failed = collected.of(EventKind.NOTIFICATION_FAILED)
    assert len(failed) == 1
    assert failed[0]["agent"] == "changelog"
    assert failed[0]["body"]["error"] == "ConnectionError"
    assert "8081" in failed[0]["body"]["detail"]


def test_the_outcome_is_recorded_and_a_callers_own_callback_still_runs(
    xray: Xray, collected: Collected
) -> None:
    told: list[object] = []
    model = xray.create_model(
        board_id="b6",
        store=InMemoryStore(),
        regions=regions(),
        premises={"severity": "sev2"},
        limits=RunLimits(
            wall_clock=timedelta(seconds=30), idle=timedelta(milliseconds=80)
        ),
        on_closed=told.append,
    )
    assert isinstance(model.control.wait_closed(timedelta(seconds=10)), Settled)
    xray.flush(5)

    closed = collected.of(EventKind.RUN_CLOSED)
    assert len(closed) == 1
    assert closed[0]["body"]["outcome"] == "settled"
    # Chained rather than replaced.
    assert len(told) == 1


def test_an_agent_that_joins_later_is_recorded(
    xray: Xray, collected: Collected
) -> None:
    model = xray.create_model(
        board_id="b7",
        store=InMemoryStore(),
        regions=regions(),
        premises={"severity": "sev2"},
        limits=RunLimits(wall_clock=timedelta(seconds=30), idle=timedelta(seconds=30)),
    )
    model.control.register_agent(Agent(name="netops", notify=lambda n: None))
    xray.flush(5)

    registered = collected.of(EventKind.AGENT_REGISTERED)
    assert [one["agent"] for one in registered] == ["netops"]
    assert registered[0]["body"]["at_creation"] is False


def test_an_agent_board_records_what_that_agent_writes(
    xray: Xray, collected: Collected
) -> None:
    model = xray.create_model(
        board_id="b8",
        store=InMemoryStore(),
        regions=regions(),
        premises={"severity": "sev2"},
        limits=RunLimits(wall_clock=timedelta(seconds=30), idle=timedelta(seconds=30)),
    )
    board = model.control.as_agent("ocp")
    board.write("findings", {"cause": "a bad deploy"})
    xray.flush(5)

    admitted = collected.of(EventKind.WRITE_ADMITTED)
    assert len(admitted) == 1
    assert admitted[0]["agent"] == "ocp"


def test_the_model_that_comes_back_is_the_librarys_own(xray: Xray) -> None:
    store = InMemoryStore()
    model = xray.create_model(
        board_id="b9",
        store=store,
        regions=regions(),
        premises={"severity": "sev2"},
        limits=RunLimits(wall_clock=timedelta(seconds=30), idle=timedelta(seconds=30)),
    )
    # Reads bypass the wrapper entirely, and the board identifier is the one
    # that was passed. An application that already runs changes nothing else.
    assert model.board_id == "b9"
    assert model.reader.read_premise("severity").value == "sev2"
    assert [region.name for region in model.reader.read_regions()] == [
        "findings",
        "severity",
        "signals",
    ]


def test_a_platform_that_is_down_never_reaches_a_writer() -> None:
    class Down:
        def send(self, url: str, token: str, batch: list[dict[str, Any]]) -> None:
            raise ConnectionError("nothing is listening on that endpoint")

        def close(self) -> None:
            return None

    with Xray(
        endpoint="http://nothing",
        token="t",
        transport=Down(),
        max_attempts=1,
        flush_interval=0.05,
    ) as observed:
        model = observed.create_model(
            board_id="b10",
            store=InMemoryStore(),
            regions=regions(),
            premises={"severity": "sev2"},
            limits=RunLimits(
                wall_clock=timedelta(seconds=30), idle=timedelta(seconds=30)
            ),
        )
        result = model.control.write("signals", {"alert": "oom"}, writer="triage")
        assert isinstance(result, Written)
        observed.flush(5)
        assert observed.dropped > 0


def test_the_outcome_is_recorded_once_whichever_path_saw_it_first(
    xray: Xray, collected: Collected
) -> None:
    # A run closes on whichever thread reached the deadline, so `on_closed`
    # fires after `wait_closed` has returned. Both record, and the second one
    # finds it already recorded.
    model = xray.create_model(
        board_id="b11",
        store=InMemoryStore(),
        regions=regions(),
        premises={"severity": "sev2"},
        limits=RunLimits(
            wall_clock=timedelta(seconds=30), idle=timedelta(milliseconds=80)
        ),
    )
    model.control.wait_closed(timedelta(seconds=10))
    model.control.outcome()
    model.control.outcome()
    xray.flush(5)
    assert len(collected.of(EventKind.RUN_CLOSED)) == 1


def test_an_aborted_run_carries_the_callers_reason(
    xray: Xray, collected: Collected
) -> None:
    model = xray.create_model(
        board_id="b12",
        store=InMemoryStore(),
        regions=regions(),
        premises={"severity": "sev2"},
        limits=RunLimits(wall_clock=timedelta(seconds=30), idle=timedelta(seconds=30)),
    )
    model.control.abort("the incident was resolved by a rollback")
    xray.flush(5)
    closed = collected.of(EventKind.RUN_CLOSED)
    assert len(closed) == 1
    assert closed[0]["body"]["outcome"] == "aborted"
    assert closed[0]["body"]["reason"] == "the incident was resolved by a rollback"


def test_a_write_after_the_run_closed_is_recorded_as_refused(
    xray: Xray, collected: Collected
) -> None:
    model = xray.create_model(
        board_id="b13",
        store=InMemoryStore(),
        regions=regions(),
        premises={"severity": "sev2"},
        limits=RunLimits(wall_clock=timedelta(seconds=30), idle=timedelta(seconds=30)),
    )
    model.control.abort("closing early")
    model.control.write("signals", {"a": 1}, writer="triage")
    xray.flush(5)
    refused = collected.of(EventKind.WRITE_REFUSED)
    assert len(refused) == 1
    assert refused[0]["body"]["cause"] == "run_closed"


def test_content_is_recorded_by_default() -> None:
    # A platform that shows an operator the size of a finding and not the
    # finding has answered the wrong question.
    collected = Collected()
    with Xray(
        endpoint="http://platform",
        token="t",
        transport=collected,
        flush_interval=0.05,
    ) as observed:
        model = observed.create_model(
            board_id="b14",
            store=InMemoryStore(),
            regions=regions(),
            premises={"severity": "sev2"},
            limits=RunLimits(
                wall_clock=timedelta(seconds=30), idle=timedelta(seconds=30)
            ),
        )
        model.control.write("findings", {"cause": "a bad deploy"}, writer="ocp")
        observed.flush(5)
    admitted = collected.of(EventKind.WRITE_ADMITTED)
    assert admitted[0]["body"]["content"]["content"] == {"cause": "a bad deploy"}


def test_a_deployment_can_send_no_content_at_all() -> None:
    collected = Collected()
    with Xray(
        endpoint="http://platform",
        token="t",
        content_limit=0,
        transport=collected,
        flush_interval=0.05,
    ) as observed:
        model = observed.create_model(
            board_id="b15",
            store=InMemoryStore(),
            regions=regions(),
            premises={"severity": "sev2"},
            limits=RunLimits(
                wall_clock=timedelta(seconds=30), idle=timedelta(seconds=30)
            ),
        )
        model.control.write("findings", {"cause": "a bad deploy"}, writer="ocp")
        observed.flush(5)
    carried = collected.of(EventKind.WRITE_ADMITTED)[0]["body"]["content"]
    assert carried["bytes"] > 0
    assert carried["type"] == "object"
    assert "content" not in carried
    assert "preview" not in carried


def test_a_contribution_past_the_limit_is_truncated_and_says_so() -> None:
    collected = Collected()
    with Xray(
        endpoint="http://platform",
        token="t",
        content_limit=64,
        transport=collected,
        flush_interval=0.05,
    ) as observed:
        model = observed.create_model(
            board_id="b16",
            store=InMemoryStore(),
            regions=regions(),
            premises={"severity": "sev2"},
            limits=RunLimits(
                wall_clock=timedelta(seconds=30), idle=timedelta(seconds=30)
            ),
        )
        model.control.write("findings", {"cause": "x" * 500}, writer="ocp")
        observed.flush(5)
    carried = collected.of(EventKind.WRITE_ADMITTED)[0]["body"]["content"]
    assert carried["truncated"] is True
    assert len(carried["preview"]) == 64
