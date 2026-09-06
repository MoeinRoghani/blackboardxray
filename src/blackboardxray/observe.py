"""Observing a run without changing the library that runs it.

`blackboardx` is not modified and is not asked to grow a hook. Everything the
platform records passes through one of three places the application already
controls: the `Control` it was handed, the `notify` callable it put on each
agent, and the `on_closed` it passed at creation. Wrapping those three sees
every write, every refusal, every notification, every acknowledgment and the
outcome.

    from blackboardxray import Xray

    xray = Xray(endpoint="http://localhost:8900", token="bxr_...")

    model = xray.create_model(
        board_id="incident-4471",
        store=SqliteStore("incidents.sqlite3"),
        regions=[Level("platform"), Premise("window")],
        premises={"window": ["20:00", "22:00"]},
        agents=[Agent(name="ocp", notify=investigate)],
        limits=RunLimits(wall_clock=timedelta(minutes=10), idle=timedelta(seconds=30)),
    )

Every argument is the one `blackboard.create_model` takes and means the same
thing. What comes back is the library's own model with an observed control
component, so an application that already runs adds two lines and changes
nothing else.

An agent deployed as its own service wraps its board instead:

    board = xray.agent_board(BoardClient(base_url=..., board_id=..., agent="ocp"))

A contribution's content is recorded, truncated past
``DEFAULT_CONTENT_LIMIT`` bytes. A deployment whose contributions may not
leave the process passes ``content_limit=0``, which records the size and the
shape and none of the content.
"""

from __future__ import annotations

import os
import threading
from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass
from datetime import timedelta
from typing import Any

from blackboard import (
    AdmissionRule,
    Agent,
    AgentBoard,
    BoardReader,
    BoardStore,
    Clock,
    Conflict,
    Control,
    Level,
    Model,
    Notification,
    NotificationId,
    Premise,
    Rejected,
    RunLimits,
    RunOutcome,
    TerminationPredicate,
    Written,
    create_model,
)

from blackboardxray._transport import Dropped, Sender, Transport
from blackboardxray.events import Event, EventKind, carry

#: The environment names ``from_env`` reads.
ENDPOINT_VARIABLE = "BLACKBOARDXRAY_ENDPOINT"
TOKEN_VARIABLE = "BLACKBOARDXRAY_TOKEN"
CONTENT_LIMIT_VARIABLE = "BLACKBOARDXRAY_CONTENT_LIMIT"

#: How much of a contribution is carried when the caller names no limit.
#:
#: Content is recorded, because a platform that shows an operator the size of a
#: finding and not the finding has answered the wrong question. The limit
#: bounds one contribution rather than deciding whether to keep any.
DEFAULT_CONTENT_LIMIT = 4096


