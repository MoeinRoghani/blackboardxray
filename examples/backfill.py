"""Fabricates a history, so the interface can be judged at the volume it is for.

`seed.py` runs real models through the real client and is the proof that the
path works. It produces six runs, all of them at the moment it ran, which is
the wrong shape to design against: this platform is for a project opening runs
continuously, and a chart of six runs in one minute answers no question anyone
would ask of it.

So this posts events over the ingest API with the timestamps a day of traffic
would have carried. The vocabulary is the real one and the wire is the real
one; only the clock is invented. Nothing here runs in a deployment.

    BLACKBOARDXRAY_TOKEN=bxr_... python examples/backfill.py [hours] [per_hour]
"""

from __future__ import annotations

import json
import os
import random
import sys
import urllib.request
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import uuid4

ENDPOINT = os.environ.get("BLACKBOARDXRAY_ENDPOINT", "http://127.0.0.1:8900")
TOKEN = os.environ["BLACKBOARDXRAY_TOKEN"]

SERVICES = [
    "payments-ledger",
    "auth-broker",
    "statement-render",
    "card-authorise",
    "fx-quote",
    "notify-fanout",
    "ledger-reconcile",
    "risk-score",
]
AGENTS = ["triage", "ocp", "dependency", "changelog", "netops", "capacity"]
LEVELS = ["signals", "findings", "hypotheses"]
PREMISES = ["service", "window", "severity"]

# What a run costs, so a bar's height means the same thing in every hour.
OUTCOMES = ["settled", "settled", "settled", "settled", "aborted", "wall_clock_expired"]


def _at(moment: datetime) -> str:
    return moment.isoformat()


def _events(board: str, opened: datetime, outcome: str | None) -> list[dict[str, Any]]:
    """Returns one run's worth of events, in the order a run produces them."""
    roster = random.sample(AGENTS, k=random.randint(3, 5))
    out: list[dict[str, Any]] = []
    clock = opened
    sequence = 0
    told = 0

    def add(kind: str, **rest: Any) -> None:
        nonlocal clock
        clock = clock + timedelta(milliseconds=random.randint(40, 900))
        out.append(
            {
                "event_id": uuid4().hex,
                "board_id": board,
                "kind": kind,
                "at": _at(clock),
                **rest,
            }
        )

    add(
        "run.opened",
        body={
            "regions": [{"kind": "level", "name": n} for n in LEVELS]
            + [{"kind": "premise", "name": n} for n in PREMISES],
            "limits": {"idle_seconds": 120.0, "wall_clock_seconds": 600.0},
            "store": "PostgresStore",
        },
    )
    for name in roster:
        add(
            "agent.registered",
            agent=name,
            body={
                "subscribes_to": random.sample(LEVELS, k=random.randint(1, 2)),
                "writes_to": random.sample(LEVELS, k=random.randint(1, 2)),
            },
        )
    for _ in range(random.randint(4, 22)):
        writer = random.choice(roster)
        roll = random.random()
        if roll < 0.05:
            add(
                "write.refused",
                agent=writer,
                region=random.choice(LEVELS),
                body={
                    "cause": "rejected",
                    "reason": "confidence below the floor",
                    "premise": False,
                    "content": {"bytes": random.randint(80, 900), "type": "object"},
                },
            )
            continue
        if roll < 0.12:
            add(
                "write.conflicted",
                agent=writer,
                region=random.choice(PREMISES),
                body={"expected_version": sequence, "current_version": sequence + 1},
            )
            continue
        sequence += 1
        if roll < 0.2:
            add(
                "premise.set",
                agent=writer,
                region=random.choice(PREMISES),
                sequence=sequence,
                body=_carried(sequence, 40, 400),
            )
        else:
            add(
                "write.admitted",
                agent=writer,
                region=random.choice(LEVELS),
                sequence=sequence,
                body=_carried(sequence, 80, 3000),
            )
        for reader in roster:
            if reader == writer or random.random() > 0.55:
                continue
            # A notification takes no sequence of its own. It names the span it
            # is telling the agent about, in its body, which is what the real
            # client sends and what the interface reads.
            told += 1
            add(
                "notification.dispatched",
                agent=reader,
                body={
                    "notification_id": told,
                    "from_sequence": sequence,
                    "to_sequence": sequence,
                    "regions": LEVELS,
                },
            )
            landed = random.random()
            if landed < 0.006:
                add(
                    "notification.failed",
                    agent=reader,
                    body={
                        "notification_id": told,
                        "error": "ConnectionResetError",
                        "detail": "the agent's endpoint reset the connection",
                    },
                )
            elif landed < 0.9:
                add(
                    "notification.acknowledged",
                    agent=reader,
                    body={"notification_id": told},
                )

    if outcome is not None:
        stalled = [a for a in roster if random.random() < 0.1]
        add(
            "run.closed",
            body={
                "outcome": outcome,
                "reason": {
                    "settled": "the termination predicate held",
                    "aborted": "an operator rolled the deploy back",
                    "wall_clock_expired": "the wall clock ran out",
                }[outcome],
                "unfinished": stalled,
            },
        )
    return out


def _carried(version: int, low: int, high: int) -> dict[str, Any]:
    """A write's body, in the shape the real client sends."""
    return {
        "version": version,
        "repeated": False,
        "idempotency_key": None,
        "content": {"bytes": random.randint(low, high), "type": "object"},
    }


def _rate(hour: int, incident: int) -> float:
    """Runs an hour, as a working day plus one incident that doubles it."""
    working = 0.35 + 0.65 * max(0.0, 1.0 - abs(hour - 14) / 9.0)
    return working * (2.4 if hour == incident else 1.0)


def _post(batch: list[dict[str, Any]]) -> None:
    request = urllib.request.Request(
        ENDPOINT.rstrip("/") + "/api/v1/ingest",
        data=json.dumps({"events": batch}).encode("utf-8"),
        method="POST",
        headers={
            "content-type": "application/json",
            "authorization": f"Bearer {TOKEN}",
        },
    )
    with urllib.request.urlopen(request, timeout=60) as answer:
        if answer.status >= 300:
            raise SystemExit(f"ingest answered {answer.status}")


def main() -> None:
    hours = int(sys.argv[1]) if len(sys.argv) > 1 else 24
    per_hour = int(sys.argv[2]) if len(sys.argv) > 2 else 40
    random.seed(4476)
    now = datetime.now(UTC)
    incident = random.randint(2, max(3, hours - 2))
    batch: list[dict[str, Any]] = []
    runs = 0
    for step in range(hours, 0, -1):
        start = now - timedelta(hours=step)
        count = int(per_hour * _rate(hours - step, hours - incident))
        for _ in range(count):
            opened = start + timedelta(seconds=random.uniform(0, 3600))
            runs += 1
            # A run opened in the last few minutes has plausibly not closed.
            still_open = (now - opened).total_seconds() < 240
            outcome = None if still_open else random.choice(OUTCOMES)
            batch.extend(_events(f"incident-{5000 + runs}", opened, outcome))
            if len(batch) >= 800:
                _post(batch)
                batch = []
    if batch:
        _post(batch)
    print(f"backfilled {runs} runs across {hours} hours")


if __name__ == "__main__":
    main()
