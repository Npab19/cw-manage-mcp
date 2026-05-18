import { getSql } from '../db.js';
import { cwFetch } from '../client.js';
import { getCwConnection } from '../config.js';
import type { CwRequestContext } from '../types.js';
import { deriveAllowedTools, defaultSeedAllowedTools } from './permission-derivation.js';

interface CwMemberRaw {
  id: number;
  identifier: string;
  firstName?: string;
  lastName?: string;
  primaryEmail?: string;
  officeEmail?: string;
  securityRole?: { id?: number; name?: string };
  type?: { id?: number; name?: string };
  inactiveFlag?: boolean;
}

interface CwSecurityRoleRaw {
  id: number;
  name: string;
}

export interface UserImportResult {
  runId: string;
  status: 'success' | 'error';
  rowsAdded: number;
  rowsUpdated: number;
  rowsDeactivated: number;
  errors: { phase: string; message: string }[];
}

const PAGE_SIZE = 1000;

async function fetchAllMembers(ctx: CwRequestContext): Promise<CwMemberRaw[]> {
  const out: CwMemberRaw[] = [];
  let page = 1;
  while (true) {
    const result = await cwFetch<CwMemberRaw[]>(ctx, '/system/members', {
      pageSize: PAGE_SIZE,
      page,
    });
    const batch = Array.isArray(result.data) ? result.data : [];
    out.push(...batch);
    if (batch.length < PAGE_SIZE) break;
    page++;
    if (page > 50) break; // safety: 50k members ceiling
  }
  return out;
}

