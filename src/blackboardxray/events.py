"""What crosses between an observed application and the platform.

One body, `Event`, carries every kind. The kind names what happened and the
body carries what is particular to it, so a kind added later reaches an older
server as a row it stores and does not interpret, rather than as a request it
refuses.

Decoding is tolerant for the same reason the library's own wire is: the two
halves are deployed separately and are therefore versioned separately. A field
a decoder does not recognise is ignored, a field that is absent takes its
default, and a name is never reused for a different meaning.

Nothing here imports `blackboard`. The client half must install on an
application that has the library, and the server half on a machine that does
not, so the vocabulary they agree on cannot depend on either.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

#: The schema this version of the platform sends and reads.
#:
#: Raise it when a change makes an event unreadable by an earlier server.
#: Adding a body field an older server ignores is not such a change.
SCHEMA_VERSION = 1


class EventKind:
    """Every kind of event, and nothing else is invented.

    Each names something the control component decided or an agent did. The
    board's own record answers what was written; these answer what the run
    did about it.
    """

    #: A run was created, with its regions, its opening premises and its limits.
    RUN_OPENED = "run.opened"
    #: An agent joined, at creation or afterwards.
    AGENT_REGISTERED = "agent.registered"
    #: A level write passed admission and reached the board.
    WRITE_ADMITTED = "write.admitted"
    #: A write was refused, with the cause and the reason the rule gave.
    WRITE_REFUSED = "write.refused"
    #: A premise write named a version that was no longer current.
    WRITE_CONFLICTED = "write.conflicted"
    #: A premise write passed admission and reached the board.
    PREMISE_SET = "premise.set"
    #: A notification left the control component for one agent.
    NOTIFICATION_DISPATCHED = "notification.dispatched"
    #: An agent reported that it had stopped working on a notification.
    NOTIFICATION_ACKNOWLEDGED = "notification.acknowledged"
    #: Delivering a notification raised. The agent never received it.
    NOTIFICATION_FAILED = "notification.failed"
    #: The run closed, with its outcome and the agents that did not finish.
    RUN_CLOSED = "run.closed"

    ALL: tuple[str, ...] = (
        RUN_OPENED,
        AGENT_REGISTERED,
        WRITE_ADMITTED,
        WRITE_REFUSED,
        WRITE_CONFLICTED,
        PREMISE_SET,
        NOTIFICATION_DISPATCHED,
        NOTIFICATION_ACKNOWLEDGED,
        NOTIFICATION_FAILED,
        RUN_CLOSED,
    )


class XrayError(Exception):
    """The base of every error this package raises."""


class EventError(XrayError):
    """An event could not be decoded because a field it needs is missing."""


def _now() -> datetime:
    return datetime.now(UTC)


@dataclass(frozen=True)
class Event:
    """One thing that happened in one run.

    ``event_id`` is the idempotency key. The server writes an identifier once
    however many times it arrives, so a batch resent after a timeout adds
    nothing. The client generates it, because only the client knows that two
    attempts are the same attempt.

    ``sequence`` is the board's own number where the event has one, and the
    interface is built on it rather than on ``at``. ``at`` is the sending
    process's clock and is used for latency alone, because agents run as
    separate services and their clocks disagree.

    ``body`` carries what is particular to the kind. It is plain JSON, and a
    server stores a body whose fields it does not recognise rather than
    refusing it.
    """

    board_id: str
    kind: str
    event_id: str = field(default_factory=lambda: uuid4().hex)
    at: datetime = field(default_factory=_now)
    sequence: int | None = None
    agent: str | None = None
    region: str | None = None
    body: dict[str, Any] = field(default_factory=dict)

    def to_json(self) -> dict[str, Any]:
        """Returns this event as plain JSON types."""
        return {
            "event_id": self.event_id,
            "board_id": self.board_id,
            "kind": self.kind,
            "at": self.at.isoformat(),
            "sequence": self.sequence,
            "agent": self.agent,
            "region": self.region,
            "body": self.body,
        }

    @classmethod
    def from_json(cls, body: object) -> Event:
        """Builds an event from what arrived, ignoring what it does not know."""
        if not isinstance(body, dict):
            raise EventError(f"an event is an object, not {type(body).__name__}")
        for required in ("board_id", "kind"):
            if not body.get(required):
                raise EventError(f"an event needs {required!r}")
        return cls(
            board_id=str(body["board_id"]),
            kind=str(body["kind"]),
            event_id=str(body.get("event_id") or uuid4().hex),
            at=_instant(body.get("at")),
            sequence=_whole(body.get("sequence")),
            agent=_text(body.get("agent")),
            region=_text(body.get("region")),
            body=_object(body.get("body")),
        )


def _instant(given: object) -> datetime:
    """Reads an ISO-8601 instant, falling back to now rather than refusing.

    An event whose clock could not be read is still an event that happened.
    Refusing the batch it arrived in would lose nine good events for one bad
    field.
    """
    if isinstance(given, str):
        try:
            read = datetime.fromisoformat(given)
        except ValueError:
            return _now()
        return read if read.tzinfo is not None else read.replace(tzinfo=UTC)
    return _now()


def _whole(given: object) -> int | None:
    if isinstance(given, bool) or given is None:
        return None
    if isinstance(given, int):
        return given
    if isinstance(given, str) and given.lstrip("-").isdigit():
        return int(given)
    return None


def _text(given: object) -> str | None:
    return given if isinstance(given, str) and given else None


def _object(given: object) -> dict[str, Any]:
    """A body that is not an object takes the empty one rather than refusing."""
    return {str(k): v for k, v in given.items()} if isinstance(given, dict) else {}


def carry(content: object, *, limit: int) -> dict[str, Any]:
    """Returns a body's content as the platform stores it, and its true size.

    A contribution is the application's own data and may hold anything it is
    allowed to hold, so the default is to record its size and its shape and
    not its value. Where the caller opted in, the content is carried whole up to
    ``limit`` bytes and truncated past it, with ``truncated`` saying so.

    ``limit`` of zero records the size alone, which is the default.
    """
    try:
        encoded = json.dumps(content, default=str)
    except (TypeError, ValueError):
        return {"bytes": 0, "type": type(content).__name__, "unreadable": True}
    described: dict[str, Any] = {"bytes": len(encoded), "type": _shape(content)}
    if limit <= 0:
        return described
    if len(encoded) <= limit:
        described["content"] = json.loads(encoded)
    else:
        described["preview"] = encoded[:limit]
        described["truncated"] = True
    return described


def _shape(content: object) -> str:
    """Names the shape of a contribution without reading what is in it."""
    if isinstance(content, dict):
        return "object"
    if isinstance(content, list | tuple):
        return "array"
    if isinstance(content, bool):
        return "boolean"
    if isinstance(content, int | float):
        return "number"
    if isinstance(content, str):
        return "string"
    if content is None:
        return "null"
    return type(content).__name__
