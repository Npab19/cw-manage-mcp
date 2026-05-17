ALTER TABLE mcp_audit_log ADD COLUMN IF NOT EXISTS cw_member_id BIGINT;
CREATE INDEX IF NOT EXISTS mcp_audit_log_cw_member_idx ON mcp_audit_log (cw_member_id);
