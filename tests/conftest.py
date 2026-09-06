"""Fixtures shared by the suite.

The database tests run against a real Postgres, because the platform's
correctness lives in statements this project writes rather than in an
abstraction over them. They skip where no server is named, and CI names one.
"""

from __future__ import annotations

import os
from collections.abc import Iterator
from uuid import uuid4

import pytest

DSN_VARIABLE = "BLACKBOARDXRAY_TEST_DSN"


@pytest.fixture(scope="session")
def dsn() -> str:
    named = os.environ.get(DSN_VARIABLE)
    if not named:
        pytest.skip(f"{DSN_VARIABLE} names no server")
    return named


@pytest.fixture
def database(dsn: str) -> Iterator[object]:
    """A database with the schema applied, cleaned between tests."""
    from blackboardxray.server.db import Database

    store = Database(dsn)
    with store.connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                "TRUNCATE xray_audit, xray_events, xray_runs, xray_api_keys,"
                " xray_projects, xray_project_roles, xray_invites, xray_memberships,"
                " xray_organizations, xray_sessions, xray_users"
                " RESTART IDENTITY CASCADE"
            )
        connection.commit()
    yield store
    store.close()


@pytest.fixture
def board_id() -> str:
    return f"board-{uuid4().hex[:12]}"
