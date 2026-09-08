"""The database, and every statement the platform runs against it.

One pool serves every request. The schema is brought up to date when the server
opens the database, so a deployment starts by starting rather than by running a
migration tool it also has to operate. What that means and why it is safe with
several replicas is in `migrate.py`.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Iterator, Sequence
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING, Any

from psycopg import Connection
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from psycopg_pool import ConnectionPool

from blackboardxray.events import Event, EventKind
from blackboardxray.server.migrate import migrate

if TYPE_CHECKING:  # pragma: no cover
    from blackboardxray.server.people import People

#: What a token looks like. The prefix is shown in the interface; the rest is
#: shown once, when the key is made, and never again.
TOKEN_PREFIX = "bxr_"


@dataclass(frozen=True)
class Project:
    id: int
    slug: str
    name: str


class Database:
    """A pool, the schema, and the statements the platform runs."""

    def __init__(self, dsn: str, *, min_size: int = 1, max_size: int = 8) -> None:
        self._pool = ConnectionPool(
            dsn,
            min_size=min_size,
            max_size=max_size,
            open=True,
            kwargs={"autocommit": False},
        )
        self._people: People | None = None
        self._pool.wait(timeout=10)
        self.migrate()

    @property
    def people(self) -> People:
        """Users, organizations, projects and keys, over the same pool."""
        if self._people is None:
            from blackboardxray.server.people import People

            self._people = People(self)
        return self._people

    @contextmanager
    def connection(self) -> Iterator[Connection[Any]]:
        with self._pool.connection() as connection:
            connection.row_factory = dict_row  # type: ignore[assignment]
            yield connection

    def close(self) -> None:
        self._pool.close()

    def migrate(self) -> list[int]:
        """Brings the database up to the schema this build reads."""
        with self.connection() as connection:
            return migrate(connection)

    def healthy(self) -> bool:
        try:
            with self.connection() as connection, connection.cursor() as cursor:
                cursor.execute("SELECT 1")
                return cursor.fetchone() is not None
        except Exception:
            return False

    # Projects and keys

    def authenticate(self, token: str) -> Project | None:
        """Answers the project a token names, or nothing where it names none.

        The last used stamp is written at most once a minute per key. It was
        written on every request, which turned the hottest path in the platform
        into an update and made a busy sender contend on one row. Nobody reads
        that column to the second.
        """
        if not token:
            return None
        with self.connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    "SELECT k.project_id, p.slug, p.name,"
                    " k.last_used_at < now() - interval '1 minute'"
                    "   OR k.last_used_at IS NULL AS stale"
                    " FROM xray_api_keys k JOIN xray_projects p"
                    "   ON p.id = k.project_id"
                    " WHERE k.token_hash = %s AND k.disabled_at IS NULL",
                    (_hash(token),),
                )
                found = cursor.fetchone()
                if found is None:
                    connection.rollback()
                    return None
                if found["stale"]:
                    cursor.execute(
                        "UPDATE xray_api_keys SET last_used_at = now()"
                        " WHERE token_hash = %s",
                        (_hash(token),),
                    )
            connection.commit()
        return Project(
            id=int(found["project_id"]), slug=found["slug"], name=found["name"]
        )

    def ingest(self, project_id: int, events: Sequence[Event]) -> int:
        """Stores a batch and moves the counters, in one transaction.

        An event identifier is written once however many times it arrives, so a
        batch resent after a timeout adds nothing. The counters move only for
        the events this call actually inserted, which is what makes a resend
        free rather than double-counted.
        """
        if not events:
            return 0
        with self.connection() as connection:
            with connection.cursor() as cursor:
                boards = {event.board_id for event in events}
                for board_id in boards:
                    cursor.execute(
                        "INSERT INTO xray_runs (project_id, board_id)"
                        " VALUES (%s, %s) ON CONFLICT DO NOTHING",
                        (project_id, board_id),
                    )
                stored: list[dict[str, Any]] = []
                for event in events:
                    cursor.execute(
                        "INSERT INTO xray_events"
                        " (project_id, board_id, event_id, kind, at, sequence,"
                        "  agent, region, body)"
                        " VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)"
                        " ON CONFLICT (project_id, event_id) DO NOTHING"
                        " RETURNING kind, board_id, sequence, at, agent, body",
                        (
                            project_id,
                            event.board_id,
                            event.event_id,
                            event.kind,
                            event.at,
                            event.sequence,
                            event.agent,
                            event.region,
                            Jsonb(event.body),
                        ),
                    )
                    row = cursor.fetchone()
                    if row is not None:
                        stored.append(row)
                for board_id in boards:
                    mine = [row for row in stored if row["board_id"] == board_id]
                    if mine:
                        _move_counters(cursor, project_id, board_id, mine)
            connection.commit()
        return len(stored)

    # Reading

    def overview(self, project_id: int) -> dict[str, Any]:
        rows = self._rows(
            "SELECT"
            " count(*) AS runs,"
            " count(*) FILTER (WHERE outcome IS NULL) AS open,"
            " count(*) FILTER (WHERE outcome = 'settled') AS settled,"
            " count(*) FILTER (WHERE outcome = 'wall_clock_expired') AS expired,"
            " count(*) FILTER (WHERE outcome = 'aborted') AS aborted,"
            " count(*) FILTER (WHERE cardinality(unfinished) > 0) AS with_unfinished,"
            " coalesce(sum(n_writes), 0)::bigint AS writes,"
            " coalesce(sum(n_refusals), 0)::bigint AS refusals,"
            " coalesce(sum(n_conflicts), 0)::bigint AS conflicts,"
            " coalesce(sum(n_dispatched), 0)::bigint AS dispatched,"
            " coalesce(sum(n_acked), 0)::bigint AS acked,"
            " coalesce(sum(n_failed), 0)::bigint AS failed"
            " FROM xray_runs WHERE project_id = %s",
            (project_id,),
        )
        summary = rows[0] if rows else {}
        summary["recent"] = self.list_runs(project_id, limit=8)
        summary["busiest_agents"] = self.list_agents(project_id, limit=5)
        return summary

    def list_runs(
        self,
        project_id: int,
        *,
        limit: int = 50,
        offset: int = 0,
        outcome: str | None = None,
        agent: str | None = None,
        search: str | None = None,
        unfinished: bool = False,
        since: datetime | None = None,
        until: datetime | None = None,
    ) -> list[dict[str, Any]]:
        where, args = _narrow(
            project_id,
            outcome=outcome,
            agent=agent,
            search=search,
            unfinished=unfinished,
            since=since,
            until=until,
        )
        args.extend([limit, offset])
        return self._rows(
            "SELECT * FROM xray_runs WHERE "
            + where
            + " ORDER BY last_event_at DESC LIMIT %s OFFSET %s",
            tuple(args),
        )

    def count_runs(
        self,
        project_id: int,
        *,
        outcome: str | None = None,
        agent: str | None = None,
        search: str | None = None,
        unfinished: bool = False,
        since: datetime | None = None,
        until: datetime | None = None,
    ) -> int:
        where, args = _narrow(
            project_id,
            outcome=outcome,
            agent=agent,
            search=search,
            unfinished=unfinished,
            since=since,
            until=until,
        )
        rows = self._rows(
            "SELECT count(*) AS total FROM xray_runs WHERE " + where, tuple(args)
        )
        return int(rows[0]["total"]) if rows else 0

    def histogram(
        self,
        project_id: int,
        *,
        step_seconds: float,
        buckets: int,
        until: datetime | None = None,
        outcome: str | None = None,
        agent: str | None = None,
        search: str | None = None,
        unfinished: bool = False,
    ) -> dict[str, Any]:
        """Returns runs opened per interval, split by outcome, gaps included.

        The chart it feeds is continuous, so an interval in which nothing
        opened has to arrive as a zero rather than be absent. A client cannot
        infer the difference: a missing bucket and a quiet one look the same
        once the rows are drawn side by side, and the quiet one is the reading
        an operator most needs.
        """
        step = timedelta(seconds=max(1.0, step_seconds))
        edge = _floor(until if until is not None else datetime.now(UTC), step)
        origin = edge - step * (max(1, buckets) - 1)
        where, args = _narrow(
            project_id,
            outcome=outcome,
            agent=agent,
            search=search,
            unfinished=unfinished,
        )
        rows = self._rows(
            "WITH slot AS ("
            "  SELECT generate_series(%s::timestamptz, %s::timestamptz, %s::interval)"
            "    AS at"
            "), tally AS ("
            "  SELECT date_bin(%s::interval, opened_at, %s::timestamptz) AS at,"
            "   count(*) FILTER (WHERE outcome IS NULL) AS open,"
            "   count(*) FILTER (WHERE outcome = 'settled') AS settled,"
            "   count(*) FILTER (WHERE outcome = 'aborted') AS aborted,"
            "   count(*) FILTER (WHERE outcome = 'wall_clock_expired') AS expired"
            "  FROM xray_runs WHERE " + where + " AND opened_at >= %s::timestamptz"
            "  GROUP BY 1"
            ")"
            " SELECT slot.at,"
            "  coalesce(tally.open, 0)::bigint AS open,"
            "  coalesce(tally.settled, 0)::bigint AS settled,"
            "  coalesce(tally.aborted, 0)::bigint AS aborted,"
            "  coalesce(tally.expired, 0)::bigint AS expired"
            " FROM slot LEFT JOIN tally ON tally.at = slot.at ORDER BY slot.at",
            (origin, edge, step, step, origin, *args, origin),
        )
        return {
            "step_seconds": step.total_seconds(),
            "from": origin,
            "to": edge + step,
            "buckets": rows,
        }

    def facets(
        self,
        project_id: int,
        *,
        agent: str | None = None,
        search: str | None = None,
        since: datetime | None = None,
        until: datetime | None = None,
    ) -> dict[str, Any]:
        """Returns how many runs each choice would leave, at the current query.

        A facet count is taken with every filter applied except its own. A
        count taken with its own filter applied reads one for the choice
        already made and zero for every other, which tells an operator nothing
        about where to go next.
        """
        where, args = _narrow(
            project_id, agent=agent, search=search, since=since, until=until
        )
        rows = self._rows(
            "SELECT"
            " count(*) AS total,"
            " count(*) FILTER (WHERE outcome IS NULL) AS open,"
            " count(*) FILTER (WHERE outcome = 'settled') AS settled,"
            " count(*) FILTER (WHERE outcome = 'aborted') AS aborted,"
            " count(*) FILTER (WHERE outcome = 'wall_clock_expired') AS expired,"
            " count(*) FILTER (WHERE cardinality(unfinished) > 0) AS unfinished,"
            " coalesce(sum(n_refusals), 0)::bigint AS refusals,"
            " coalesce(sum(n_conflicts), 0)::bigint AS conflicts,"
            " coalesce(sum(n_failed), 0)::bigint AS failed,"
            " coalesce(sum(n_writes), 0)::bigint AS writes"
            " FROM xray_runs WHERE " + where,
            tuple(args),
        )
        counts = rows[0] if rows else {}
        counts["agents"] = self._rows(
            "SELECT name, count(*)::bigint AS runs FROM xray_runs,"
            " unnest(agents) AS name WHERE " + where + " GROUP BY name"
            " ORDER BY runs DESC, name LIMIT 24",
            tuple(args),
        )
        return counts

    def get_run(self, project_id: int, board_id: str) -> dict[str, Any] | None:
        rows = self._rows(
            "SELECT * FROM xray_runs WHERE project_id = %s AND board_id = %s",
            (project_id, board_id),
        )
        return rows[0] if rows else None

    def list_events(
        self,
        project_id: int,
        board_id: str,
        *,
        limit: int = 500,
        after: int = 0,
        kinds: Sequence[str] | None = None,
        agent: str | None = None,
    ) -> list[dict[str, Any]]:
        where = ["project_id = %s", "board_id = %s", "id > %s"]
        args: list[Any] = [project_id, board_id, after]
        if kinds:
            where.append("kind = ANY(%s)")
            args.append(list(kinds))
        if agent:
            where.append("agent = %s")
            args.append(agent)
        args.append(limit)
        return self._rows(
            "SELECT id, event_id, kind, at, received_at, sequence, agent, region, body"
            " FROM xray_events WHERE " + " AND ".join(where) + " ORDER BY id LIMIT %s",
            tuple(args),
        )

    def list_agents(self, project_id: int, *, limit: int = 100) -> list[dict[str, Any]]:
        """Every agent seen, and how it behaved, across every run.

        The response time is the gap between a notification leaving and the
        acknowledgment that covered it, joined on the identifier the two
        events share.
        """
        return self._rows(
            """
            WITH seen AS (
                SELECT agent,
                       count(*) FILTER (WHERE kind = 'write.admitted') AS writes,
                       count(*) FILTER (WHERE kind = 'premise.set') AS premise_sets,
                       count(*) FILTER (WHERE kind = 'write.refused') AS refusals,
                       count(*) FILTER (WHERE kind = 'write.conflicted') AS conflicts,
                       count(*) FILTER (WHERE kind = 'notification.dispatched')
                           AS dispatched,
                       count(*) FILTER (WHERE kind = 'notification.acknowledged')
                           AS acked,
                       count(*) FILTER (WHERE kind = 'notification.failed')
                           AS failed,
                       count(DISTINCT board_id) AS runs,
                       max(at) AS last_seen
                FROM xray_events
                WHERE project_id = %s AND agent IS NOT NULL
                GROUP BY agent
            ),
            answered AS (
                SELECT d.agent,
                       percentile_disc(0.5) WITHIN GROUP (
                           ORDER BY EXTRACT(EPOCH FROM (a.at - d.at))
                       ) AS median_response
                FROM xray_events d
                JOIN xray_events a
                  ON a.project_id = d.project_id
                 AND a.board_id = d.board_id
                 AND a.agent = d.agent
                 AND a.kind = 'notification.acknowledged'
                 AND (a.body ->> 'notification_id')
                     = (d.body ->> 'notification_id')
                WHERE d.project_id = %s AND d.kind = 'notification.dispatched'
                GROUP BY d.agent
            ),
            stranded AS (
                SELECT u.agent, count(*) AS unfinished_in
                FROM xray_runs r, unnest(r.unfinished) AS u(agent)
                WHERE r.project_id = %s
                GROUP BY u.agent
            )
            SELECT seen.*,
                   coalesce(answered.median_response, NULL) AS median_response,
                   coalesce(stranded.unfinished_in, 0) AS unfinished_in
            FROM seen
            LEFT JOIN answered ON answered.agent = seen.agent
            LEFT JOIN stranded ON stranded.agent = seen.agent
            ORDER BY (seen.writes + seen.dispatched) DESC, seen.agent
            LIMIT %s
            """,
            (project_id, project_id, project_id, limit),
        )

    def get_agent(self, project_id: int, agent: str) -> dict[str, Any] | None:
        found = [
            a for a in self.list_agents(project_id, limit=1000) if a["agent"] == agent
        ]
        if not found:
            return None
        one = found[0]
        one["runs_seen"] = self.list_runs(project_id, agent=agent, limit=50)
        # What an agent subscribes to is not on the agent; it is on the most
        # recent registration, because an agent that re-registers replaces its
        # own declaration and the newest one is what the run acted on.
        declared = self._rows(
            "SELECT body FROM xray_events"
            " WHERE project_id = %s AND agent = %s AND kind = 'agent.registered'"
            " ORDER BY id DESC LIMIT 1",
            (project_id, agent),
        )
        body = _body(declared[0]) if declared else {}
        one["subscribes_to"] = body.get("subscribes_to")
        one["writes_to"] = body.get("writes_to")
        return one

    def rows(self, statement: str, args: tuple[Any, ...] = ()) -> list[dict[str, Any]]:
        """Runs a read and returns every row of it."""
        with self.connection() as connection, connection.cursor() as cursor:
            cursor.execute(statement, args)
            return list(cursor.fetchall())

    def run(self, statement: str, args: tuple[Any, ...] = ()) -> int:
        """Runs a write, commits it, and answers how many rows it touched."""
        with self.connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute(statement, args)
                touched = cursor.rowcount
            connection.commit()
        return int(touched)

    _rows = rows


def _move_counters(
    cursor: Any, project_id: int, board_id: str, rows: list[dict[str, Any]]
) -> None:
    """Applies one board's new events to its run row."""
    counts = {
        "n_writes": _count(rows, EventKind.WRITE_ADMITTED),
        "n_premise_sets": _count(rows, EventKind.PREMISE_SET),
        "n_refusals": _count(rows, EventKind.WRITE_REFUSED),
        "n_conflicts": _count(rows, EventKind.WRITE_CONFLICTED),
        "n_dispatched": _count(rows, EventKind.NOTIFICATION_DISPATCHED),
        "n_acked": _count(rows, EventKind.NOTIFICATION_ACKNOWLEDGED),
        "n_failed": _count(rows, EventKind.NOTIFICATION_FAILED),
    }
    sequences = [row["sequence"] for row in rows if row["sequence"] is not None]
    instants = [row["at"] for row in rows]
    agents = sorted({row["agent"] for row in rows if row["agent"]})
    cursor.execute(
        "UPDATE xray_runs SET"
        " n_events = n_events + %s,"
        " n_writes = n_writes + %s,"
        " n_premise_sets = n_premise_sets + %s,"
        " n_refusals = n_refusals + %s,"
        " n_conflicts = n_conflicts + %s,"
        " n_dispatched = n_dispatched + %s,"
        " n_acked = n_acked + %s,"
        " n_failed = n_failed + %s,"
        " last_sequence = greatest(last_sequence, %s),"
        " last_event_at = greatest(last_event_at, %s),"
        # array_agg over zero rows answers NULL, and a batch naming no agent
        # would otherwise violate the column's NOT NULL and cost the whole
        # request.
        " agents = coalesce(("
        "   SELECT array_agg(DISTINCT a ORDER BY a)"
        "   FROM unnest(agents || %s::text[]) AS a"
        " ), '{}')"
        " WHERE project_id = %s AND board_id = %s",
        (
            len(rows),
            counts["n_writes"],
            counts["n_premise_sets"],
            counts["n_refusals"],
            counts["n_conflicts"],
            counts["n_dispatched"],
            counts["n_acked"],
            counts["n_failed"],
            max(sequences) if sequences else 0,
            max(instants),
            agents,
            project_id,
            board_id,
        ),
    )
    for row in rows:
        if row["kind"] == EventKind.RUN_OPENED:
            _record_opened(cursor, project_id, board_id, row)
        elif row["kind"] == EventKind.RUN_CLOSED:
            _record_closed(cursor, project_id, board_id, row)


