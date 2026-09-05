"""The platform's HTTP surface: one route table, and the interface behind it.

Ingestion is authenticated, because a key is how the platform knows which
deployment is sending and because a write matters. Reading is not, and that is
stated in the documentation rather than left to be discovered: this is an
internal tool, it is expected to sit behind whatever already fronts your
internal tools, and a gateway is where a policy about who may read belongs.

Every read answers plain JSON. The built interface is served from `web/`
where it exists, so the platform is one process and one container rather than
a server and a separate static host.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from blackboardxray.events import SCHEMA_VERSION, Event, EventError, EventKind
from blackboardxray.server.db import Database, Project
from blackboardxray.server.settings import Settings

logger = logging.getLogger("blackboardxray.server")

#: The most events one ingestion request carries.
MAX_BATCH = 1000

#: How many rows a read answers with when the caller names no limit, and the
#: most it answers with whatever the caller asks for.
DEFAULT_LIMIT = 50
MAX_LIMIT = 1000
DEFAULT_EVENT_LIMIT = 500
MAX_EVENT_LIMIT = 5000

_WEB = Path(__file__).with_name("web")


def build(settings: Settings, database: Database | None = None) -> FastAPI:
    """Builds the application. A test passes its own database."""
    store = database if database is not None else Database(settings.database_url)
    app = FastAPI(
        title="blackboardxray",
        version="0.1.0",
        description="Observability for blackboard runs.",
        docs_url="/api/docs",
        openapi_url="/api/openapi.json",
    )
    # The interface is a third of a megabyte of JavaScript and stylesheet, and
    # it was going over the wire uncompressed. Text compresses to roughly a
    # third, and the platform is often reached over a link an operator is
    # sharing with everything else during an incident.
    app.add_middleware(GZipMiddleware, minimum_size=1024)
    if settings.allowed_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=list(settings.allowed_origins),
            allow_methods=["GET", "POST"],
            allow_headers=["authorization", "content-type"],
        )
    app.state.db = store

    def db() -> Database:
        return store

    def sending(
        authorization: str = Header(default=""),
    ) -> Project:
        """The project a bearer token names. Ingestion only."""
        token = ""
        if authorization.lower().startswith("bearer "):
            token = authorization[7:].strip()
        project = store.authenticate(token)
        if project is None:
            raise HTTPException(
                status_code=401,
                detail={
                    "error": "unknown_token",
                    "detail": "the authorization header names no project",
                },
            )
        return project

    def reading(project: str | None = Query(default=None)) -> Project:
        """The project a read is about.

        Named by the caller, or the only one where there is one. A server
        watching a single deployment therefore needs no parameter anywhere.
        """
        projects = store.list_projects()
        if not projects:
            raise HTTPException(
                status_code=404,
                detail={
                    "error": "no_project",
                    "detail": "no project exists yet. Create one with"
                    " `blackboardxray project <slug>`",
                },
            )
        if project is None:
            first = projects[0]
            return Project(id=first["id"], slug=first["slug"], name=first["name"])
        for one in projects:
            if one["slug"] == project:
                return Project(id=one["id"], slug=one["slug"], name=one["name"])
        raise HTTPException(
            status_code=404,
            detail={"error": "unknown_project", "detail": f"no project {project!r}"},
        )

    @app.get("/api/v1/health")
    def health() -> dict[str, Any]:
        return {
            "status": "ok" if store.healthy() else "degraded",
            "schema_version": SCHEMA_VERSION,
            "kinds": list(EventKind.ALL),
        }

    @app.post("/api/v1/ingest", status_code=202)
    async def ingest(
        request: Request, project: Project = Depends(sending)
    ) -> dict[str, Any]:
        body = await request.json()
        if not isinstance(body, dict) or not isinstance(body.get("events"), list):
            raise HTTPException(
                status_code=400,
                detail={
                    "error": "unreadable_body",
                    "detail": "a batch is an object with an 'events' array",
                },
            )
        raw = body["events"]
        if len(raw) > MAX_BATCH:
            raise HTTPException(
                status_code=413,
                detail={
                    "error": "batch_too_large",
                    "detail": f"a batch carries at most {MAX_BATCH} events",
                },
            )
        events: list[Event] = []
        refused = 0
        for one in raw:
            try:
                events.append(Event.from_json(one))
            except EventError:
                # One unreadable event does not cost the batch it arrived in.
                refused += 1
        stored = store.ingest(project.id, events)
        return {
            "received": len(raw),
            "stored": stored,
            "repeated": len(events) - stored,
            "unreadable": refused,
        }

    @app.get("/api/v1/projects")
    def projects(store_: Database = Depends(db)) -> dict[str, Any]:
        return {"projects": store_.list_projects()}

    @app.get("/api/v1/overview")
    def overview(project: Project = Depends(reading)) -> dict[str, Any]:
        return {"project": project.slug, **store.overview(project.id)}

    @app.get("/api/v1/runs")
    def runs(
        project: Project = Depends(reading),
        limit: int = Query(default=DEFAULT_LIMIT, ge=1, le=MAX_LIMIT),
        offset: int = Query(default=0, ge=0),
        outcome: str | None = Query(default=None),
        agent: str | None = Query(default=None),
        search: str | None = Query(default=None),
    ) -> dict[str, Any]:
        found = store.list_runs(
            project.id,
            limit=limit,
            offset=offset,
            outcome=outcome,
            agent=agent,
            search=search,
        )
        return {
            "runs": found,
            "total": store.count_runs(
                project.id, outcome=outcome, agent=agent, search=search
            ),
            "limit": limit,
            "offset": offset,
        }

    @app.get("/api/v1/runs/{board_id:path}/events")
    def events(
        board_id: str,
        project: Project = Depends(reading),
        after: int = Query(default=0, ge=0),
        limit: int = Query(default=DEFAULT_EVENT_LIMIT, ge=1, le=MAX_EVENT_LIMIT),
        kind: list[str] | None = Query(default=None),
        agent: str | None = Query(default=None),
    ) -> dict[str, Any]:
        if store.get_run(project.id, board_id) is None:
            raise HTTPException(
                status_code=404,
                detail={"error": "unknown_run", "detail": f"no run on {board_id!r}"},
            )
        found = store.list_events(
            project.id, board_id, limit=limit, after=after, kinds=kind, agent=agent
        )
        return {
            "events": found,
            "has_more": len(found) == limit,
            "next_after": found[-1]["id"] if found else after,
        }

    @app.get("/api/v1/runs/{board_id:path}")
    def run(board_id: str, project: Project = Depends(reading)) -> dict[str, Any]:
        found = store.get_run(project.id, board_id)
        if found is None:
            raise HTTPException(
                status_code=404,
                detail={"error": "unknown_run", "detail": f"no run on {board_id!r}"},
            )
        return found

    @app.get("/api/v1/agents")
    def agents(
        project: Project = Depends(reading),
        limit: int = Query(default=100, ge=1, le=MAX_LIMIT),
    ) -> dict[str, Any]:
        return {"agents": store.list_agents(project.id, limit=limit)}

    @app.get("/api/v1/agents/{name}")
    def agent(name: str, project: Project = Depends(reading)) -> dict[str, Any]:
        found = store.get_agent(project.id, name)
        if found is None:
            raise HTTPException(
                status_code=404,
                detail={"error": "unknown_agent", "detail": f"no agent {name!r}"},
            )
        return found

    @app.exception_handler(HTTPException)
    async def readable(request: Request, raised: HTTPException) -> JSONResponse:
        """Every failure answers the same shape: a stable name and a detail.

        A client branches on `error` and a person reads `detail`, so a raise
        that carried only a string still answers something a client can read.
        """
        # FastAPI declares `detail` as a string, and every raise in this module
        # carries a dictionary. Widening it is what lets the check mean
        # something rather than being statically impossible.
        carried: object = raised.detail
        detail: dict[str, Any] = (
            {str(key): value for key, value in carried.items()}
            if isinstance(carried, dict)
            else {"error": "request_failed", "detail": str(carried)}
        )
        return JSONResponse(status_code=raised.status_code, content=detail)

    _serve_interface(app)
    return app


def _serve_interface(app: FastAPI) -> None:
    """Serves the built interface, where one was built.

    A route that is not the API and not a file falls through to the document,
    because the interface routes in the browser. A request under `/api` never
    reaches here, so a mistyped API path still answers 404 rather than HTML.
    """
    if not _WEB.is_dir():

        @app.get("/")
        def unbuilt() -> dict[str, str]:
            return {
                "status": "the interface is not built",
                "detail": "run `make ui` to build it, or use the API under /api/v1",
            }

        return

    app.mount("/assets", StaticFiles(directory=_WEB / "assets"), name="assets")

    @app.get("/{path:path}")
    def document(path: str) -> FileResponse:
        candidate = _WEB / path
        if path and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(_WEB / "index.html")


def application() -> FastAPI:
    """What `uvicorn blackboardxray.server.app:application --factory` builds."""
    return build(Settings.from_env())
