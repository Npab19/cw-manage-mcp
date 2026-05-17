-- Dashboard settings, keyed by namespace. Values are JSON-encoded to
-- keep this single table flexible across feature areas (OAuth config,
-- CW connection, extra admins, future flags).
CREATE TABLE IF NOT EXISTS dashboard_settings (
  key         TEXT PRIMARY KEY,
  value       JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  TEXT
);

-- Single-row table that records whether the one-time setup wizard
-- has completed. id is constrained so only one row can ever exist.
CREATE TABLE IF NOT EXISTS setup_state (
  id                   INTEGER PRIMARY KEY CHECK (id = 1),
  setup_completed_at   TIMESTAMPTZ,
  completed_by         TEXT
);

INSERT INTO setup_state (id, setup_completed_at, completed_by)
VALUES (1, NULL, NULL)
ON CONFLICT (id) DO NOTHING;

-- Per-/mcp-call audit log. One row per request. Best-effort write
-- (failures are logged but don't fail the underlying MCP response).
CREATE TABLE IF NOT EXISTS mcp_audit_log (
  id              BIGSERIAL PRIMARY KEY,
  ts              TIMESTAMPTZ NOT NULL DEFAULT now(),
  request_id      UUID,
  auth_sub        TEXT,
  auth_email      TEXT,
  tool            TEXT,
  args            JSONB,
  duration_ms     INTEGER,
  status          TEXT NOT NULL CHECK (status IN ('success', 'error')),
  error_message   TEXT
);

CREATE INDEX IF NOT EXISTS mcp_audit_log_ts_idx ON mcp_audit_log (ts DESC);
CREATE INDEX IF NOT EXISTS mcp_audit_log_email_idx ON mcp_audit_log (auth_email);
CREATE INDEX IF NOT EXISTS mcp_audit_log_tool_idx ON mcp_audit_log (tool);
