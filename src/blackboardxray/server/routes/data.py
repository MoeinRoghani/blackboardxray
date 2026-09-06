"""What a run did. Every route here is scoped to one project and authorized.

These are the reads the interface is built on. They moved under
`/projects/{project}` when projects stopped being globally unique, and they
gained a permission check when reading stopped being open to whoever could
reach the port.

One permission does real work here. A viewer reads what happened and not what
was written: a contribution is the application's own data and may hold anything
it is allowed to hold, so the lowest role that can be handed out sees the shape
of a run and not its contents. That is enforced on the way out, in one place,
rather than by asking every screen to remember.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, Query

from blackboardxray.server.db import Database
from blackboardxray.server.roles import Permission
from blackboardxray.server.security import Access, Caller, Guard, fail

#: How many rows a read answers with when the caller names no limit, and the
#: most it answers with whatever the caller asks for.
DEFAULT_LIMIT = 50
MAX_LIMIT = 1000
DEFAULT_EVENT_LIMIT = 500
MAX_EVENT_LIMIT = 5000

#: The shape of the histogram the index draws when the caller names none: one
#: bar a minute for the last hour. The ceiling on the bucket count is what the
#: chart can draw as separate bars at a plausible width, not what the database
#: can group.
DEFAULT_STEP = 60.0
MAX_STEP = 86_400.0
DEFAULT_BUCKETS = 60
MAX_BUCKETS = 240

#: The body fields that carry a contribution's value rather than its shape.
_CONTENT = ("content", "preview")


def redact(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Removes what was written, leaving what happened.

    The size, the type and the truncation flag stay, so a viewer still sees
    that four kilobytes of an object were admitted at sequence nine. Only the
    value goes.
    """
    for event in events:
        body = event.get("body")
        if not isinstance(body, dict):
            continue
        # A body carries values in exactly two shapes: one envelope under
        # `content`, and a map of them under `premises`. The envelope stays,
        # because the size and the type are what happened; what it holds goes.
        _withhold(body.get("content"))
        premises = body.get("premises")
        if isinstance(premises, dict):
            for one in premises.values():
                _withhold(one)
    return events


def _withhold(carried: Any) -> None:
    if not isinstance(carried, dict):
        return
    if not any(field in carried for field in _CONTENT):
        return
    for field in _CONTENT:
        carried.pop(field, None)
    carried["withheld"] = True


def missing(kind: str, name: str) -> Exception:
    """A 404 that names what was looked for, in the platform's own words."""
    return fail(404, f"unknown_{kind}", f"No {kind} {name!r} in this project.")


def router(store: Database, guard: Guard) -> APIRouter:
    api = APIRouter(prefix="/api/v1/projects/{project}", tags=["data"])

    def reading(project: str, caller: Caller = Depends(guard.caller)) -> Access:
        return guard.project(project, caller, Permission.READ_PROJECT)

    @api.get("/overview")
    def overview(access: Access = Depends(reading)) -> dict[str, Any]:
        return {
            "project": access.project.slug,
            "role": access.role.value,
            **store.overview(access.project.id),
        }

    @api.get("/histogram")
    def histogram(
        access: Access = Depends(reading),
        step: float = Query(default=DEFAULT_STEP, ge=1.0, le=MAX_STEP),
        buckets: int = Query(default=DEFAULT_BUCKETS, ge=2, le=MAX_BUCKETS),
        outcome: str | None = Query(default=None),
        agent: str | None = Query(default=None),
        search: str | None = Query(default=None),
        unfinished: bool = Query(default=False),
    ) -> dict[str, Any]:
        return store.histogram(
            access.project.id,
            step_seconds=step,
            buckets=buckets,
            outcome=outcome,
            agent=agent,
            search=search,
            unfinished=unfinished,
        )

    @api.get("/facets")
    def facets(
        access: Access = Depends(reading),
        agent: str | None = Query(default=None),
        search: str | None = Query(default=None),
        since: datetime | None = Query(default=None),
        until: datetime | None = Query(default=None),
    ) -> dict[str, Any]:
        return store.facets(
            access.project.id, agent=agent, search=search, since=since, until=until
        )

    @api.get("/runs")
    def runs(
        access: Access = Depends(reading),
        limit: int = Query(default=DEFAULT_LIMIT, ge=1, le=MAX_LIMIT),
        offset: int = Query(default=0, ge=0),
        outcome: str | None = Query(default=None),
        agent: str | None = Query(default=None),
        search: str | None = Query(default=None),
        unfinished: bool = Query(default=False),
        since: datetime | None = Query(default=None),
        until: datetime | None = Query(default=None),
    ) -> dict[str, Any]:
        found = store.list_runs(
            access.project.id,
            limit=limit,
            offset=offset,
            outcome=outcome,
            agent=agent,
            search=search,
            unfinished=unfinished,
            since=since,
            until=until,
        )
        return {
            "runs": found,
            "total": store.count_runs(
                access.project.id,
                outcome=outcome,
                agent=agent,
                search=search,
                unfinished=unfinished,
                since=since,
                until=until,
            ),
            "limit": limit,
            "offset": offset,
        }

    @api.get("/runs/{board_id:path}/events")
    def events(
        board_id: str,
        access: Access = Depends(reading),
        after: int = Query(default=0, ge=0),
        limit: int = Query(default=DEFAULT_EVENT_LIMIT, ge=1, le=MAX_EVENT_LIMIT),
        kind: list[str] | None = Query(default=None),
        agent: str | None = Query(default=None),
    ) -> dict[str, Any]:
        if store.get_run(access.project.id, board_id) is None:
            raise missing("run", board_id)
        found = store.list_events(
            access.project.id,
            board_id,
            limit=limit,
            after=after,
            kinds=kind,
            agent=agent,
        )
        if not access.may(Permission.READ_CONTENT):
            found = redact(found)
        return {
            "events": found,
            "has_more": len(found) == limit,
            "next_after": found[-1]["id"] if found else after,
        }

    @api.get("/runs/{board_id:path}")
    def run(board_id: str, access: Access = Depends(reading)) -> dict[str, Any]:
        found = store.get_run(access.project.id, board_id)
        if found is None:
            raise missing("run", board_id)
        return found

    @api.get("/agents")
    def agents(
        access: Access = Depends(reading),
        limit: int = Query(default=100, ge=1, le=MAX_LIMIT),
    ) -> dict[str, Any]:
        return {"agents": store.list_agents(access.project.id, limit=limit)}

    @api.get("/agents/{name}")
    def agent(name: str, access: Access = Depends(reading)) -> dict[str, Any]:
        found = store.get_agent(access.project.id, name)
        if found is None:
            raise missing("agent", name)
        return found

    return api
