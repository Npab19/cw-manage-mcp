-- DB-backed admin role assignments. Additive to the ADMIN_EMAILS env
-- allow-list, which remains the permanent break-glass path.
CREATE TABLE IF NOT EXISTS admin_role_assignments (
  email        TEXT PRIMARY KEY,
  granted_by   TEXT NOT NULL,
  granted_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at   TIMESTAMPTZ,
  revoked_by   TEXT
);
CREATE INDEX IF NOT EXISTS idx_admin_role_assignments_active
  ON admin_role_assignments (LOWER(email))
  WHERE revoked_at IS NULL;