def _record_opened(
    cursor: Any, project_id: int, board_id: str, row: dict[str, Any]
) -> None:
    body = _body(row)
    cursor.execute(
        "UPDATE xray_runs SET opened_at = %s, regions = %s, limits = %s, store = %s"
        " WHERE project_id = %s AND board_id = %s",
        (
            row["at"],
            Jsonb(body.get("regions", [])),
            Jsonb(body.get("limits", {})),
            body.get("store"),
            project_id,
            board_id,
        ),
    )


def _record_closed(
    cursor: Any, project_id: int, board_id: str, row: dict[str, Any]
) -> None:
    body = _body(row)
    unfinished = body.get("unfinished") or []
    cursor.execute(
        "UPDATE xray_runs SET closed_at = %s, outcome = %s, reason = %s,"
        " unfinished = %s WHERE project_id = %s AND board_id = %s",
        (
            row["at"],
            body.get("outcome"),
            body.get("reason"),
            list(unfinished),
            project_id,
            board_id,
        ),
    )


def _body(row: dict[str, Any]) -> dict[str, Any]:
    body = row.get("body")
    if isinstance(body, str):
        try:
            body = json.loads(body)
        except ValueError:
            return {}
    return body if isinstance(body, dict) else {}


def _count(rows: list[dict[str, Any]], kind: str) -> int:
    return sum(1 for row in rows if row["kind"] == kind)


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def instant(value: datetime | None) -> str | None:
    return value.isoformat() if value is not None else None


