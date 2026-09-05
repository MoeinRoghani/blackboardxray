"""Runs real blackboard models through the platform, for a database to look at.

Everything here goes through the public path: `Xray.create_model` wraps the
library's own `create_model`, the agents write and acknowledge through the
objects the library hands them, and every event reaches the server over HTTP.
Nothing is inserted into Postgres by hand, so what the interface shows is what
an actual deployment would produce.

    BLACKBOARDXRAY_TOKEN=bxr_... python examples/seed.py
"""

from __future__ import annotations

import os
import random
import time
from datetime import timedelta

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
)

from blackboardxray import Xray

ENDPOINT = os.environ.get("BLACKBOARDXRAY_ENDPOINT", "http://127.0.0.1:8900")
TOKEN = os.environ["BLACKBOARDXRAY_TOKEN"]

SERVICES = [
    "payments-ledger",
    "auth-broker",
    "statement-render",
    "card-authorise",
    "fx-quote",
    "notify-fanout",
]

SIGNALS = [
    {"source": "prometheus", "alert": "PodOOMKilled", "count": 14},
    {"source": "prometheus", "alert": "LatencyP99Above2s", "count": 3},
    {"source": "sentry", "alert": "UnhandledRejection", "count": 211},
    {"source": "kube", "alert": "CrashLoopBackOff", "count": 6},
    {"source": "synthetics", "alert": "CheckoutJourneyFailed", "count": 2},
]

FINDINGS = [
    {"cause": "a memory limit lowered in the last deploy", "confidence": 0.82},
    {"cause": "connection pool exhausted against the primary", "confidence": 0.64},
    {"cause": "a dependency published a breaking minor", "confidence": 0.41},
    {"cause": "certificate rotation left one replica stale", "confidence": 0.77},
    {"cause": "retry storm from the upstream gateway", "confidence": 0.58},
]


def regions() -> list[Level | Premise]:
    return [
        Level("signals"),
        Level("findings"),
        Level("hypotheses", batch_window=timedelta(milliseconds=50)),
        Premise("service"),
        Premise("window"),
        Premise("severity"),
    ]


def opening(service: str) -> dict[str, object]:
    return {
        "service": service,
        "window": ["2026-09-05T02:10:00Z", "2026-09-05T02:40:00Z"],
        "severity": "sev2",
    }


def refuse_low_confidence(proposed: ProposedWrite, reader: object) -> Accept | Reject:
    """An admission rule that produces real refusals to look at."""
    if isinstance(proposed, ProposedContribution) and proposed.level == "findings":
        content = proposed.content
        if isinstance(content, dict) and content.get("confidence", 1.0) < 0.5:
            return Reject(
                reason="a finding below 0.5 confidence is not admitted to findings; "
                "put it in hypotheses"
            )
    return Accept()


class Unreachable:
    """An agent whose endpoint is not answering, so delivery raises.

    The control component contains the exception, the agent never learns what
    it was owed, and the run closes naming it unfinished. That path has no
    other way of being seen, which is the argument for recording it.
    """

    writes = ""

    def __init__(self, name: str) -> None:
        self.name = name
        self.board: object | None = None

    def __call__(self, notification: Notification) -> None:
        raise ConnectionError(f"{self.name} is not answering on port 8081")


class Worker:
    """One agent, doing what an agent does: read, decide, write, acknowledge."""

    def __init__(self, name: str, *, writes: str, answers: bool = True) -> None:
        self.name = name
        self.writes = writes
        self.answers = answers
        self.board: object | None = None
        self.seen: list[Notification] = []

    def __call__(self, notification: Notification) -> None:
        self.seen.append(notification)
        board = self.board
        if board is None:
            return
        board.read_board(notification.from_sequence)  # type: ignore[attr-defined]
        if self.writes == "signals":
            board.write("signals", random.choice(SIGNALS))  # type: ignore[attr-defined]
        elif self.writes == "findings":
            board.write("findings", random.choice(FINDINGS))  # type: ignore[attr-defined]
        elif self.writes == "hypotheses":
            board.write(  # type: ignore[attr-defined]
                "hypotheses",
                {"guess": random.choice(FINDINGS)["cause"], "rank": len(self.seen)},
            )
        if self.answers:
            board.ack(notification.notification_id)  # type: ignore[attr-defined]


def run_one(
    xray: Xray,
    board_id: str,
    *,
    service: str,
    idle: float,
    wall: float,
    silent_agent: bool = False,
    breaking_agent: bool = False,
    abort_after: float | None = None,
    leave_open: bool = False,
) -> None:
    workers = [
        Worker("triage", writes="signals"),
        Worker("ocp", writes="findings"),
        Worker("dependency", writes="hypotheses"),
    ]
    if silent_agent:
        workers.append(Worker("netops", writes="hypotheses", answers=False))
    if breaking_agent:
        # A dunder is looked up on the type, so replacing it on an instance
        # would not be called. The unreachable agent is a plain function.
        workers.append(Unreachable("changelog"))

    model = xray.create_model(
        board_id=board_id,
        store=InMemoryStore(),
        regions=regions(),
        premises=opening(service),
        agents=[
            Agent(
                name=worker.name,
                notify=worker,
                subscribes_to={"signals", "findings", "service", "severity"}
                if worker.name != "triage"
                else {"service", "window", "severity"},
                writes_to={worker.writes} if worker.writes else None,
            )
            for worker in workers
        ],
        admission_rule=refuse_low_confidence,
        limits=RunLimits(
            wall_clock=timedelta(seconds=wall), idle=timedelta(seconds=idle)
        ),
    )
    for worker in workers:
        worker.board = model.control.as_agent(worker.name)

    # A premise moves while the run is under way, which is what produces a
    # conflict when two writers name the same version.
    severity = model.reader.read_premise("severity")
    model.control.set_premise("severity", "sev1", severity.version, writer="ocp")
    model.control.set_premise("severity", "sev3", severity.version, writer="dependency")

    if abort_after is not None:
        time.sleep(abort_after)
        model.control.abort("the incident was resolved by a rollback")
        return
    if leave_open:
        return
    model.control.wait_closed(timeout=timedelta(seconds=wall + idle + 5))


def main() -> None:
    random.seed(1904)
    with Xray(endpoint=ENDPOINT, token=TOKEN, content_limit=2048) as xray:
        print("seeding runs")
        run_one(xray, "incident-4471", service=SERVICES[0], idle=0.4, wall=20)
        run_one(
            xray,
            "incident-4472",
            service=SERVICES[1],
            idle=0.4,
            wall=20,
            silent_agent=True,
        )
        run_one(
            xray,
            "incident-4473",
            service=SERVICES[2],
            idle=0.4,
            wall=20,
            breaking_agent=True,
        )
        run_one(xray, "incident-4474", service=SERVICES[3], idle=30, wall=1.2)
        run_one(
            xray,
            "incident-4475",
            service=SERVICES[4],
            idle=30,
            wall=60,
            abort_after=0.3,
        )
        run_one(
            xray,
            "incident-4476",
            service=SERVICES[5],
            idle=120,
            wall=600,
            leave_open=True,
        )
        print(f"queued, flushing: sent={xray.sent} dropped={xray.dropped}")
        xray.flush(20)
        print(f"done: sent={xray.sent} dropped={xray.dropped}")


if __name__ == "__main__":
    main()
