-- Track member type ('Regular', 'API', etc.) so the Users page can hide
-- API/integration accounts that can't OAuth-sign-in anyway. Backfill
-- existing rows from the raw JSON so the filter takes effect immediately,
-- before the next user import runs.
ALTER TABLE cw_members ADD COLUMN IF NOT EXISTS member_type TEXT;

UPDATE cw_members
   SET member_type = raw->'type'->>'name'
 WHERE member_type IS NULL
   AND raw ? 'type'
   AND raw->'type'->>'name' IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cw_members_member_type ON cw_members (member_type);
