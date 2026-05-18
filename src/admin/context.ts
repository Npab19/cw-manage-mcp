import type { RequestHandler } from 'express';
import { getSql } from '../db.js';
import {
  composeMergedContext,
  getActiveContext,
  getVersionById,
  listVersions,
  rollbackToVersion,
  saveContext,
  type ScopeType,
} from '../resources/context.js';
import type { ResolvedIdentity } from '../middleware/identity-resolver.js';

interface RoleEntry {
  role_id: string;
  role_name: string;
  member_count: string;
  has_doc: boolean;
  version: number | null;
  updated_at: Date | null;
}

interface UserEntry {
  id: string;
  identifier: string;
  primary_email: string;
  has_doc: boolean;
  version: number | null;
  updated_at: Date | null;
}

const VALID_SCOPES: ScopeType[] = ['global', 'role', 'user'];

function parseScope(raw: string | undefined): ScopeType | null {
  if (!raw) return null;
  return (VALID_SCOPES as string[]).includes(raw) ? (raw as ScopeType) : null;
}

function normalizeScopeId(scope: ScopeType, raw: string | undefined): string | null {
  if (scope === 'global') return null;
  if (!raw) return null;
  return scope === 'user' ? raw.toLowerCase() : raw;
}

function scopePath(scope: ScopeType, scopeId: string | null): string {
  if (scope === 'global') return '/admin/context/global';
  return `/admin/context/${scope === 'role' ? 'roles' : 'users'}/${encodeURIComponent(scopeId ?? '')}`;
}

function scopeUri(scope: ScopeType, scopeId: string | null): string {
  if (scope === 'global') return 'context://global';
  return `context://${scope}/${encodeURIComponent(scopeId ?? '')}`;
}

export const contextIndexHandler: RequestHandler = async (req, res, next) => {
  try {
    const sql = getSql();
    const [global, roleCount, userCount] = await Promise.all([
      getActiveContext('global', null),
      sql<{ n: string }[]>`SELECT COUNT(*)::text AS n FROM context_documents WHERE scope_type='role' AND is_active`,
      sql<{ n: string }[]>`SELECT COUNT(*)::text AS n FROM context_documents WHERE scope_type='user' AND is_active`,
    ]);
    res.render('context/index', {
      title: 'Context',
      admin: req.admin,
      global,
      roleCount: Number(roleCount[0]?.n ?? '0'),
      userCount: Number(userCount[0]?.n ?? '0'),
      flash: typeof req.query.flash === 'string' ? req.query.flash : null,
    });
  } catch (err) {
    next(err);
  }
};

export const contextRolesListHandler: RequestHandler = async (req, res, next) => {
  try {
    const sql = getSql();
    const rows = await sql<RoleEntry[]>`
      SELECT p.role_id::text AS role_id,
             p.role_name,
             COUNT(m.id)::text AS member_count,
             (cd.id IS NOT NULL) AS has_doc,
             cd.version,
             cd.updated_at
        FROM permission_policies p
        LEFT JOIN cw_members m ON m.security_role_id = p.role_id AND m.inactive_flag = FALSE
        LEFT JOIN context_documents cd
               ON cd.scope_type = 'role'
              AND cd.scope_id = p.role_name
              AND cd.is_active
       GROUP BY p.role_id, p.role_name, cd.id, cd.version, cd.updated_at
       ORDER BY p.role_name
    `;
    res.render('context/roles', {
      title: 'Context — Roles',
      admin: req.admin,
      roles: rows,
      flash: typeof req.query.flash === 'string' ? req.query.flash : null,
    });
  } catch (err) {
    next(err);
  }
};

export const contextUsersListHandler: RequestHandler = async (req, res, next) => {
  try {
    const sql = getSql();
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const rows = await sql<UserEntry[]>`
      SELECT m.id::text AS id,
             m.identifier,
             COALESCE(m.primary_email, '') AS primary_email,
             (cd.id IS NOT NULL) AS has_doc,
             cd.version,
             cd.updated_at
        FROM cw_members m
        LEFT JOIN context_documents cd
               ON cd.scope_type = 'user'
              AND cd.scope_id = LOWER(m.primary_email)
              AND cd.is_active
       WHERE m.inactive_flag = FALSE
         AND m.primary_email IS NOT NULL
         AND (${q === ''}
              OR LOWER(m.identifier) LIKE ${'%' + q.toLowerCase() + '%'}
              OR LOWER(m.primary_email) LIKE ${'%' + q.toLowerCase() + '%'})
       ORDER BY m.identifier
       LIMIT 500
    `;
    res.render('context/users', {
      title: 'Context — Users',
      admin: req.admin,
      users: rows,
      q,
      flash: typeof req.query.flash === 'string' ? req.query.flash : null,
    });
  } catch (err) {
    next(err);
  }
};

interface ScopeRouteParams {
  scope: ScopeType;
  scopeId: string | null;
}

