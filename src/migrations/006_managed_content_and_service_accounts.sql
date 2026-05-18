-- pgcrypto for gen_random_uuid(). Postgres 16 ships it; CREATE EXTENSION
-- is a no-op when it's already enabled in the database.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Board aliases — admin-defined named shortcuts mapping a name to a
-- list of CW board IDs. Consumed by composite tools that take a
-- board_filter argument.
CREATE TABLE IF NOT EXISTS board_aliases (
  name             TEXT PRIMARY KEY,
  description      TEXT,
  board_ids        BIGINT[] NOT NULL,
  is_deprecated    BOOLEAN NOT NULL DEFAULT FALSE,
  created_by       TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Deprecated boards: individual board IDs flagged "DO NOT USE" with an
-- optional replacement suggestion. Surfaced as meta.warnings on tool
-- responses that touch those boards.
CREATE TABLE IF NOT EXISTS deprecated_boards (
  board_id                  BIGINT PRIMARY KEY,
  reason                    TEXT,
  suggested_replacement_id  BIGINT,
  created_by                TEXT,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Global company exclusions. Subtracted from list-tool responses unless
-- the caller passes include_excluded=true.
CREATE TABLE IF NOT EXISTS excluded_companies (
  cw_company_id            BIGINT PRIMARY KEY,
  cw_company_identifier    TEXT,
  cw_company_name          TEXT,
  reason                   TEXT NOT NULL,
  added_by                 TEXT NOT NULL,
  added_at                 TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Service accounts — long-lived API keys for CI/n8n/integrations that
-- bypass OAuth. Keys are sa_<8-char-prefix>_<32-char-secret>; only the
-- argon2id hash + prefix are stored.
CREATE TABLE IF NOT EXISTS service_accounts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL UNIQUE,
  description     TEXT,
  key_hash        TEXT NOT NULL,
  key_prefix      TEXT NOT NULL,
  allowed_tools   TEXT[] NOT NULL DEFAULT '{}',
  created_by      TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at    TIMESTAMPTZ,
  revoked_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_service_accounts_active
  ON service_accounts (revoked_at) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_service_accounts_key_prefix
  ON service_accounts (key_prefix);
