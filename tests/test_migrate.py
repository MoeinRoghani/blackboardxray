"""The migration runner, against a real Postgres.

These run against a real server because every property being checked is a
property of Postgres: that a transaction rolls a failed migration back, that an
advisory lock serialises two starts, and that the record of what ran commits
with what ran.
"""

from __future__ import annotations

import shutil
import threading
from pathlib import Path
from typing import Any

import psycopg
import pytest
from psycopg.rows import dict_row

from blackboardxray.server.migrate import (
    _HERE,
    MigrationChangedError,
    MigrationError,
    SchemaAheadError,
    applied,
    known,
    migrate,
)


def wipe(dsn: str) -> None:
    with psycopg.connect(dsn) as connection:
        with connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(
                "SELECT tablename FROM pg_tables WHERE schemaname = current_schema()"
            )
            found = [row["tablename"] for row in cursor.fetchall()]
            if found:
                names = ", ".join(f'"{one}"' for one in found)
                cursor.execute(f"DROP TABLE {names} CASCADE")
        connection.commit()


@pytest.fixture
def blank(dsn: str):
    """A database with nothing in it at all.

    Every table goes, not only this platform's. These tests create their own
    fixture tables and one left behind by a previous test makes the next one
    fail on a `CREATE` that has nothing to do with what is being checked.
    """
    wipe(dsn)
    with psycopg.connect(dsn) as connection:
        yield connection
    # And again afterwards. These tests create fixture tables and record
    # migration numbers that mean nothing to the rest of the suite; leaving
    # either behind makes the next file fail on something it never touched.
    wipe(dsn)


def write(directory: Path, name: str, statements: str) -> None:
    (directory / name).write_text(statements)


def tables(connection: Any) -> set[str]:
    with connection.cursor(row_factory=dict_row) as cursor:
        cursor.execute(
            "SELECT tablename FROM pg_tables WHERE schemaname = current_schema()"
        )
        return {row["tablename"] for row in cursor.fetchall()}


class TestWhatShips:
    def test_the_shipped_migrations_are_numbered_without_a_gap_or_a_repeat(
        self,
    ) -> None:
        # A repeated number is two branches that each added a migration. The
        # runner refuses it rather than applying whichever sorted first.
        versions = [one.version for one in known()]
        assert versions == sorted(versions)
        assert versions == list(range(1, len(versions) + 1))

    def test_a_file_that_is_not_a_migration_is_refused(self, tmp_path: Path) -> None:
        write(tmp_path, "0001_initial.sql", "SELECT 1")
        write(tmp_path, "notes.sql", "SELECT 1")
        with pytest.raises(MigrationError, match="not a migration"):
            known(tmp_path)

    def test_two_migrations_with_the_same_number_are_refused(
        self, tmp_path: Path
    ) -> None:
        write(tmp_path, "0002_users.sql", "SELECT 1")
        write(tmp_path, "0002_orgs.sql", "SELECT 1")
        with pytest.raises(MigrationError, match="share the number"):
            known(tmp_path)


class TestApplying:
    def test_a_blank_database_gets_every_migration(self, blank) -> None:
        ran = migrate(blank)
        assert ran == [one.version for one in known()]
        assert {"xray_projects", "xray_runs", "xray_events"} <= tables(blank)

    def test_running_again_applies_nothing(self, blank) -> None:
        migrate(blank)
        assert migrate(blank) == []

    def test_only_what_is_missing_is_applied(self, blank, tmp_path: Path) -> None:
        write(tmp_path, "0001_one.sql", "CREATE TABLE probe_one (id INT)")
        assert migrate(blank, tmp_path) == [1]
        write(tmp_path, "0002_two.sql", "CREATE TABLE probe_two (id INT)")
        assert migrate(blank, tmp_path) == [2]
        assert {"probe_one", "probe_two"} <= tables(blank)

    def test_a_migration_that_fails_leaves_nothing_behind(
        self, blank, tmp_path: Path
    ) -> None:
        # The statements and the record of them commit together, so a migration
        # that raises half way through is not recorded and did not half apply.
        write(
            tmp_path,
            "0001_broken.sql",
            "CREATE TABLE probe_kept (id INT); SELECT nothing_of_the_sort();",
        )
        with pytest.raises(psycopg.Error):
            migrate(blank, tmp_path)
        blank.rollback()
        assert "probe_kept" not in tables(blank)
        assert applied(blank) == {}

    def test_the_record_names_what_ran(self, blank, tmp_path: Path) -> None:
        write(tmp_path, "0001_first_thing.sql", "CREATE TABLE probe_named (id INT)")
        migrate(blank, tmp_path)
        assert applied(blank)[1][0] == "first_thing"