function asString(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

function readScopeFromParams(req: Parameters<RequestHandler>[0]): ScopeRouteParams | null {
  // /admin/context/global -> scope=global
  // /admin/context/roles/:roleName -> scope=role
  // /admin/context/users/:email -> scope=user
  const scope = asString(req.params.scope);
  if (scope === 'global') return { scope: 'global', scopeId: null };
  if (scope === 'roles') {
    const roleName = asString(req.params.roleName);
    return roleName ? { scope: 'role', scopeId: roleName } : null;
  }
  if (scope === 'users') {
    const email = asString(req.params.email);
    return email ? { scope: 'user', scopeId: email.toLowerCase() } : null;
  }
  return null;
}

export const contextEditorHandler: RequestHandler = async (req, res, next) => {
  try {
    const parsed = readScopeFromParams(req);
    if (!parsed) {
      res.status(404).send('Unknown context scope');
      return;
    }
    const doc = await getActiveContext(parsed.scope, parsed.scopeId);
    const versions = await listVersions(parsed.scope, parsed.scopeId);
    res.render('context/editor', {
      title: titleFor(parsed),
      admin: req.admin,
      scope: parsed.scope,
      scopeId: parsed.scopeId,
      scopeLabel: labelFor(parsed),
      uri: scopeUri(parsed.scope, parsed.scopeId),
      doc,
      versions,
      saveAction: scopePath(parsed.scope, parsed.scopeId),
      rollbackActionBase: scopePath(parsed.scope, parsed.scopeId) + '/rollback',
      flash: typeof req.query.flash === 'string' ? req.query.flash : null,
    });
  } catch (err) {
    next(err);
  }
};

export const contextSaveHandler: RequestHandler = async (req, res, next) => {
  try {
    const parsed = readScopeFromParams(req);
    if (!parsed) {
      res.status(404).send('Unknown context scope');
      return;
    }
    const body = req.body as { markdown?: unknown };
    const markdown = typeof body.markdown === 'string' ? body.markdown : '';
    await saveContext(parsed.scope, parsed.scopeId, markdown, req.admin?.email ?? null);
    res.redirect(302, scopePath(parsed.scope, parsed.scopeId) + '?flash=saved');
  } catch (err) {
    next(err);
  }
};

export const contextRollbackHandler: RequestHandler = async (req, res, next) => {
  try {
    const parsed = readScopeFromParams(req);
    if (!parsed) {
      res.status(404).send('Unknown context scope');
      return;
    }
    const versionId = asString(req.params.versionId);
    if (!versionId) {
      res.status(400).send('Missing versionId');
      return;
    }
    const target = await getVersionById(versionId);
    if (!target || target.scopeType !== parsed.scope || normalizeScopeId(parsed.scope, parsed.scopeId ?? undefined) !== target.scopeId) {
      res.status(404).send('Version does not belong to this scope');
      return;
    }
    await rollbackToVersion(versionId, req.admin?.email ?? null);
    res.redirect(302, scopePath(parsed.scope, parsed.scopeId) + '?flash=rolledback');
  } catch (err) {
    next(err);
  }
};

export const contextPreviewHandler: RequestHandler = async (req, res, next) => {
  try {
    const sql = getSql();
    const emailRaw = typeof req.query.email === 'string' ? req.query.email.trim() : '';
    let identity: ResolvedIdentity | null = null;
    let preview = '';

    const userOptions = await sql<{ identifier: string; email: string; security_role_name: string | null }[]>`
      SELECT identifier, LOWER(primary_email) AS email, security_role_name
        FROM cw_members
       WHERE inactive_flag = FALSE AND primary_email IS NOT NULL
       ORDER BY identifier
       LIMIT 1000
    `;

    if (emailRaw) {
      const lower = emailRaw.toLowerCase();
      const rows = await sql<
        { id: number; identifier: string; security_role_id: number | null; security_role_name: string | null }[]
      >`
        SELECT id, identifier, security_role_id, security_role_name
          FROM cw_members
         WHERE LOWER(primary_email) = ${lower}
           AND inactive_flag = FALSE
         LIMIT 1
      `;
      const row = rows[0];
      if (row) {
        identity = {
          oauthSub: `preview:${lower}`,
          oauthEmail: lower,
          cwMember: {
            id: row.id,
            identifier: row.identifier,
            securityRoleId: row.security_role_id,
            securityRoleName: row.security_role_name,
          },
          policy: { allowedTools: new Set(), fieldProjections: {} },
          isAdmin: false,
        };
        preview = await composeMergedContext(identity);
      } else {
        preview = `_Preview unavailable: no active member with email ${emailRaw}._`;
      }
    }

    res.render('context/preview', {
      title: 'Context — Preview',
      admin: req.admin,
      email: emailRaw,
      identity,
      preview,
      userOptions,
    });
  } catch (err) {
    next(err);
  }
};

function titleFor(p: ScopeRouteParams): string {
  if (p.scope === 'global') return 'Context — Global';
  if (p.scope === 'role') return `Context — Role: ${p.scopeId}`;
  return `Context — User: ${p.scopeId}`;
}

function labelFor(p: ScopeRouteParams): string {
  if (p.scope === 'global') return 'Global';
  if (p.scope === 'role') return `Role: ${p.scopeId}`;
  return `User: ${p.scopeId}`;
}

export { parseScope };
