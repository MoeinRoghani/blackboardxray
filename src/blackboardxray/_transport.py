"""Getting events off the writing thread and onto the platform.

The control component calls an agent on the thread of whichever agent just
wrote. Sending an event from there would make every write pay for a round
trip, which is the cost `blackboard.delivery` exists to avoid on the
notification path, and there is no reason to reintroduce it on the
observation path.

So a record is put on a bounded queue and the caller returns. A worker
batches what is on the queue and sends it. The queue is bounded because an
unbounded one turns a platform that is down into an application that runs out
of memory, and a full queue drops rather than blocks, because telemetry that
stalls a run has done more damage than the telemetry was worth.

Nothing here raises into a caller. A send that fails is retried, then dropped
and counted, and the count is what an operator reads to learn that it
happened.
"""

from __future__ import annotations

import contextlib
import json
import logging
import queue
import random
import threading
import time
import urllib.error
import urllib.request
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, Protocol

from blackboardxray.events import Event

logger = logging.getLogger("blackboardxray")

#: The longest the default policy waits between attempts, in seconds.
MAX_BACKOFF = 30.0

#: How many events one request carries at most.
DEFAULT_BATCH = 64

#: How long a partial batch waits for company before it is sent, in seconds.
DEFAULT_FLUSH_INTERVAL = 2.0

#: How many events wait to be sent before the newest is dropped.
DEFAULT_QUEUE_SIZE = 10_000

#: The path the platform answers ingestion on.
INGEST_PATH = "/api/v1/ingest"


class SendFailed(Exception):
    """A batch did not land and is worth attempting again."""

    def __init__(self, message: str, *, retry_after: float | None = None) -> None:
        super().__init__(message)
        self.retry_after = retry_after


class SendRefused(Exception):
    """A batch was refused and no attempt will make it land.

    A wrong token, a body the platform cannot read, or a project that does not
    exist. Attempting again would send the same refusal.
    """


@dataclass(frozen=True)
class Dropped:
    """Events the sender gave up on, and why. Handed to ``on_drop``."""

    count: int
    reason: str


class Transport(Protocol):
    """How a batch reaches the platform. Substituted in a test."""

    def send(self, url: str, token: str, batch: list[dict[str, Any]]) -> None:
        """Sends one batch, raising ``SendFailed`` or ``SendRefused``."""
        ...

    def close(self) -> None:
        """Releases whatever the transport holds."""
        ...


def default_backoff(attempt: int, retry_after: float | None) -> float:
    """Returns how long to wait before ``attempt`` + 1, in seconds.

    A server that named a delay gets that delay, capped so that one bad header
    cannot park a sender for an hour. Otherwise the wait doubles and is drawn
    from the range between half of it and all of it, so senders that failed
    together do not return together.
    """
    if retry_after is not None:
        return min(max(retry_after, 0.0), MAX_BACKOFF)
    doublings = min(max(attempt - 1, 0), 20)
    ceiling = min(0.5 * 2.0**doublings, MAX_BACKOFF)
    return ceiling * (0.5 + 0.5 * random.random())