class TestEditingWhatAlreadyRan:
    def test_a_migration_edited_after_it_ran_is_refused(
        self, blank, tmp_path: Path
    ) -> None:
        # The mistake every migration system invites. The author sees their
        # change; every database that ran the old text does not; nothing
        # reports the drift until something far away breaks.
        write(tmp_path, "0001_one.sql", "CREATE TABLE probe_edit (id INT)")
        migrate(blank, tmp_path)
        write(tmp_path, "0001_one.sql", "CREATE TABLE probe_edit (id INT, more INT)")
        with pytest.raises(MigrationChangedError, match="edited since"):
            migrate(blank, tmp_path)

    def test_a_row_recorded_before_checksums_existed_is_not_refused(
        self, blank, tmp_path: Path
    ) -> None:
        # An install that upgrades into this feature has rows with no checksum.
        # An empty checksum reads as "not known", never as "does not match".
        write(tmp_path, "0001_one.sql", "CREATE TABLE probe_legacy (id INT)")
        migrate(blank, tmp_path)
        with blank.cursor() as cursor:
            cursor.execute("UPDATE xray_migrations SET checksum = ''")
        blank.commit()
        assert migrate(blank, tmp_path) == []


class TestRefusals:
    def test_a_database_written_by_a_later_version_is_refused(
        self, blank, tmp_path: Path
    ) -> None:
        # Refused at the door rather than at whichever query first touches the
        # change, so an accidental downgrade cannot half read a newer record.
        write(tmp_path, "0001_one.sql", "CREATE TABLE probe_ahead (id INT)")
        write(tmp_path, "0002_two.sql", "SELECT 1")
        migrate(blank, tmp_path)
        (tmp_path / "0002_two.sql").unlink()
        with pytest.raises(SchemaAheadError, match="Upgrade blackboardxray"):
            migrate(blank, tmp_path)

    def test_the_lock_is_released_when_a_migration_fails(
        self, blank, dsn: str, tmp_path: Path
    ) -> None:
        # A failure that kept the lock would leave every other replica hanging
        # on start, which is a worse outcome than the failure.
        write(tmp_path, "0001_broken.sql", "SELECT nothing_of_the_sort();")
        with pytest.raises(psycopg.Error):
            migrate(blank, tmp_path)
        blank.rollback()
        with psycopg.connect(dsn) as other, other.cursor(row_factory=dict_row) as at:
            at.execute(
                "SELECT count(*)::int AS held FROM pg_locks WHERE locktype = 'advisory'"
            )
            row = at.fetchone()
            assert row is not None and row["held"] == 0