class Xray:
    """The platform, as an application reaches it.

    One instance serves every run an application opens. It holds one queue and
    one worker, so opening a thousand boards costs one thread rather than a
    thousand.

    ``content_limit`` bounds what is kept of one contribution, and defaults to
    :data:`DEFAULT_CONTENT_LIMIT` bytes. Content past it is truncated and the
    record says so.

    Passing ``0`` records a contribution's size and its shape and none of its
    content. That is the setting for a deployment whose contributions carry
    something that may not leave the process, and it is a decision about your
    data rather than one this platform should make for you.
    """

    def __init__(
        self,
        *,
        endpoint: str,
        token: str,
        content_limit: int = DEFAULT_CONTENT_LIMIT,
        transport: Transport | None = None,
        on_drop: Callable[[Dropped], None] | None = None,
        **sender_options: Any,
    ) -> None:
        if not endpoint:
            raise ValueError("an endpoint is required, and names the platform")
        if not token:
            raise ValueError("a token is required, and names the project")
        self._content_limit = max(0, content_limit)
        # A run closes on whichever thread reached the deadline, so `on_closed`
        # fires after `wait_closed` has already returned to the caller. An
        # application that flushes on that line would lose the close event, so
        # every path that learns the outcome records it and this remembers
        # which boards have been recorded.
        self._closed: set[str] = set()
        self._closed_lock = threading.Lock()
        self._sender = Sender(
            endpoint=endpoint,
            token=token,
            transport=transport,
            on_drop=on_drop,
            **sender_options,
        )

    @classmethod
    def from_env(cls, **options: Any) -> Xray:
        """Builds one from the environment, the way a deployment configures it.

        Reads ``BLACKBOARDXRAY_ENDPOINT``, ``BLACKBOARDXRAY_TOKEN`` and
        ``BLACKBOARDXRAY_CONTENT_LIMIT``. The library `blackboardx` reads no
        environment variable by rule; this package is not that library, and a
        platform whose address is a deployment concern is configured where a
        deployment configures things.
        """
        endpoint = os.environ.get(ENDPOINT_VARIABLE, "")
        token = os.environ.get(TOKEN_VARIABLE, "")
        if not endpoint or not token:
            raise ValueError(
                f"{ENDPOINT_VARIABLE} and {TOKEN_VARIABLE} must both be set"
            )
        limit = options.pop("content_limit", None)
        if limit is None:
            limit = _whole(
                os.environ.get(CONTENT_LIMIT_VARIABLE), DEFAULT_CONTENT_LIMIT
            )
        return cls(endpoint=endpoint, token=token, content_limit=limit, **options)

    @property
    def dropped(self) -> int:
        """How many events this instance gave up on."""
        return self._sender.dropped

    @property
    def sent(self) -> int:
        """How many events this instance delivered."""
        return self._sender.sent

    def record(self, event: Event) -> None:
        """Queues one event of your own, alongside what the wrappers record."""
        self._sender.record(event)

    def flush(self, timeout: float = 5.0) -> bool:
        """Waits for the queue to empty. Answers whether it did."""
        return self._sender.flush(timeout)

    def close(self, timeout: float = 5.0) -> None:
        """Sends what is queued, then stops the worker."""
        self._sender.close(timeout)

    def __enter__(self) -> Xray:
        return self

    def __exit__(self, *exception: object) -> None:
        self.close()

    def create_model(
        self,
        *,
        board_id: str,
        store: BoardStore,
        regions: Iterable[Level | Premise],
        premises: Mapping[str, object],
        agents: Iterable[Agent] | None = None,
        admission_rule: AdmissionRule | None = None,
        termination_predicate: TerminationPredicate | None = None,
        limits: RunLimits,
        clock: Clock | None = None,
        on_open: Callable[[Model], None] | None = None,
        on_closed: Callable[[RunOutcome], None] | None = None,
    ) -> Model:
        """Creates a model, observed. Every argument is the library's own.

        The agents are wrapped before the run opens, so the notification each
        receives at registration is recorded like any other. ``on_closed`` is
        chained rather than replaced, so an application that already passed one
        keeps it.
        """
        declarations = list(regions)
        roster = list(agents or ())
        observed_agents = [self._observe_agent(board_id, one) for one in roster]

        def closed(outcome: RunOutcome) -> None:
            self._record_closed(board_id, outcome)
            if on_closed is not None:
                on_closed(outcome)

        self._sender.record(
            Event(
                board_id=board_id,
                kind=EventKind.RUN_OPENED,
                body={
                    "regions": [
                        {
                            "name": region.name,
                            "kind": "level" if isinstance(region, Level) else "premise",
                            "batch_window_seconds": region.batch_window.total_seconds(),
                        }
                        for region in declarations
                    ],
                    "premises": {
                        name: carry(value, limit=self._content_limit)
                        for name, value in premises.items()
                    },
                    "agents": [_declaration(one) for one in roster],
                    "limits": {
                        "wall_clock_seconds": limits.wall_clock.total_seconds(),
                        "idle_seconds": limits.idle.total_seconds(),
                    },
                    "store": type(store).__name__,
                    "has_admission_rule": admission_rule is not None,
                    "has_termination_predicate": termination_predicate is not None,
                },
            )
        )
        for one in roster:
            self._sender.record(
                Event(
                    board_id=board_id,
                    kind=EventKind.AGENT_REGISTERED,
                    agent=one.name,
                    body={**_declaration(one), "at_creation": True},
                )
            )
        model = create_model(
            board_id=board_id,
            store=store,
            regions=declarations,
            premises=premises,
            agents=observed_agents,
            admission_rule=admission_rule,
            termination_predicate=termination_predicate,
            limits=limits,
            clock=clock,
            on_open=on_open,
            on_closed=closed,
        )
        return Model(
            board_id=model.board_id,
            reader=model.reader,
            control=_ObservedControl(model.control, self),  # type: ignore[arg-type]
        )

    def control(self, control: Control) -> Control:
        """Observes a control component the application already holds.

        `create_model` is the usual door. This one is for a run that was
        created before the platform was reached for.
        """
        return _ObservedControl(control, self)  # type: ignore[return-value]

    def agent_board(self, board: AgentBoard, agent: str | None = None) -> AgentBoard:
        """Observes one agent's view of a board, in process or over HTTP.

        `BoardClient` satisfies `AgentBoard` and so does what
        `Control.as_agent` returns, so an agent body is observed wherever it
        runs. ``agent`` names the writer where the object does not say.
        """
        return _ObservedAgentBoard(board, self, agent)

    # What the wrappers call.

    def _observe_agent(self, board_id: str, agent: Agent) -> Agent:
        """Returns the declaration with its callback wrapped.

        An agent declares a callback or an address, and `blackboardx` requires
        one of the two. Where it is an address the agent runs as its own
        service and the control component reaches it over HTTP, so there is no
        function in this process to wrap. It is returned untouched and the
        observation happens on its own side, through `Xray.agent_board`.

        Recording a dispatch here for an agent this process never calls would
        be a line in the timeline saying something happened here that happened
        somewhere else.
        """
        inner = agent.notify
        if inner is None:
            return agent

        def notify(notification: Notification) -> None:
            self._sender.record(
                Event(
                    board_id=notification.board_id or board_id,
                    kind=EventKind.NOTIFICATION_DISPATCHED,
                    agent=notification.agent,
                    # A notification takes no sequence number. It carries no
                    # values and changes nothing on the board, so recording
                    # the range it covers as though it were an address would
                    # put it on the spine beside the writes and destroy the
                    # one distinction the timeline exists to draw. The range
                    # is in the body, which is where a range belongs.
                    body={
                        "notification_id": int(notification.notification_id),
                        "from_sequence": notification.from_sequence,
                        "to_sequence": notification.to_sequence,
                        "regions": sorted(notification.regions),
                    },
                )
            )
            try:
                inner(notification)
            except BaseException as raised:
                self._sender.record(
                    Event(
                        board_id=notification.board_id or board_id,
                        kind=EventKind.NOTIFICATION_FAILED,
                        agent=notification.agent,
                        body={
                            "notification_id": int(notification.notification_id),
                            "error": type(raised).__name__,
                            "detail": str(raised)[:500],
                        },
                    )
                )
                raise

        return Agent(
            name=agent.name,
            notify=notify,
            subscribes_to=agent.subscribes_to,
            writes_to=agent.writes_to,
        )

    def _record_registered(self, board_id: str, agent: Agent) -> None:
        self._sender.record(
            Event(
                board_id=board_id,
                kind=EventKind.AGENT_REGISTERED,
                agent=agent.name,
                body={**_declaration(agent), "at_creation": False},
            )
        )

    def _record_write(
        self,
        board_id: str,
        region: str,
        writer: str,
        content: object,
        result: object,
        *,
        premise: bool,
        expected_version: int | None = None,
        idempotency_key: str | None = None,
    ) -> None:
        described = carry(content, limit=self._content_limit)
        if isinstance(result, Rejected):
            self._sender.record(
                Event(
                    board_id=board_id,
                    kind=EventKind.WRITE_REFUSED,
                    agent=writer,
                    region=region,
                    body={
                        "cause": result.cause.value,
                        "reason": result.reason,
                        "content": described,
                        "premise": premise,
                    },
                )
            )
            return
        if isinstance(result, Conflict):
            self._sender.record(
                Event(
                    board_id=board_id,
                    kind=EventKind.WRITE_CONFLICTED,
                    agent=writer,
                    region=region,
                    body={
                        "expected_version": expected_version,
                        "current_version": result.current_version,
                        "content": described,
                    },
                )
            )
            return
        if isinstance(result, Written):
            self._sender.record(
                Event(
                    board_id=board_id,
                    kind=EventKind.PREMISE_SET if premise else EventKind.WRITE_ADMITTED,
                    agent=writer,
                    region=region,
                    sequence=result.sequence,
                    body={
                        "version": result.version,
                        "repeated": result.repeated,
                        "content": described,
                        "idempotency_key": idempotency_key,
                    },
                )
            )

    def _record_ack(self, board_id: str, agent: str, notification_id: int) -> None:
        self._sender.record(
            Event(
                board_id=board_id,
                kind=EventKind.NOTIFICATION_ACKNOWLEDGED,
                agent=agent,
                body={"notification_id": int(notification_id)},
            )
        )

    def _record_closed(self, board_id: str, outcome: RunOutcome) -> None:
        """Records the outcome once, whichever path learned it first.

        The queueing happens under the lock rather than after it. Marking the
        board first and queueing second leaves a window where a second caller
        finds it already marked and returns, while the first has not queued
        yet, so a flush between the two sends nothing and the close event is
        lost. Queueing never blocks, so holding the lock across it costs
        nothing.
        """
        with self._closed_lock:
            if board_id in self._closed:
                return
            self._closed.add(board_id)
            named = type(outcome).__name__
            self._sender.record(
                Event(
                    board_id=board_id,
                    kind=EventKind.RUN_CLOSED,
                    body={
                        "outcome": _OUTCOMES.get(named, named.lower()),
                        "reason": getattr(outcome, "reason", None),
                        "unfinished": sorted(
                            getattr(outcome, "unfinished", frozenset())
                        ),
                    },
                )
            )