class UrllibTransport:
    """The default transport, over the standard library.

    The client half declares no dependency, because an application already
    running a blackboard should not have to take one to be observed. Where
    `httpx` is present, `HttpxTransport` reuses a connection and is faster.
    """

    def __init__(self, *, timeout: float = 10.0) -> None:
        self._timeout = timeout

    def send(self, url: str, token: str, batch: list[dict[str, Any]]) -> None:
        payload = json.dumps({"events": batch}).encode("utf-8")
        request = urllib.request.Request(
            url,
            data=payload,
            method="POST",
            headers={
                "content-type": "application/json",
                "authorization": f"Bearer {token}",
                "user-agent": "blackboardxray-python",
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=self._timeout) as answer:
                if answer.status >= 500:
                    raise SendFailed(f"the platform answered {answer.status}")
        except urllib.error.HTTPError as answered:
            _refuse_or_retry(answered.code, dict(answered.headers))
        except urllib.error.URLError as unreachable:
            raise SendFailed(f"the platform could not be reached: {unreachable}") from (
                unreachable
            )
        except TimeoutError as timed_out:
            raise SendFailed("the platform did not answer in time") from timed_out

    def close(self) -> None:
        return None


class HttpxTransport:
    """A transport over `httpx`, reusing one connection across batches."""

    def __init__(self, *, timeout: float = 10.0, **client_options: Any) -> None:
        try:
            import httpx
        except ModuleNotFoundError as absent:  # pragma: no cover
            raise ModuleNotFoundError(
                "HttpxTransport needs the httpx extra: "
                "pip install 'blackboardxray[httpx]'"
            ) from absent
        self._client = httpx.Client(timeout=timeout, **client_options)

    def send(self, url: str, token: str, batch: list[dict[str, Any]]) -> None:
        import httpx

        try:
            answer = self._client.post(
                url,
                json={"events": batch},
                headers={
                    "authorization": f"Bearer {token}",
                    "user-agent": "blackboardxray-python",
                },
            )
        except httpx.HTTPError as unreachable:
            raise SendFailed(
                f"the platform could not be reached: {unreachable}"
            ) from unreachable
        if answer.status_code >= 400:
            _refuse_or_retry(answer.status_code, dict(answer.headers))

    def close(self) -> None:
        self._client.close()


def _refuse_or_retry(status: int, headers: dict[str, str]) -> None:
    """Turns a status into the one exception that says what to do about it."""
    if status < 400:
        return
    if status == 429 or status >= 500:
        raise SendFailed(
            f"the platform answered {status}", retry_after=_retry_after(headers)
        )
    raise SendRefused(f"the platform answered {status}")


def _retry_after(headers: dict[str, str]) -> float | None:
    for name, value in headers.items():
        if name.lower() == "retry-after":
            try:
                return float(value)
            except ValueError:
                return None
    return None


class Sender:
    """A bounded queue and the worker that drains it.

    ``record`` is what the wrappers call. It never blocks and never raises.
    """

    def __init__(
        self,
        *,
        endpoint: str,
        token: str,
        transport: Transport | None = None,
        batch_size: int = DEFAULT_BATCH,
        flush_interval: float = DEFAULT_FLUSH_INTERVAL,
        queue_size: int = DEFAULT_QUEUE_SIZE,
        max_attempts: int = 4,
        on_drop: Callable[[Dropped], None] | None = None,
        backoff: Callable[[int, float | None], float] = default_backoff,
    ) -> None:
        self._url = endpoint.rstrip("/") + INGEST_PATH
        self._token = token
        self._transport = transport if transport is not None else UrllibTransport()
        self._batch_size = max(1, batch_size)
        self._flush_interval = max(0.05, flush_interval)
        self._max_attempts = max(1, max_attempts)
        self._on_drop = on_drop
        self._backoff = backoff
        self._queue: queue.Queue[dict[str, Any] | None] = queue.Queue(
            maxsize=max(1, queue_size)
        )
        self._dropped = 0
        self._sent = 0
        self._lock = threading.Lock()
        self._idle = threading.Event()
        self._idle.set()
        self._stopped = threading.Event()
        self._worker = threading.Thread(
            target=self._drain, name="blackboardxray-sender", daemon=True
        )
        self._worker.start()

    @property
    def dropped(self) -> int:
        """How many events this sender gave up on."""
        with self._lock:
            return self._dropped

    @property
    def sent(self) -> int:
        """How many events this sender delivered."""
        with self._lock:
            return self._sent

    def record(self, event: Event) -> None:
        """Queues one event. Never blocks, never raises."""
        if self._stopped.is_set():
            return
        try:
            self._idle.clear()
            self._queue.put_nowait(event.to_json())
        except queue.Full:
            self._give_up(1, "the queue is full")
        except Exception:  # pragma: no cover - a record must never reach a writer
            self._give_up(1, "the event could not be queued")

    def flush(self, timeout: float = 5.0) -> bool:
        """Sends what is queued now, and answers whether it went.

        A partial batch normally waits for company until the flush interval
        passes. This asks for it immediately, because a caller that said flush
        wants the events gone rather than a promise that they will go in two
        seconds.
        """
        if self._stopped.is_set():
            return True
        self._idle.clear()
        # A full queue means the worker is already sending, which is what was
        # asked for.
        with contextlib.suppress(queue.Full):
            self._queue.put_nowait(_FLUSH)
        return self._idle.wait(timeout)

    def close(self, timeout: float = 5.0) -> None:
        """Sends what is queued, within the timeout, then stops the worker."""
        if self._stopped.is_set():
            return
        self.flush(timeout)
        self._stopped.set()
        with contextlib.suppress(queue.Full):  # pragma: no cover
            self._queue.put_nowait(None)
        self._worker.join(timeout)
        self._transport.close()

    def __enter__(self) -> Sender:
        return self

    def __exit__(self, *exception: object) -> None:
        self.close()

    def _drain(self) -> None:
        batch: list[dict[str, Any]] = []
        deadline: float | None = None
        while True:
            wait = (
                self._flush_interval if deadline is None else max(0.0, deadline - _t())
            )
            try:
                item = self._queue.get(timeout=wait)
            except queue.Empty:
                item = _EMPTY
            if item is None:
                self._send(batch)
                self._idle.set()
                return
            asked = item is _FLUSH
            if item is not _EMPTY and not asked:
                batch.append(item)
                if deadline is None:
                    deadline = _t() + self._flush_interval
            due = deadline is not None and _t() >= deadline
            if batch and (
                len(batch) >= self._batch_size or due or item is _EMPTY or asked
            ):
                self._send(batch)
                batch = []
                deadline = None
            if not batch and self._queue.empty():
                self._idle.set()

    def _send(self, batch: list[dict[str, Any]]) -> None:
        if not batch:
            return
        for attempt in range(1, self._max_attempts + 1):
            try:
                self._transport.send(self._url, self._token, batch)
            except SendRefused as refused:
                self._give_up(len(batch), str(refused))
                return
            except SendFailed as failed:
                if attempt == self._max_attempts:
                    self._give_up(len(batch), str(failed))
                    return
                logger.warning(
                    "blackboardxray could not send %d events, attempt %d of %d: %s",
                    len(batch),
                    attempt,
                    self._max_attempts,
                    failed,
                )
                time.sleep(self._backoff(attempt, failed.retry_after))
            except Exception as unexpected:  # pragma: no cover
                self._give_up(len(batch), f"the transport raised: {unexpected}")
                return
            else:
                with self._lock:
                    self._sent += len(batch)
                return

    def _give_up(self, count: int, reason: str) -> None:
        with self._lock:
            self._dropped += count
        logger.warning("blackboardxray dropped %d events: %s", count, reason)
        if self._on_drop is None:
            return
        try:
            self._on_drop(Dropped(count=count, reason=reason))
        except Exception:  # pragma: no cover - the callback is at the boundary
            logger.warning("blackboardxray on_drop raised", exc_info=True)


#: A sentinel meaning the queue went quiet, so a partial batch may go now.
_EMPTY: Any = object()

#: A sentinel meaning a caller asked for what is queued to go immediately.
_FLUSH: Any = object()


def _t() -> float:
    return time.monotonic()
