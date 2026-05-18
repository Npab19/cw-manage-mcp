import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getSql } from '../db.js';
import type { ResolvedIdentity } from '../middleware/identity-resolver.js';

const MIME = 'text/markdown';

export type ScopeType = 'global' | 'role' | 'user';

export interface ActiveContextDoc {
  id: string;
  scopeType: ScopeType;
  scopeId: string | null;
  markdown: string;
  version: number;
  updatedBy: string | null;
  updatedAt: Date;
}

export interface ContextVersion {
  id: string;
  version: number;
  isActive: boolean;
  updatedBy: string | null;
  updatedAt: Date;
}

interface ActiveRow {
  id: string;
  scope_type: ScopeType;
  scope_id: string | null;
  markdown: string;
  version: number;
  updated_by: string | null;
  updated_at: Date;
}

function rowToDoc(r: ActiveRow): ActiveContextDoc {
  return {
    id: r.id,
    scopeType: r.scope_type,
    scopeId: r.scope_id,
    markdown: r.markdown,
    version: r.version,
    updatedBy: r.updated_by,
    updatedAt: r.updated_at,
  };
}

function normalizeScopeId(scopeType: ScopeType, scopeId: string | null): string | null {
  if (scopeType === 'global') return null;
  if (scopeType === 'user') return scopeId?.toLowerCase() ?? null;
  return scopeId;
}

export async function getActiveContext(
  scopeType: ScopeType,
  scopeId: string | null,
): Promise<ActiveContextDoc | null> {
  const sql = getSql();
  const normalized = normalizeScopeId(scopeType, scopeId);
  const rows = await sql<ActiveRow[]>`
    SELECT id::text AS id, scope_type, scope_id, markdown, version, updated_by, updated_at
      FROM context_documents
     WHERE scope_type = ${scopeType}
       AND scope_id IS NOT DISTINCT FROM ${normalized}
       AND is_active = TRUE
     LIMIT 1
  `;
  return rows[0] ? rowToDoc(rows[0]) : null;
}

export async function listVersions(
  scopeType: ScopeType,
  scopeId: string | null,
): Promise<ContextVersion[]> {
  const sql = getSql();
  const normalized = normalizeScopeId(scopeType, scopeId);
  const rows = await sql<
    { id: string; version: number; is_active: boolean; updated_by: string | null; updated_at: Date }[]
  >`
    SELECT id::text AS id, version, is_active, updated_by, updated_at
      FROM context_documents
     WHERE scope_type = ${scopeType}
       AND scope_id IS NOT DISTINCT FROM ${normalized}
     ORDER BY version DESC
  `;
  return rows.map((r) => ({
    id: r.id,
    version: r.version,
    isActive: r.is_active,
    updatedBy: r.updated_by,
    updatedAt: r.updated_at,
  }));
}

export async function getVersionById(versionId: string): Promise<ActiveContextDoc | null> {
  const sql = getSql();
  const rows = await sql<ActiveRow[]>`
    SELECT id::text AS id, scope_type, scope_id, markdown, version, updated_by, updated_at
      FROM context_documents
     WHERE id = ${versionId}::uuid
     LIMIT 1
  `;
  return rows[0] ? rowToDoc(rows[0]) : null;
}

/**
 * Inserts a new active version of a context document. The DB trigger
 * (deactivate_prior_context_versions) flips the prior version's
 * is_active to FALSE. Returns the new doc.
 *
 * `version` is computed as max(existing) + 1, or 1 if none exist.
 * Concurrent saves race on version assignment; the unique constraint
 * (scope_type, scope_id, version) will reject duplicates so callers
 * may retry once.
 */
export async function saveContext(
  scopeType: ScopeType,
  scopeId: string | null,
  markdown: string,
  updatedBy: string | null,
): Promise<ActiveContextDoc> {
  const sql = getSql();
  const normalized = normalizeScopeId(scopeType, scopeId);
  // Run deactivate + insert in one transaction. The migration trigger
  // (AFTER INSERT) can't help us here — PostgreSQL checks the partial
  // unique index `idx_context_documents_active_scoped` BEFORE the
  // trigger fires, so the trigger never gets a chance to clear the
  // prior active row. Doing the UPDATE first inside a transaction
  // makes the trigger a harmless no-op and avoids the unique
  // violation entirely.
  const row = await sql.begin(async (tx) => {
    await tx`
      UPDATE context_documents
         SET is_active = FALSE
       WHERE scope_type = ${scopeType}
         AND scope_id IS NOT DISTINCT FROM ${normalized}
         AND is_active = TRUE
    `;
    const maxRows = await tx<{ next_version: number }[]>`
      SELECT COALESCE(MAX(version), 0) + 1 AS next_version
        FROM context_documents
       WHERE scope_type = ${scopeType}
         AND scope_id IS NOT DISTINCT FROM ${normalized}
    `;
    const nextVersion = maxRows[0]?.next_version ?? 1;
    const inserted = await tx<ActiveRow[]>`
      INSERT INTO context_documents (scope_type, scope_id, markdown, version, updated_by, is_active)
      VALUES (${scopeType}, ${normalized}, ${markdown}, ${nextVersion}, ${updatedBy}, TRUE)
      RETURNING id::text AS id, scope_type, scope_id, markdown, version, updated_by, updated_at
    `;
    return inserted[0];
  });
  if (!row) throw new Error('context_documents insert returned no row');
  return rowToDoc(row);
}

export async function rollbackToVersion(
  versionId: string,
  updatedBy: string | null,
): Promise<ActiveContextDoc> {
  const target = await getVersionById(versionId);
  if (!target) throw new Error(`Version ${versionId} not found`);
  return saveContext(target.scopeType, target.scopeId, target.markdown, updatedBy);
}

