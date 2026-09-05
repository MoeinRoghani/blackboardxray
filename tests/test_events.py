"""The event vocabulary, and the tolerance both halves depend on."""

from __future__ import annotations

from datetime import UTC, datetime

import pytest

from blackboardxray.events import Event, EventError, EventKind, carry


def test_a_kind_is_named_once_and_the_list_agrees() -> None:
    named = [
        value
        for key, value in vars(EventKind).items()
        if key.isupper() and key != "ALL" and isinstance(value, str)
    ]
    assert sorted(named) == sorted(EventKind.ALL)
    assert len(set(EventKind.ALL)) == len(EventKind.ALL)


def test_an_event_survives_a_round_trip() -> None:
    original = Event(
        board_id="incident-1",
        kind=EventKind.WRITE_ADMITTED,
        sequence=7,
        agent="ocp",
        region="findings",
        body={"version": None, "repeated": False},
    )
    returned = Event.from_json(original.to_json())
    assert returned.board_id == original.board_id
    assert returned.kind == original.kind
    assert returned.sequence == 7
    assert returned.agent == "ocp"
    assert returned.body == original.body
    assert returned.event_id == original.event_id


def test_a_field_a_decoder_does_not_know_is_ignored() -> None:
    # The two halves are deployed separately, so a newer sender must not break
    # an older server.
    decoded = Event.from_json(
        {
            "board_id": "b",
            "kind": EventKind.RUN_OPENED,
            "something_added_later": {"deeply": ["nested"]},
        }
    )
    assert decoded.board_id == "b"
    assert decoded.sequence is None


def test_an_absent_field_takes_its_default() -> None:
    decoded = Event.from_json({"board_id": "b", "kind": EventKind.RUN_CLOSED})
    assert decoded.agent is None
    assert decoded.region is None
    assert decoded.body == {}
    assert decoded.at.tzinfo is not None


def test_an_event_without_a_board_or_a_kind_is_refused() -> None:
    with pytest.raises(EventError):
        Event.from_json({"kind": EventKind.RUN_OPENED})
    with pytest.raises(EventError):
        Event.from_json({"board_id": "b"})
    with pytest.raises(EventError):
        Event.from_json(["not", "an", "object"])


def test_an_unreadable_instant_becomes_now_rather_than_losing_the_event() -> None:
    decoded = Event.from_json(
        {"board_id": "b", "kind": EventKind.RUN_CLOSED, "at": "not a date"}
    )
    assert (datetime.now(UTC) - decoded.at).total_seconds() < 5


def test_a_naive_instant_is_read_as_utc() -> None:
    decoded = Event.from_json(
        {"board_id": "b", "kind": EventKind.RUN_CLOSED, "at": "2026-09-05T02:00:00"}
    )
    assert decoded.at.tzinfo is not None


class TestWhatIsKeptOfAContribution:
    def test_the_default_keeps_the_size_and_the_shape_and_no_content(self) -> None:
        described = carry({"cause": "a bad deploy"}, limit=0)
        assert described["type"] == "object"
        assert described["bytes"] > 0
        assert "content" not in described
        assert "preview" not in described

    def test_opting_in_carries_the_content(self) -> None:
        described = carry({"cause": "a bad deploy"}, limit=2048)
        assert described["content"] == {"cause": "a bad deploy"}

    def test_content_past_the_limit_is_truncated_and_says_so(self) -> None:
        described = carry({"cause": "x" * 500}, limit=64)
        assert described["truncated"] is True
        assert len(described["preview"]) == 64
        assert "content" not in described

    def test_a_value_json_cannot_carry_is_described_rather_than_lost(self) -> None:
        # An event should never be lost because a contribution held something
        # odd, so encoding falls back to the value's string form and the shape
        # reports what it actually was.
        described = carry({1, 2, 3}, limit=1024)
        assert described["type"] == "set"
        assert described["bytes"] > 0

    def test_content_that_cannot_be_encoded_at_all_is_reported(self) -> None:
        circular: dict[str, object] = {}
        circular["self"] = circular
        described = carry(circular, limit=1024)
        assert described["unreadable"] is True
        assert described["bytes"] == 0
