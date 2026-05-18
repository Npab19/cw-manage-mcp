-- Layered context documents (Phase 4).
--
-- Three scopes: 'global' (one row, scope_id NULL), 'role' (one row per
-- CW security role name), 'user' (one row per imported member email).
--
-- Each (scope_type, scope_id) has many versions; exactly one is_active
-- per pair, enforced via a partial unique index plus a trigger that
-- flips prior versions inactive on each insert.
--
-- Rollback is "insert a new version copying the historic markdown" —
-- the linear version history never gets mutated.

CREATE TABLE IF NOT EXISTS context_documents (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_type  TEXT NOT NULL CHECK (scope_type IN ('global', 'role', 'user')),
  scope_id    TEXT,                                        -- role name, lowercased email, NULL for global
  markdown    TEXT NOT NULL,
  version     INTEGER NOT NULL,
  updated_by  TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,

  -- Global rows have scope_id IS NULL — disambiguated separately below.
  UNIQUE (scope_type, scope_id, version)
);

-- Only one is_active row per (scope_type, scope_id). Two partial
-- unique indexes — one for rows with scope_id, one for rows where it
-- is NULL (PostgreSQL treats NULLs as distinct in regular unique
-- indexes, so the global layer needs its own constraint).
CREATE UNIQUE INDEX IF NOT EXISTS idx_context_documents_active_scoped
  ON context_documents (scope_type, scope_id)
  WHERE is_active AND scope_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_context_documents_active_global
  ON context_documents (scope_type)
  WHERE is_active AND scope_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_context_documents_versions
  ON context_documents (scope_type, scope_id, version DESC);

CREATE OR REPLACE FUNCTION deactivate_prior_context_versions() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.is_active THEN
    UPDATE context_documents
       SET is_active = FALSE
     WHERE scope_type = NEW.scope_type
       AND scope_id IS NOT DISTINCT FROM NEW.scope_id
       AND id <> NEW.id
       AND is_active;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_deactivate_prior_context_versions ON context_documents;
CREATE TRIGGER trg_deactivate_prior_context_versions
  AFTER INSERT ON context_documents
  FOR EACH ROW EXECUTE FUNCTION deactivate_prior_context_versions();