/**
 * Picks the canonical "user identity" string used to key per-user
 * context. Prefers the resolved CW member's primary email — that's
 * what the dashboard editor uses as the scope_id, since admins pick
 * a user by their CW record, not by their OAuth claim. Falls back to
 * the OAuth email when there's no mapped CW member (rare; usually
 * means the user logged in but hasn't been linked yet).
 */
function userScopeIdFor(identity: ResolvedIdentity | null): string | null {
  if (!identity) return null;
  const cwEmail = identity.cwMember?.primaryEmail?.trim();
  if (cwEmail) return cwEmail.toLowerCase();
  if (identity.oauthEmail) return identity.oauthEmail.toLowerCase();
  return null;
}

/**
 * Composes the merged context for a given caller: global → role → user.
 * Each layer's markdown is included if it exists, headed by a section
 * marker so the AI can resolve conflicts (more specific wins).
 */
export async function composeMergedContext(identity: ResolvedIdentity | null): Promise<string> {
  const parts: string[] = [];

  const global = await getActiveContext('global', null);
  if (global) {
    parts.push('# Global context\n\n' + global.markdown.trim());
  }

  if (identity?.cwMember?.securityRoleName) {
    const role = await getActiveContext('role', identity.cwMember.securityRoleName);
    if (role) {
      parts.push(`# Role context: ${identity.cwMember.securityRoleName}\n\n` + role.markdown.trim());
    }
  }

  const userScopeId = userScopeIdFor(identity);
  if (userScopeId) {
    const user = await getActiveContext('user', userScopeId);
    if (user) {
      parts.push(`# User context: ${userScopeId}\n\n` + user.markdown.trim());
    }
  }

  if (parts.length === 0) {
    return '# Context\n\n_No context documents configured for this server yet._';
  }

  return parts.join('\n\n---\n\n');
}

/**
 * Per-resource read-access enforcement. Throws an Error with a clear
 * message if the caller cannot read this URI (the MCP SDK turns it
 * into a -32602 response).
 *
 * Rules:
 * - context://global   — any authenticated caller
 * - context://current  — any authenticated caller (varies by caller)
 * - context://role/X   — admins always; non-admins only if their role IS X
 * - context://user/E   — admins always; non-admins only if their email IS E
 *
 * Service-account callers (no human identity) see only global + current.
 */
export function assertReadAccess(
  identity: ResolvedIdentity | null,
  scopeType: ScopeType,
  scopeId: string | null,
): void {
  if (scopeType === 'global') return;
  if (identity?.isAdmin) return;

  if (!identity || !identity.cwMember) {
    throw new Error(
      `Read access denied: service-account / unmapped callers can only read context://global and context://current`,
    );
  }

  if (scopeType === 'role') {
    if (identity.cwMember.securityRoleName !== scopeId) {
      throw new Error(
        `Read access denied: role context for "${scopeId}" is restricted to members of that role`,
      );
    }
    return;
  }

  if (scopeType === 'user') {
    const canonical = userScopeIdFor(identity);
    if (canonical !== (scopeId ?? '').toLowerCase()) {
      throw new Error(
        `Read access denied: user context for "${scopeId}" is restricted to that user`,
      );
    }
  }
}

function makeRead(uri: string, text: string) {
  return { contents: [{ uri, mimeType: MIME, text }] };
}

/**
 * Registers context:// resources on the given MCP server, scoped to
 * the per-request identity. `context://global` and `context://current`
 * are always registered. Role + user resources are only registered when
 * the caller has a resolved CW member identity.
 *
 * Admins are also exposed `context://role/<their-role>` and
 * `context://user/<their-email>` for convenience — they can still read
 * other roles' / users' URIs by calling them with the exact URI; access
 * is enforced at read time, not list time.
 */
export function registerContextResources(server: McpServer, identity: ResolvedIdentity | null): void {
  // Always: global
  server.resource(
    'context-global',
    'context://global',
    { mimeType: MIME, description: 'Org-wide context for all callers (boards, business rules, integration accounts).' },
    async () => {
      assertReadAccess(identity, 'global', null);
      const doc = await getActiveContext('global', null);
      return makeRead('context://global', doc?.markdown ?? '');
    },
  );

  // Always: current (varies by caller — composed from all applicable layers)
  server.resource(
    'context-current',
    'context://current',
    { mimeType: MIME, description: "Merged context for the current caller: global → role → user." },
    async () => {
      const text = await composeMergedContext(identity);
      return makeRead('context://current', text);
    },
  );

  if (identity?.cwMember?.securityRoleName) {
    const roleName = identity.cwMember.securityRoleName;
    const uri = `context://role/${encodeURIComponent(roleName)}`;
    server.resource(
      `context-role-${roleName}`,
      uri,
      { mimeType: MIME, description: `Role-specific context for "${roleName}".` },
      async () => {
        assertReadAccess(identity, 'role', roleName);
        const doc = await getActiveContext('role', roleName);
        return makeRead(uri, doc?.markdown ?? '');
      },
    );
  }

  const userScopeId = userScopeIdFor(identity);
  if (userScopeId) {
    const uri = `context://user/${encodeURIComponent(userScopeId)}`;
    server.resource(
      `context-user-${userScopeId}`,
      uri,
      { mimeType: MIME, description: `User-specific context for ${userScopeId}.` },
      async () => {
        assertReadAccess(identity, 'user', userScopeId);
        const doc = await getActiveContext('user', userScopeId);
        return makeRead(uri, doc?.markdown ?? '');
      },
    );
  }
}
