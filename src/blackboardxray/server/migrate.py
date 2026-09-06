"""Bringing a database up to the schema this build reads.

A migration is a numbered file applied exactly once and recorded. That is the
whole mechanism, and it exists because the alternative this replaced could not
add a column: a schema built entirely from `CREATE TABLE IF NOT EXISTS` is
idempotent only for as long as nothing ever changes shape.

Three properties matter and each costs one line.

**Applied once.** A file that ran is recorded in the same transaction that ran
it, so a crash between the two is impossible and a half applied migration
cannot be recorded as done.

**Applied by one process.** A deployment starts several replicas at once and
all of them open the database. They take an advisory lock first, so the second
waits and then finds nothing to do rather than racing the first through the
same `ALTER`.

**Refused when the database is ahead.** A record written by a version this one
cannot read is refused at the door rather than at whichever query first touches
the change, which is the same reason the library stamps its own store.

**Refused when a migration changed after it ran.** Each file's checksum is
recorded with it. Editing a migration that has already been applied is the
mistake every migration system invites: the author sees their change and every
database that already ran the old text does not, and the two drift with nothing
reporting it. Correcting an applied migration is a new migration.
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from psycopg import Connection
from psycopg.rows import dict_row

#: The lock every replica takes before it looks at the schema. An arbitrary
#: constant, chosen once; what matters is only that this project always uses
#: the same one and that it is unlikely to collide with an application sharing
#: the database.
LOCK = 0x62787261_6D696772 - (1 << 63)

_HERE = Path(__file__).with_name("migrations")
_NAMED = re.compile(r"^(\d{4})_([a-z0-9_]+)\.sql$")


class MigrationError(Exception):
    """The database could not be brought to the schema this build reads."""


class SchemaAheadError(MigrationError):
    """The database holds a schema written by a later version of the platform."""


class MigrationChangedError(MigrationError):
    """A migration was edited after a database had already applied it."""


@dataclass(frozen=True)
class Migration:
    version: int
    name: str
    path: Path

    def read(self) -> str:
        return self.path.read_text()

    def checksum(self) -> str:
        """What this file said. Compared against what the database ran."""
        return hashlib.sha256(self.read().encode("utf-8")).hexdigest()


def known(directory: Path | None = None) -> list[Migration]:
    """Every migration this build ships, in the order they must be applied."""
    found: list[Migration] = []
    for path in sorted((directory or _HERE).glob("*.sql")):
        matched = _NAMED.match(path.name)
        if matched is None:
            raise MigrationError(
                f"{path.name} is not a migration. A migration is named"
                " NNNN_lower_case_words.sql, for example 0002_users.sql"
            )
        found.append(
            Migration(version=int(matched.group(1)), name=matched.group(2), path=path)
        )
    versions = [one.version for one in found]
    duplicated = {v for v in versions if versions.count(v) > 1}
    if duplicated:
        raise MigrationError(
            f"two migrations share the number {sorted(duplicated)}."
            " Two branches numbered a migration the same; renumber one."
        )
    return found


def applied(connection: Connection[Any]) -> dict[int, tuple[str, str]]:
    """What the database says it has already run, and what it ran."""
    with connection.cursor(row_factory=dict_row) as cursor:
        cursor.execute(
            "CREATE TABLE IF NOT EXISTS xray_migrations ("
            " version    INTEGER PRIMARY KEY,"
            " name       TEXT NOT NULL,"
            " checksum   TEXT NOT NULL DEFAULT '',"
            " applied_at TIMESTAMPTZ NOT NULL DEFAULT now())"
        )
        # A database written before checksums were recorded has the column
        # added rather than being refused. Its existing rows carry an empty
        # checksum, which is read as "not known" and never as "does not match".
        cursor.execute(
            "ALTER TABLE xray_migrations"
            " ADD COLUMN IF NOT EXISTS checksum TEXT NOT NULL DEFAULT ''"
        )
        connection.commit()
        cursor.execute(
            "SELECT version, name, checksum FROM xray_migrations ORDER BY version"
        )
        return {
            int(row["version"]): (str(row["name"]), str(row["checksum"]))
            for row in cursor.fetchall()
        }


def migrate(connection: Connection[Any], directory: Path | None = None) -> list[int]:
    """Applies what the database has not seen, and answers what it applied.

    The connection is held for the whole run and the lock with it, so a second
    replica blocks here rather than in the middle of an `ALTER TABLE`.
    """
    migrations = known(directory)
    with connection.cursor() as cursor:
        cursor.execute("SELECT pg_advisory_lock(%s)", (LOCK,))
        connection.commit()
    try:
        done = applied(connection)
        ceiling = max((one.version for one in migrations), default=0)
        ahead = [version for version in done if version > ceiling]
        if ahead:
            raise SchemaAheadError(
                f"the database has migration {max(ahead)} applied and this"
                f" build ships up to {ceiling}. Upgrade blackboardxray to a"
                " version that reads it, or restore a backup taken before the"
                " upgrade."
            )
        ran: list[int] = []
        for one in migrations:
            was = done.get(one.version)
            if was is not None:
                name, checksum = was
                if checksum and checksum != one.checksum():
                    raise MigrationChangedError(
                        f"migration {one.version:04d} ran here as {name!r} and"
                        f" has been edited since. This database ran the old"
                        " text and will not run the new. Revert the file and"
                        " correct it in a new migration instead."
                    )
                continue
            with connection.cursor() as cursor:
                # The statements and the record of them commit together. A
                # crash between the two would otherwise leave a migration that
                # ran and is not recorded, which the next start would run again.
                cursor.execute(one.read())
                cursor.execute(
                    "INSERT INTO xray_migrations (version, name, checksum)"
                    " VALUES (%s, %s, %s)",
                    (one.version, one.name, one.checksum()),
                )
            connection.commit()
            ran.append(one.version)
        return ran
    finally:
        # A migration that raised left the transaction aborted, and Postgres
        # refuses every statement on an aborted transaction including the
        # unlock. Rolling back first is what makes the release actually happen:
        # without it a failed upgrade holds the lock until the connection dies
        # and every other replica blocks on start, which is worse than the
        # failure that caused it.
        connection.rollback()
        with connection.cursor() as cursor:
            cursor.execute("SELECT pg_advisory_unlock(%s)", (LOCK,))
        connection.commit()