class TestSeveralReplicas:
    def test_two_starts_at_once_apply_each_migration_once(
        self, blank, dsn: str, tmp_path: Path
    ) -> None:
        # A deployment starts every replica together. Without the lock both
        # would run the same CREATE and one would fail on an object that
        # already exists, which is a crash loop on every upgrade.
        write(
            tmp_path,
            "0001_race.sql",
            "CREATE TABLE probe_race (id INT); INSERT INTO probe_race VALUES (1);",
        )
        results: list[Any] = []

        def start() -> None:
            try:
                with psycopg.connect(dsn) as connection:
                    results.append(migrate(connection, tmp_path))
            except Exception as raised:  # pragma: no cover - reported below
                results.append(raised)

        racers = [threading.Thread(target=start) for _ in range(4)]
        for one in racers:
            one.start()
        for one in racers:
            one.join(timeout=30)

        assert all(not isinstance(one, Exception) for one in results), results
        assert sorted(len(one) for one in results) == [0, 0, 0, 1]
        with blank.cursor(row_factory=dict_row) as cursor:
            cursor.execute("SELECT count(*)::int AS rows FROM probe_race")
            row = cursor.fetchone()
            assert row is not None and row["rows"] == 1


class TestUpgradingAnInstallThatExists:
    """The guarantee self hosting turns on: an upgrade keeps the record."""

    def test_a_database_at_the_first_migration_upgrades_with_its_data(
        self, blank, tmp_path: Path
    ) -> None:
        # Somebody is already running this. They pull a new image and restart.
        # Every run they had, and every key that was already sending, has to
        # still be there afterwards, and the projects that had no organization
        # have to have been given one.
        shutil.copy(_HERE / "0001_initial.sql", tmp_path / "0001_initial.sql")
        assert migrate(blank, tmp_path) == [1]

        with blank.cursor(row_factory=dict_row) as cursor:
            cursor.execute(
                "INSERT INTO xray_projects (slug, name)"
                " VALUES ('production', 'Production') RETURNING id"
            )
            row = cursor.fetchone()
            assert row is not None
            project = row["id"]
            cursor.execute(
                "INSERT INTO xray_api_keys (project_id, name, prefix, token_hash)"
                " VALUES (%s, 'ci', 'bxr_aaaa', 'a-hash')",
                (project,),
            )
            cursor.execute(
                "INSERT INTO xray_runs (project_id, board_id)"
                " VALUES (%s, 'incident-1')",
                (project,),
            )
        blank.commit()

        assert migrate(blank) == [one.version for one in known()][1:]

        with blank.cursor(row_factory=dict_row) as cursor:
            cursor.execute(
                "SELECT p.slug, p.public_id, o.slug AS org FROM xray_projects p"
                " JOIN xray_organizations o ON o.id = p.org_id"
            )
            found = cursor.fetchone()
            assert found is not None
            assert found["slug"] == "production"
            assert found["org"] == "default"
            assert found["public_id"].startswith("proj_")

            cursor.execute("SELECT count(*)::int AS n FROM xray_runs")
            runs = cursor.fetchone()
            assert runs is not None and runs["n"] == 1

            # The key that was already sending still is. An upgrade that
            # silently stopped ingestion would be found by whoever was relying
            # on the platform to tell them things had stopped.
            cursor.execute("SELECT token_hash, disabled_at FROM xray_api_keys")
            key = cursor.fetchone()
            assert key is not None
            assert key["token_hash"] == "a-hash"
            assert key["disabled_at"] is None

    def test_two_organizations_may_each_have_a_project_called_production(
        self, blank
    ) -> None:
        # The slug identifies a project inside its organization. Making it
        # unique across the install would mean one team's naming stopped
        # another team from using the obvious word.
        migrate(blank)
        with blank.cursor(row_factory=dict_row) as cursor:
            for slug in ("one", "two"):
                cursor.execute(
                    "INSERT INTO xray_organizations (public_id, slug, name)"
                    " VALUES (%s, %s, %s) RETURNING id",
                    (f"org_{slug}", slug, slug),
                )
                row = cursor.fetchone()
                assert row is not None
                cursor.execute(
                    "INSERT INTO xray_projects (public_id, org_id, slug, name)"
                    " VALUES (%s, %s, 'production', 'Production')",
                    (f"proj_{slug}", row["id"]),
                )
        blank.commit()
