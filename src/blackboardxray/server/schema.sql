-- The platform's own schema. Applied once when the server opens the database,
-- and safe to apply again.
--
-- Every table is scoped by project, because one server watches several
-- deployments and a key names which one is sending. Nothing here is scoped by
-- board alone, so a board identifier that two deployments happen to share stays
-- two runs rather than one.

CREATE TABLE IF NOT EXISTS xray_schema_stamp (
    id      INTEGER PRIMARY KEY CHECK (id = 1),
    version INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS xray_projects (
    id         BIGSERIAL PRIMARY KEY,
    slug       TEXT NOT NULL UNIQUE,
    name       TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A key is stored as a hash. The server can therefore check a token it is
-- shown and cannot show a token it was given, which is the only property that
-- makes a leaked database less bad than a leaked key.
CREATE TABLE IF NOT EXISTS xray_api_keys (
    id           BIGSERIAL PRIMARY KEY,
    project_id   BIGINT NOT NULL REFERENCES xray_projects(id) ON DELETE CASCADE,
    name         TEXT NOT NULL DEFAULT '',
    prefix       TEXT NOT NULL,
    token_hash   TEXT NOT NULL UNIQUE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_used_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS xray_api_keys_project
    ON xray_api_keys (project_id);

-- One row per run. The counters are denormalised and written in the same
-- transaction as the events that move them, so the runs list is one read and
-- never disagrees with the events behind it.
CREATE TABLE IF NOT EXISTS xray_runs (
    project_id     BIGINT NOT NULL REFERENCES xray_projects(id) ON DELETE CASCADE,
    board_id       TEXT NOT NULL,
    opened_at      TIMESTAMPTZ,
    closed_at      TIMESTAMPTZ,
    outcome        TEXT,
    reason         TEXT,
    unfinished     TEXT[] NOT NULL DEFAULT '{}',
    regions        JSONB NOT NULL DEFAULT '[]'::jsonb,
    limits         JSONB NOT NULL DEFAULT '{}'::jsonb,
    store          TEXT,
    first_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_event_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_sequence  BIGINT NOT NULL DEFAULT 0,
    n_events       BIGINT NOT NULL DEFAULT 0,
    n_writes       BIGINT NOT NULL DEFAULT 0,
    n_premise_sets BIGINT NOT NULL DEFAULT 0,
    n_refusals     BIGINT NOT NULL DEFAULT 0,
    n_conflicts    BIGINT NOT NULL DEFAULT 0,
    n_dispatched   BIGINT NOT NULL DEFAULT 0,
    n_acked        BIGINT NOT NULL DEFAULT 0,
    n_failed       BIGINT NOT NULL DEFAULT 0,
    agents         TEXT[] NOT NULL DEFAULT '{}',
    PRIMARY KEY (project_id, board_id)
);

-- The runs list is ordered by when the run was last active, so that is the
-- index it reads.
CREATE INDEX IF NOT EXISTS xray_runs_recent
    ON xray_runs (project_id, last_event_at DESC);

CREATE INDEX IF NOT EXISTS xray_runs_outcome
    ON xray_runs (project_id, outcome);

CREATE TABLE IF NOT EXISTS xray_events (
    id          BIGSERIAL PRIMARY KEY,
    project_id  BIGINT NOT NULL REFERENCES xray_projects(id) ON DELETE CASCADE,
    board_id    TEXT NOT NULL,
    event_id    TEXT NOT NULL,
    kind        TEXT NOT NULL,
    at          TIMESTAMPTZ NOT NULL,
    received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    sequence    BIGINT,
    agent       TEXT,
    region      TEXT,
    body        JSONB NOT NULL DEFAULT '{}'::jsonb,
    UNIQUE (project_id, event_id)
);

-- A run's timeline reads every event of one board in arrival order. The
-- primary key is the tiebreak, so two events that carry the same sequence
-- still have one order and it is the order they were received in.
CREATE INDEX IF NOT EXISTS xray_events_timeline
    ON xray_events (project_id, board_id, id);

CREATE INDEX IF NOT EXISTS xray_events_agent
    ON xray_events (project_id, agent, id)
    WHERE agent IS NOT NULL;

CREATE INDEX IF NOT EXISTS xray_events_kind
    ON xray_events (project_id, kind, id);
