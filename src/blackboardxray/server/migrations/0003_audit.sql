-- Who changed what.
--
-- A role change nobody can attribute is a role change nobody can review. Every
-- administrative action is recorded with the person who did it and their
-- address as it stood at the time, because the account may be renamed or
-- removed afterwards and the record has to still say who it was.
--
-- Reads are not recorded. A row per page view would be most of this table and
-- would answer a question nobody is asking; what matters is what changed.

CREATE TABLE xray_audit (
    id          BIGSERIAL PRIMARY KEY,
    at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    org_id      BIGINT REFERENCES xray_organizations(id) ON DELETE CASCADE,
    project_id  BIGINT REFERENCES xray_projects(id) ON DELETE SET NULL,
    actor_id    BIGINT REFERENCES xray_users(id) ON DELETE SET NULL,
    -- Kept as text as well as a foreign key, so a deleted account still leaves
    -- a legible record rather than a null nobody can resolve.
    actor_email TEXT NOT NULL DEFAULT '',
    action      TEXT NOT NULL,
    target      TEXT NOT NULL DEFAULT '',
    detail      JSONB NOT NULL DEFAULT '{}'::jsonb,
    address     TEXT NOT NULL DEFAULT ''
);

CREATE INDEX xray_audit_org ON xray_audit (org_id, at DESC);
CREATE INDEX xray_audit_project ON xray_audit (project_id, at DESC);