#: What each outcome is called on the wire, matching the store's own names.
_OUTCOMES = {
    "Settled": "settled",
    "WallClockExpired": "wall_clock_expired",
    "Aborted": "aborted",
}


def _declaration(agent: Agent) -> dict[str, Any]:
    return {
        "name": agent.name,
        "subscribes_to": sorted(agent.subscribes_to)
        if agent.subscribes_to is not None
        else None,
        "writes_to": sorted(agent.writes_to) if agent.writes_to is not None else None,
    }


def _whole(given: str | None, fallback: int) -> int:
    if given is None or not given.lstrip("-").isdigit():
        return fallback
    return int(given)


@dataclass
class _ObservedControl:
    """A control component that records what passes through it.

    Every method the library has is answered. The five that decide something
    are recorded; the rest are forwarded, so an application calling anything
    else sees no difference.
    """

    _inner: Control
    _xray: Xray

    @property
    def board_id(self) -> str:
        return self._inner.board_id

    @property
    def reader(self) -> BoardReader:
        return self._inner.reader

    def write(
        self,
        level: str,
        content: object,
        idempotency_key: str | None = None,
        *,
        writer: str,
    ) -> Written | Rejected:
        result = self._inner.write(level, content, idempotency_key, writer=writer)
        self._xray._record_write(
            self._inner.board_id,
            level,
            writer,
            content,
            result,
            premise=False,
            idempotency_key=idempotency_key,
        )
        return result

    def set_premise(
        self,
        premise: str,
        value: object,
        expected_version: int,
        idempotency_key: str | None = None,
        *,
        writer: str,
    ) -> Written | Conflict | Rejected:
        result = self._inner.set_premise(
            premise, value, expected_version, idempotency_key, writer=writer
        )
        self._xray._record_write(
            self._inner.board_id,
            premise,
            writer,
            value,
            result,
            premise=True,
            expected_version=expected_version,
            idempotency_key=idempotency_key,
        )
        return result

    def ack(self, notification_id: NotificationId | int, *, agent: str) -> None:
        self._inner.ack(notification_id, agent=agent)
        self._xray._record_ack(self._inner.board_id, agent, int(notification_id))

    def register_agent(self, agent: Agent) -> None:
        observed = self._xray._observe_agent(self._inner.board_id, agent)
        self._xray._record_registered(self._inner.board_id, agent)
        self._inner.register_agent(observed)

    def as_agent(self, name: str) -> AgentBoard:
        return _ObservedAgentBoard(self._inner.as_agent(name), self._xray, name)

    def abort(self, reason: str) -> None:
        self._inner.abort(reason)

    def outcome(self) -> RunOutcome | None:
        outcome = self._inner.outcome()
        if outcome is not None:
            self._xray._record_closed(self._inner.board_id, outcome)
        return outcome

    def wait_closed(self, timeout: timedelta | None = None) -> RunOutcome | None:
        outcome = self._inner.wait_closed(timeout)
        if outcome is not None:
            self._xray._record_closed(self._inner.board_id, outcome)
        return outcome

    def declare(self, region: Level | Premise) -> None:
        self._inner.declare(region)

    def __getattr__(self, name: str) -> Any:
        # Anything the library adds later is forwarded rather than hidden.
        return getattr(self._inner, name)


