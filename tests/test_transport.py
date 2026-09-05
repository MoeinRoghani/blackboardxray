"""The sender: bounded, batched, retried, and never in a writer's way."""

from __future__ import annotations

import threading
from typing import Any

import pytest

from blackboardxray._transport import (
    Dropped,
    Sender,
    SendFailed,
    SendRefused,
    default_backoff,
)
from blackboardxray.events import Event, EventKind


class Recorder:
    """A transport that records what it was asked to send."""

    def __init__(self, fail_times: int = 0, refuse: bool = False) -> None:
        self.batches: list[list[dict[str, Any]]] = []
        self.attempts = 0
        self._fail_times = fail_times
        self._refuse = refuse
        self._lock = threading.Lock()
        self.closed = False

    def send(self, url: str, token: str, batch: list[dict[str, Any]]) -> None:
        with self._lock:
            self.attempts += 1
            if self._refuse:
                raise SendRefused("the platform answered 401")
            if self.attempts <= self._fail_times:
                raise SendFailed("the platform answered 503")
            self.batches.append(list(batch))

    def close(self) -> None:
        self.closed = True

    @property
    def sent(self) -> list[dict[str, Any]]:
        return [one for batch in self.batches for one in batch]


def an_event(board: str = "b") -> Event:
    return Event(board_id=board, kind=EventKind.WRITE_ADMITTED, sequence=1)


def test_events_reach_the_transport() -> None:
    recorder = Recorder()
    with Sender(endpoint="http://x", token="t", transport=recorder) as sender:
        for _ in range(5):
            sender.record(an_event())
        assert sender.flush(5)
    assert len(recorder.sent) == 5
    assert sender.sent == 5
    assert sender.dropped == 0


def test_a_batch_carries_at_most_the_batch_size() -> None:
    recorder = Recorder()
    with Sender(
        endpoint="http://x", token="t", transport=recorder, batch_size=4
    ) as sender:
        for _ in range(9):
            sender.record(an_event())
        sender.flush(5)
    assert all(len(batch) <= 4 for batch in recorder.batches)
    assert len(recorder.sent) == 9


def test_a_failure_is_attempted_again_and_then_lands() -> None:
    recorder = Recorder(fail_times=2)
    with Sender(
        endpoint="http://x",
        token="t",
        transport=recorder,
        backoff=lambda attempt, after: 0.0,
    ) as sender:
        sender.record(an_event())
        sender.flush(5)
    assert len(recorder.sent) == 1
    assert recorder.attempts == 3


def test_a_refusal_is_not_attempted_again() -> None:
    # A wrong token answers the same way however many times it is sent.
    recorder = Recorder(refuse=True)
    dropped: list[Dropped] = []
    with Sender(
        endpoint="http://x",
        token="t",
        transport=recorder,
        on_drop=dropped.append,
        backoff=lambda attempt, after: 0.0,
    ) as sender:
        sender.record(an_event())
        sender.flush(5)
    assert recorder.attempts == 1
    assert sender.dropped == 1
    assert dropped and "401" in dropped[0].reason


def test_a_full_queue_drops_and_counts_rather_than_blocking() -> None:
    # Telemetry that stalls a run has done more damage than it was worth.
    class Wedged:
        def send(self, url: str, token: str, batch: list[dict[str, Any]]) -> None:
            raise SendFailed("nothing is answering")

        def close(self) -> None:
            return None

    sender = Sender(
        endpoint="http://x",
        token="t",
        transport=Wedged(),
        queue_size=4,
        max_attempts=1,
        backoff=lambda attempt, after: 0.0,
    )
    try:
        for _ in range(500):
            sender.record(an_event())
        assert sender.dropped > 0
    finally:
        sender.close(1)


def test_recording_never_raises_into_a_writer() -> None:
    class Exploding:
        def send(self, url: str, token: str, batch: list[dict[str, Any]]) -> None:
            raise RuntimeError("the transport is broken in an unexpected way")

        def close(self) -> None:
            raise RuntimeError("even closing is broken")

    sender = Sender(endpoint="http://x", token="t", transport=Exploding())
    for _ in range(10):
        sender.record(an_event())
    sender.flush(2)
    assert sender.dropped >= 1
    with pytest.raises(RuntimeError):
        # Closing surfaces the transport's own failure to the caller that
        # asked for it, which is not the same as reaching a writer.
        sender.close(1)


def test_a_stopped_sender_accepts_nothing_further() -> None:
    recorder = Recorder()
    sender = Sender(endpoint="http://x", token="t", transport=recorder)
    sender.close(2)
    sender.record(an_event())
    assert recorder.closed


class TestBackoff:
    def test_a_named_delay_is_honoured_and_capped(self) -> None:
        assert default_backoff(1, 5.0) == 5.0
        assert default_backoff(1, 10_000.0) == 30.0
        assert default_backoff(1, -2.0) == 0.0

    def test_the_wait_grows_and_is_spread(self) -> None:
        early = [default_backoff(1, None) for _ in range(50)]
        late = [default_backoff(6, None) for _ in range(50)]
        assert max(early) <= 0.5
        assert max(late) <= 16.0
        assert min(late) > max(early)
        assert len(set(early)) > 1