async function fetchSecurityRoles(
  ctx: CwRequestContext,
  errors: UserImportResult['errors'],
): Promise<CwSecurityRoleRaw[]> {
  try {
    const result = await cwFetch<CwSecurityRoleRaw[]>(ctx, '/system/securityRoles', {
      pageSize: 200,
    });
    return Array.isArray(result.data) ? result.data : [];
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[import] /system/securityRoles failed: ${message}`);
    errors.push({ phase: 'fetch:securityRoles', message });
    return [];
  }
}

/**
 * Fetches a CW security role's per-module settings via
 * /system/securityRoles/{id}/settings and returns the distinct list of
 * CW module names where the role has *any* read access (inquireLevel
 * other than 'None' on at least one function).
 *
 * Returned strings are raw CW module names — "Companies", "Service Desk",
 * "Time & Expense", etc. The derivation layer maps them to our internal
 * MODULE_TOOLS buckets.
 */
export async function fetchRolePermissions(
  ctx: CwRequestContext,
  roleId: number,
  errors: UserImportResult['errors'],
): Promise<string[]> {
  try {
    const result = await cwFetch<unknown>(
      ctx,
      `/system/securityRoles/${roleId}/settings`,
      { pageSize: 1000 },
    );
    if (!Array.isArray(result.data)) return [];
    const readable = new Set<string>();
    for (const row of result.data as Array<Record<string, unknown>>) {
      const moduleName = typeof row.moduleName === 'string' ? row.moduleName : null;
      const inquireLevel = typeof row.inquireLevel === 'string' ? row.inquireLevel : null;
      if (!moduleName) continue;
      if (!inquireLevel || inquireLevel === 'None') continue;
      readable.add(moduleName);
    }
    return [...readable];
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    errors.push({ phase: `permissions:role:${roleId}`, message });
    return [];
  }
}

export async function runUserImport(triggeredBy: string): Promise<UserImportResult> {
  const sql = getSql();
  const conn = await getCwConnection();
  if (!conn || !conn.companyId || !conn.publicKey || !conn.privateKey) {
    throw new Error('CW connection is not configured — cannot run user import');
  }
  const ctx: CwRequestContext = conn;

  const insertRunResult = await sql<{ id: string }[]>`
    INSERT INTO user_import_runs (status, triggered_by) VALUES ('running', ${triggeredBy})
    RETURNING id::text AS id
  `;
  const runId = insertRunResult[0]?.id;
  if (!runId) throw new Error('Failed to create user_import_runs row');
  const errors: UserImportResult['errors'] = [];

  let members: CwMemberRaw[] = [];
  let roles: CwSecurityRoleRaw[] = [];

  try {
    members = await fetchAllMembers(ctx);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    errors.push({ phase: 'fetch:members', message });
    await sql`
      UPDATE user_import_runs
        SET status = 'error', completed_at = now(), errors = ${sql.json(errors as never)}
        WHERE id = ${runId}::bigint
    `;
    return { runId, status: 'error', rowsAdded: 0, rowsUpdated: 0, rowsDeactivated: 0, errors };
  }

  // /system/securityRoles isn't fatal — if it fails, fall back to seeding
  // roles from the security_role_id values we actually saw on members.
  roles = await fetchSecurityRoles(ctx, errors);

  // Upsert members. Track which IDs we saw so we can deactivate the rest.
  const seenIds = new Set<number>();
  let rowsAdded = 0;
  let rowsUpdated = 0;

  for (const m of members) {
    if (!m?.id) continue;
    seenIds.add(m.id);
    const memberType = typeof m.type?.name === 'string' ? m.type.name : null;
    const result = await sql<{ inserted: boolean }[]>`
      INSERT INTO cw_members (
        id, identifier, first_name, last_name, primary_email, office_email,
        security_role_id, security_role_name, member_type, inactive_flag, raw, updated_at
      ) VALUES (
        ${m.id},
        ${m.identifier ?? ''},
        ${m.firstName ?? null},
        ${m.lastName ?? null},
        ${m.primaryEmail ?? null},
        ${m.officeEmail ?? null},
        ${m.securityRole?.id ?? null},
        ${m.securityRole?.name ?? null},
        ${memberType},
        ${m.inactiveFlag ?? false},
        ${sql.json(m as never)},
        now()
      )
      ON CONFLICT (id) DO UPDATE SET
        identifier = EXCLUDED.identifier,
        first_name = EXCLUDED.first_name,
        last_name = EXCLUDED.last_name,
        primary_email = EXCLUDED.primary_email,
        office_email = EXCLUDED.office_email,
        security_role_id = EXCLUDED.security_role_id,
        security_role_name = EXCLUDED.security_role_name,
        member_type = EXCLUDED.member_type,
        inactive_flag = EXCLUDED.inactive_flag,
        raw = EXCLUDED.raw,
        updated_at = now()
      RETURNING (xmax = 0) AS inserted
    `;
    if (result[0]?.inserted) rowsAdded++;
    else rowsUpdated++;
  }

  // Deactivate members we didn't see this run (they were removed in CW).
  let rowsDeactivated = 0;
  if (seenIds.size > 0) {
    const idList = [...seenIds];
    const deactivated = await sql<{ id: string }[]>`
      UPDATE cw_members
        SET inactive_flag = TRUE, updated_at = now()
        WHERE id NOT IN ${sql(idList)} AND inactive_flag = FALSE
        RETURNING id::text AS id
    `;
    rowsDeactivated = deactivated.length;
  }

  // Build the role set we want to seed. Prefer the /securityRoles
  // response (gives us names), but fall back to whatever role IDs we
  // saw on members (with the name we captured on the member row) so a
  // failed /securityRoles fetch doesn't block policy seeding.
  const roleMap = new Map<number, string>();
  for (const r of roles) {
    if (r?.id != null) roleMap.set(r.id, r.name ?? `Role ${r.id}`);
  }
  for (const m of members) {
    const id = m?.securityRole?.id;
    if (id != null && !roleMap.has(id)) {
      roleMap.set(id, m.securityRole?.name ?? `Role ${id}`);
    }
  }

  // Seed permission_policies. auto_derived=false rows are admin-curated
  // and left alone.
  const existing = await sql<{ role_id: string; auto_derived: boolean }[]>`
    SELECT role_id::text AS role_id, auto_derived FROM permission_policies
  `;
  const autoDerivedByRoleId = new Map(existing.map((r) => [r.role_id, r.auto_derived]));

  for (const [roleId, roleName] of roleMap) {
    const existingAuto = autoDerivedByRoleId.get(String(roleId));
    if (existingAuto === false) continue;
    const modules = await fetchRolePermissions(ctx, roleId, errors);
    const allowed = modules.length > 0 ? deriveAllowedTools(modules) : defaultSeedAllowedTools();
    try {
      await sql`
        INSERT INTO permission_policies (role_id, role_name, allowed_tools, auto_derived, updated_at)
        VALUES (${roleId}, ${roleName}, ${allowed}, TRUE, now())
        ON CONFLICT (role_id) DO UPDATE SET
          role_name = EXCLUDED.role_name,
          allowed_tools = EXCLUDED.allowed_tools,
          updated_at = now()
        WHERE permission_policies.auto_derived = TRUE
      `;
    } catch (err) {
      errors.push({
        phase: `policy:upsert:${roleId}`,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  await sql`
    UPDATE user_import_runs
      SET status = 'success',
          completed_at = now(),
          rows_added = ${rowsAdded},
          rows_updated = ${rowsUpdated},
          rows_deactivated = ${rowsDeactivated},
          errors = ${sql.json(errors as never)}
      WHERE id = ${runId}::bigint
  `;

  return {
    runId,
    status: 'success',
    rowsAdded,
    rowsUpdated,
    rowsDeactivated,
    errors,
  };
}

export interface ResyncRolePolicyResult {
  roleId: number;
  allowed: string[];
  sourcedFromCw: boolean;
  errors: UserImportResult['errors'];
}

/**
 * Re-derives a single role's allow-list from its current CW permissions
 * and overwrites the row in permission_policies, flipping auto_derived
 * back to TRUE. Use this when an admin wants to discard manual edits
 * and start from the CW-derived baseline again, or to pick up CW-side
 * role permission changes between scheduled imports.
 *
 * Does NOT touch cw_members or user_import_runs — this is a targeted
 * policy refresh, not a full re-import.
 */
export async function resyncRolePolicy(
  roleId: number,
  triggeredBy: string,
): Promise<ResyncRolePolicyResult> {
  const sql = getSql();
  const conn = await getCwConnection();
  if (!conn || !conn.companyId || !conn.publicKey || !conn.privateKey) {
    throw new Error('CW connection is not configured — cannot resync role policy');
  }
  const errors: UserImportResult['errors'] = [];
  const modules = await fetchRolePermissions(conn, roleId, errors);
  const sourcedFromCw = modules.length > 0;
  const allowed = sourcedFromCw ? deriveAllowedTools(modules) : defaultSeedAllowedTools();
  const updated = await sql<{ role_id: string }[]>`
    UPDATE permission_policies
      SET allowed_tools = ${allowed},
          auto_derived = TRUE,
          updated_at = now(),
          updated_by = ${triggeredBy}
      WHERE role_id = ${roleId}
      RETURNING role_id::text AS role_id
  `;
  if (updated.length === 0) {
    throw new Error(`Role ${roleId} not found in permission_policies`);
  }
  return { roleId, allowed, sourcedFromCw, errors };
}

export async function lastUserImportRun(): Promise<{
  id: string;
  startedAt: Date;
  completedAt: Date | null;
  status: string;
  rowsAdded: number;
  rowsUpdated: number;
  rowsDeactivated: number;
  triggeredBy: string | null;
} | null> {
  const sql = getSql();
  const rows = await sql<
    {
      id: string;
      started_at: Date;
      completed_at: Date | null;
      status: string;
      rows_added: number;
      rows_updated: number;
      rows_deactivated: number;
      triggered_by: string | null;
    }[]
  >`
    SELECT id::text AS id, started_at, completed_at, status,
           rows_added, rows_updated, rows_deactivated, triggered_by
    FROM user_import_runs ORDER BY started_at DESC LIMIT 1
  `;
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id,
    startedAt: r.started_at,
    completedAt: r.completed_at,
    status: r.status,
    rowsAdded: r.rows_added,
    rowsUpdated: r.rows_updated,
    rowsDeactivated: r.rows_deactivated,
    triggeredBy: r.triggered_by,
  };
}
