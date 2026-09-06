-- People, the organizations they belong to, and the projects those own.
--
-- Until this migration the platform had no concept of a person: reading was
-- open to whoever could reach the port and a project was created by shelling
-- into the container. An organization owns projects, a person is a member of an
-- organization with a role, an application authenticates with a key belonging
-- to one project, and a reader authenticates as themselves.
--
-- Every object a URL or an API names carries a public identifier as well as its
-- primary key. A serial in a URL tells a stranger how many of a thing you have
-- and invites them to walk the range; a random identifier tells them nothing
-- and costs one column.

CREATE TABLE xray_users (
    id            BIGSERIAL PRIMARY KEY,
    public_id     TEXT NOT NULL UNIQUE,
    email         TEXT NOT NULL,
    -- Addresses are compared folded and displayed as they were typed. A
    -- generated column rather than the citext extension, because an extension
    -- is one more thing a self hosted install has to have been able to create.
    email_folded  TEXT GENERATED ALWAYS AS (lower(email)) STORED,
    name          TEXT NOT NULL DEFAULT '',
    -- Tagged with the algorithm and its cost, so the cost can be raised later
    -- and an old hash still verifies rather than locking its owner out.
    password_hash TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at  TIMESTAMPTZ,
    disabled_at   TIMESTAMPTZ,
    -- A lockout that survives a restart. Holding this in memory would mean an
    -- attacker's counter resets every time the process does.
    failed_logins INTEGER NOT NULL DEFAULT 0,
    locked_until  TIMESTAMPTZ
);

CREATE UNIQUE INDEX xray_users_email ON xray_users (email_folded);

-- A session is an opaque random token stored hashed, not a signed cookie. It
-- costs one read per request and buys revocation as a delete, a list of where
-- someone is signed in, and no secret for a deployment to generate or lose.
CREATE TABLE xray_sessions (
    id           BIGSERIAL PRIMARY KEY,
    token_hash   TEXT NOT NULL UNIQUE,
    user_id      BIGINT NOT NULL REFERENCES xray_users(id) ON DELETE CASCADE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at   TIMESTAMPTZ NOT NULL,
    user_agent   TEXT NOT NULL DEFAULT '',
    address      TEXT NOT NULL DEFAULT ''
);

CREATE INDEX xray_sessions_user ON xray_sessions (user_id, last_seen_at DESC);
CREATE INDEX xray_sessions_expiry ON xray_sessions (expires_at);

CREATE TABLE xray_organizations (
    id         BIGSERIAL PRIMARY KEY,
    public_id  TEXT NOT NULL UNIQUE,
    slug       TEXT NOT NULL UNIQUE,
    name       TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- owner, admin, member, viewer, none. `none` means no access by way of the
-- organization, and exists so somebody can be given one project and nothing
-- else without being removed from the organization entirely.
CREATE TABLE xray_memberships (
    org_id     BIGINT NOT NULL REFERENCES xray_organizations(id) ON DELETE CASCADE,
    user_id    BIGINT NOT NULL REFERENCES xray_users(id) ON DELETE CASCADE,
    role       TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (org_id, user_id)
);

CREATE INDEX xray_memberships_user ON xray_memberships (user_id);

-- Projects existed before organizations did, so they are given one rather than
-- being recreated. An install upgrading into this keeps every run it had and
-- every key that was already sending.
ALTER TABLE xray_projects
    ADD COLUMN public_id      TEXT,
    ADD COLUMN org_id         BIGINT REFERENCES xray_organizations(id) ON DELETE CASCADE,
    ADD COLUMN retention_days INTEGER,
    ADD COLUMN created_by     BIGINT REFERENCES xray_users(id) ON DELETE SET NULL;

INSERT INTO xray_organizations (public_id, slug, name)
SELECT 'org_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 20),
       'default',
       'Default'
WHERE EXISTS (SELECT 1 FROM xray_projects)
  AND NOT EXISTS (SELECT 1 FROM xray_organizations WHERE slug = 'default');

UPDATE xray_projects
   SET org_id = (SELECT id FROM xray_organizations WHERE slug = 'default')
 WHERE org_id IS NULL;

UPDATE xray_projects
   SET public_id = 'proj_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 20)
 WHERE public_id IS NULL;

ALTER TABLE xray_projects
    ALTER COLUMN public_id SET NOT NULL,
    ALTER COLUMN org_id SET NOT NULL,
    ADD CONSTRAINT xray_projects_public_id UNIQUE (public_id);

-- A slug identifies a project inside its organization, not across the install.
-- Two teams may both have a project called production and neither has to know
-- the other exists.
ALTER TABLE xray_projects DROP CONSTRAINT IF EXISTS xray_projects_slug_key;
ALTER TABLE xray_projects ADD CONSTRAINT xray_projects_slug UNIQUE (org_id, slug);

-- A role on one project overrides the organization role, in either direction:
-- it raises a member to admin on the project they run, and it is how somebody
-- whose organization role is `none` gets access to exactly one thing.
CREATE TABLE xray_project_roles (
    project_id BIGINT NOT NULL REFERENCES xray_projects(id) ON DELETE CASCADE,
    user_id    BIGINT NOT NULL REFERENCES xray_users(id) ON DELETE CASCADE,
    role       TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (project_id, user_id)
);

CREATE INDEX xray_project_roles_user ON xray_project_roles (user_id);

-- An invite is a one time link an admin copies and sends however they already
-- talk to their colleagues. The token is stored hashed like every other
-- credential here, so a leaked database yields no usable invite.
CREATE TABLE xray_invites (
    id          BIGSERIAL PRIMARY KEY,
    public_id   TEXT NOT NULL UNIQUE,
    org_id      BIGINT NOT NULL REFERENCES xray_organizations(id) ON DELETE CASCADE,
    email       TEXT NOT NULL,
    role        TEXT NOT NULL,
    token_hash  TEXT NOT NULL UNIQUE,
    created_by  BIGINT REFERENCES xray_users(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at  TIMESTAMPTZ NOT NULL,
    accepted_at TIMESTAMPTZ,
    accepted_by BIGINT REFERENCES xray_users(id) ON DELETE SET NULL
);

CREATE INDEX xray_invites_org ON xray_invites (org_id, created_at DESC);

-- A key gains an identity of its own, so it can be listed, named and revoked
-- from the interface rather than only issued from a shell.
ALTER TABLE xray_api_keys
    ADD COLUMN public_id   TEXT,
    ADD COLUMN disabled_at TIMESTAMPTZ,
    ADD COLUMN created_by  BIGINT REFERENCES xray_users(id) ON DELETE SET NULL;

UPDATE xray_api_keys
   SET public_id = 'key_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 20)
 WHERE public_id IS NULL;

ALTER TABLE xray_api_keys
    ALTER COLUMN public_id SET NOT NULL,
    ADD CONSTRAINT xray_api_keys_public_id UNIQUE (public_id);