def _narrow(
    project_id: int,
    *,
    outcome: str | None = None,
    agent: str | None = None,
    search: str | None = None,
    unfinished: bool = False,
    since: datetime | None = None,
    until: datetime | None = None,
) -> tuple[str, list[Any]]:
    """Returns the clause that narrows a run query, and what fills it.

    Every query over runs narrows on the same five things, so they are written
    once. A filter written twice is a filter that drifts, and a facet count
    taken with a clause that has drifted from the list's own is worse than no
    facet count.
    """
    where = ["project_id = %s"]
    args: list[Any] = [project_id]
    if outcome == "open":
        where.append("outcome IS NULL")
    elif outcome:
        where.append("outcome = %s")
        args.append(outcome)
    if agent:
        where.append("%s = ANY(agents)")
        args.append(agent)
    if search:
        where.append("board_id ILIKE %s")
        args.append(f"%{search}%")
    if unfinished:
        where.append("cardinality(unfinished) > 0")
    # A range is half open. A run opened exactly on a bar's right edge belongs
    # to the next bar, and closing both ends would count it in two.
    if since is not None:
        where.append("opened_at >= %s")
        args.append(since)
    if until is not None:
        where.append("opened_at < %s")
        args.append(until)
    return " AND ".join(where), args


def _floor(moment: datetime, step: timedelta) -> datetime:
    """Rounds an instant down onto the bucket grid the histogram is drawn on.

    The grid is anchored to the epoch rather than to now, so a chart redrawn a
    second later has the same bar boundaries and the bars do not slide.
    """
    seconds = int(step.total_seconds())
    stamp = int(moment.timestamp()) // seconds * seconds
    return datetime.fromtimestamp(stamp, tz=UTC)
