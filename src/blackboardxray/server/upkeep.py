"""The work the platform does when nobody asked it to.

Two jobs, one loop. Runs older than a project's retention are deleted, and
sessions that have expired are removed. Neither is urgent and both are
unbounded if left alone, which is the combination that makes a background
sweeper the right shape rather than a cron entry somebody has to remember to
add.

**One sweeper, however many replicas.** The loop takes an advisory lock before
it does anything, and a replica that does not get it goes back to sleep. Four
containers each deleting the same rows is four times the work and a deadlock
waiting to happen.

**Deleted in chunks.** A project that has been running for a year and has
retention set for the first time has a lot to remove, and `DELETE` with no
limit takes one long lock over the table the interface is reading. A bounded
delete repeated until it stops finding rows takes the same total time and
never holds anything for long.
"""

from __future__ import annotations

import logging
import threading
from dataclasses import dataclass

from blackboardxray.server.db import Database

logger = logging.getLogger("blackboardxray.upkeep")

#: The lock one replica holds while it sweeps.
LOCK = 0x62787261_73776565 - (1 << 63)

#: How many rows one statement removes. Small enough that the lock it takes is
#: never noticed, large enough that a big backlog still drains.
CHUNK = 5_000

#: The most chunks one pass will do, so a year of backlog is worked off over
#: several passes rather than in one that runs for an hour.
MAX_CHUNKS = 40

#: How often the loop wakes. Retention is measured in days; nothing here needs
#: to be prompt.
INTERVAL_SECONDS = 300.0


@dataclass(frozen=True)
class Swept:
    """What one pass removed."""

    events: int
    runs: int
    sessions: int

    @property
    def anything(self) -> bool:
        return bool(self.events or self.runs or self.sessions)


def sweep(store: Database) -> Swept:
    """Removes what has aged out. Safe to call from anywhere, at any time."""
    events = 0
    runs = 0
    for _ in range(MAX_CHUNKS):
        removed = store.run(
            "DELETE FROM xray_events WHERE ctid IN ("
            "  SELECT e.ctid FROM xray_events e"
            "  JOIN xray_projects p ON p.id = e.project_id"
            "  WHERE p.retention_days IS NOT NULL"
            "    AND e.received_at < now() - make_interval(days => p.retention_days)"
            "  LIMIT %s)",
            (CHUNK,),
        )
        events += removed
        if removed < CHUNK:
            break

    # Runs go after their events, so a run row never outlives the events it
    # counted and a partial sweep leaves a run whose counters are ahead of what
    # is there rather than a run that vanished with its events still present.
    for _ in range(MAX_CHUNKS):
        removed = store.run(
            "DELETE FROM xray_runs WHERE (project_id, board_id) IN ("
            "  SELECT r.project_id, r.board_id FROM xray_runs r"
            "  JOIN xray_projects p ON p.id = r.project_id"
            "  WHERE p.retention_days IS NOT NULL"
            "    AND r.last_event_at < now() - make_interval(days => p.retention_days)"
            "  LIMIT %s)",
            (CHUNK,),
        )
        runs += removed
        if removed < CHUNK:
            break

    sessions = store.people.sweep_sessions()
    return Swept(events=events, runs=runs, sessions=sessions)


class Upkeep:
    """The loop, and the lock that means only one replica runs it."""

    def __init__(self, store: Database, interval: float = INTERVAL_SECONDS) -> None:
        self._store = store
        self._interval = interval
        self._stop = threading.Event()
        self._thread = threading.Thread(
            target=self._loop, name="blackboardxray-upkeep", daemon=True
        )

    def start(self) -> None:
        self._thread.start()

    def stop(self, timeout: float = 5.0) -> None:
        """Asks the loop to finish and waits for it, briefly."""
        self._stop.set()
        if self._thread.is_alive():
            self._thread.join(timeout)

    def _loop(self) -> None:
        # A first pass shortly after start, then on the interval. Not
        # immediately: a container that crash loops would otherwise spend every
        # short life sweeping instead of serving.
        while not self._stop.wait(min(30.0, self._interval)):
            try:
                self._once()
            except Exception:  # pragma: no cover - a sweep must not kill serving
                logger.warning("blackboardxray upkeep failed", exc_info=True)
            if self._stop.wait(self._interval):
                return

    def _once(self) -> None:
        with self._store.connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute("SELECT pg_try_advisory_lock(%s) AS held", (LOCK,))
                row = cursor.fetchone()
            connection.commit()
            held = bool(row and row["held"])
            if not held:
                # Another replica is sweeping. There is nothing useful to do
                # about that except come back later.
                return
            try:
                swept = sweep(self._store)
                if swept.anything:
                    logger.info(
                        "blackboardxray removed %d events, %d runs and %d"
                        " expired sessions",
                        swept.events,
                        swept.runs,
                        swept.sessions,
                    )
            finally:
                with connection.cursor() as cursor:
                    cursor.execute("SELECT pg_advisory_unlock(%s)", (LOCK,))
                connection.commit()
