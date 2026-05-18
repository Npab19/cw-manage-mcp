import { getSql } from '../db.js';

/**
 * Returns true when the email is currently in admin_role_assignments
 * with a non-null revoked_at. Match is case-insensitive. ADMIN_EMAILS
 * env is checked separately by callers — that path is the permanent
 * break-glass.
 */
export async function isDbAdmin(email: string): Promise<boolean> {
  if (!process.env.DATABASE_URL) return false;
  try {
    const sql = getSql();
    const rows = await sql<{ email: string }[]>`
      SELECT email FROM admin_role_assignments
       WHERE LOWER(email) = ${email.toLowerCase()} AND revoked_at IS NULL
       LIMIT 1
    `;
    return rows.length > 0;
  } catch {
    return false;
  }
}

export interface AdminRoleAssignmentRow {
  email: string;
  granted_by: string;
  granted_at: Date;
  revoked_at: Date | null;
  revoked_by: string | null;
}

export async function listAdminRoleAssignments(): Promise<AdminRoleAssignmentRow[]> {
  const sql = getSql();
  return sql<AdminRoleAssignmentRow[]>`
    SELECT email, granted_by, granted_at, revoked_at, revoked_by
      FROM admin_role_assignments
     ORDER BY revoked_at NULLS FIRST, granted_at DESC
  `;
}

export async function grantAdminRole(email: string, grantedBy: string): Promise<void> {
  const sql = getSql();
  const lower = email.toLowerCase();
  await sql`
    INSERT INTO admin_role_assignments (email, granted_by, granted_at, revoked_at, revoked_by)
    VALUES (${lower}, ${grantedBy}, now(), NULL, NULL)
    ON CONFLICT (email) DO UPDATE SET
      granted_by = EXCLUDED.granted_by,
      granted_at = now(),
      revoked_at = NULL,
      revoked_by = NULL
  `;
}

export async function revokeAdminRole(email: string, revokedBy: string): Promise<void> {
  const sql = getSql();
  await sql`
    UPDATE admin_role_assignments
       SET revoked_at = now(), revoked_by = ${revokedBy}
     WHERE LOWER(email) = ${email.toLowerCase()} AND revoked_at IS NULL
  `;
}