@dataclass
class _ObservedAgentBoard:
    """One agent's board, recording what it writes and what it acknowledges.

    `BoardClient` and what `Control.as_agent` returns both satisfy
    `AgentBoard`, so one wrapper serves an agent in process and an agent that
    is its own service.
    """

    _inner: AgentBoard
    _xray: Xray
    _agent: str | None = None

    @property
    def board_id(self) -> str:
        return self._inner.board_id

    @property
    def _writer(self) -> str:
        """The name this board writes as.

        `BoardClient` and what `Control.as_agent` returns both carry the agent
        name privately, so it is read from there when the caller did not name
        one. A board that carries neither writes as an unnamed agent rather
        than raising into the write it was asked to make.
        """
        if self._agent:
            return self._agent
        carried = getattr(self._inner, "_agent", None)
        return carried if isinstance(carried, str) and carried else "unknown"

    def read_regions(self) -> list[Level | Premise]:
        return self._inner.read_regions()

    def read_level(
        self, level: str, from_sequence: int = 0, limit: int | None = None
    ) -> Any:
        return self._inner.read_level(level, from_sequence, limit)

    def read_premise(self, premise: str) -> Any:
        return self._inner.read_premise(premise)

    def read_board(self, from_sequence: int = 0, limit: int | None = None) -> Any:
        return self._inner.read_board(from_sequence, limit)

    def write(
        self, level: str, content: object, idempotency_key: str | None = None
    ) -> Written | Rejected:
        result = self._inner.write(level, content, idempotency_key)
        self._xray._record_write(
            self._inner.board_id,
            level,
            self._writer,
            content,
            result,
            premise=False,
            idempotency_key=idempotency_key,
        )
        return result

    def set_premise(
        self,
        premise: str,
        value: object,
        expected_version: int,
        idempotency_key: str | None = None,
    ) -> Written | Conflict | Rejected:
        result = self._inner.set_premise(
            premise, value, expected_version, idempotency_key
        )
        self._xray._record_write(
            self._inner.board_id,
            premise,
            self._writer,
            value,
            result,
            premise=True,
            expected_version=expected_version,
            idempotency_key=idempotency_key,
        )
        return result

    def ack(self, notification_id: NotificationId | int) -> None:
        self._inner.ack(notification_id)
        self._xray._record_ack(self._inner.board_id, self._writer, int(notification_id))

    def __getattr__(self, name: str) -> Any:
        return getattr(self._inner, name)
