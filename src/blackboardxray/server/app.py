"""The platform's HTTP surface: three route tables, and the interface behind it.

Two doors, and they are not the same.

**An application sends** with a key belonging to one project. It is a machine
holding a bearer token, and it may only write.

**A person reads** with a session cookie, and every read goes through a
membership and a role first. Reading was open to whoever could reach the port
until this platform grew people, which is fine for a laptop and is not a thing
to publish.

The routes are split by what they answer. `routes/auth.py` is getting in,
`routes/admin.py` is running the place, `routes/data.py` is what a run did.
Ingestion, health and the built interface stay here, because they are the three
things that are not about a person at all.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from blackboardxray.events import SCHEMA_VERSION, Event, EventError, EventKind
from blackboardxray.server.db import Database, Project
from blackboardxray.server.provision import provision
from blackboardxray.server.routes import admin, auth, data
from blackboardxray.server.security import Guard
from blackboardxray.server.settings import Settings

logger = logging.getLogger("blackboardxray.server")

#: The most events one ingestion request carries.
MAX_BATCH = 1000

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
    app.state.settings = settings

    # What a compose file or a chart asked to exist, before anybody arrives.
    for line in provision(store, settings.provision):
        logger.info("blackboardxray provisioned %s", line)

    guard = Guard(store, settings.allowed_origins)

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

    @app.get("/api/v1/health")
    def health() -> dict[str, Any]:
        return {
            "status": "ok" if store.healthy() else "degraded",
            "schema_version": SCHEMA_VERSION,
            "kinds": list(EventKind.ALL),
        }

    @app.get("/api/v1/ready")
    def ready() -> JSONResponse:
        """Readiness. Answers whether this process can serve a request.

        Separate from liveness because an orchestrator does different things
        with the two answers: a process that is alive and not ready should stop
        receiving traffic, and one that is not alive should be restarted.
        Answering the same to both turns a database outage into a restart loop.
        """
        if store.healthy():
            return JSONResponse({"status": "ready"})
        return JSONResponse(
            {"error": "database_unreachable", "detail": "the database did not answer"},
            status_code=503,
        )

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

    app.include_router(auth.router(store, guard, settings))
    app.include_router(admin.router(store, guard))
    app.include_router(data.router(store, guard))

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
        return JSONResponse(
            status_code=raised.status_code, content=detail, headers=raised.headers
        )

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
