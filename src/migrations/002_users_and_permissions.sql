-- CW members imported from /system/members.
CREATE TABLE IF NOT EXISTS cw_members (
  id                  BIGINT PRIMARY KEY,
  identifier          TEXT NOT NULL,
  first_name          TEXT,
  last_name           TEXT,
  primary_email       TEXT,
  office_email        TEXT,
  security_role_id    BIGINT,
  security_role_name  TEXT,
  inactive_flag       BOOLEAN NOT NULL DEFAULT FALSE,
  raw                 JSONB NOT NULL,
  imported_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cw_members_primary_email ON cw_members (LOWER(primary_email));
CREATE INDEX IF NOT EXISTS idx_cw_members_security_role_id ON cw_members (security_role_id);

-- OAuth identities seen by the server. Touched on every /mcp request
-- via the identity-resolver middleware.
CREATE TABLE IF NOT EXISTS oauth_identities (
  sub          TEXT PRIMARY KEY,
  email        TEXT,
  first_seen   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_oauth_identities_email ON oauth_identities (LOWER(email));

-- Mapping: OAuth identity -> CW member. Many-to-one.
CREATE TABLE IF NOT EXISTS user_mappings (
  oauth_sub      TEXT PRIMARY KEY REFERENCES oauth_identities(sub) ON DELETE CASCADE,
  cw_member_id   BIGINT REFERENCES cw_members(id),
  source         TEXT NOT NULL CHECK (source IN ('auto-email', 'manual')),
  linked_by      TEXT,
  linked_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_user_mappings_cw_member ON user_mappings (cw_member_id);

-- Per-role MCP allow-list. Auto-seeded from CW security role; editable
-- by admins. auto_derived flips to false on first manual edit.
CREATE TABLE IF NOT EXISTS permission_policies (
  role_id            BIGINT PRIMARY KEY,
  role_name          TEXT NOT NULL,
  allowed_tools      TEXT[] NOT NULL DEFAULT '{}',
  field_projections  JSONB NOT NULL DEFAULT '{}'::jsonb,
  auto_derived       BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by         TEXT
);

-- User import job state.
CREATE TABLE IF NOT EXISTS user_import_runs (
  id                 BIGSERIAL PRIMARY KEY,
  started_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at       TIMESTAMPTZ,
  status             TEXT NOT NULL CHECK (status IN ('running', 'success', 'error')),
  rows_added         INTEGER NOT NULL DEFAULT 0,
  rows_updated       INTEGER NOT NULL DEFAULT 0,
  rows_deactivated   INTEGER NOT NULL DEFAULT 0,
  errors             JSONB NOT NULL DEFAULT '[]'::jsonb,
  triggered_by       TEXT
);
CREATE INDEX IF NOT EXISTS idx_user_import_runs_started ON user_import_runs (started_at DESC);
