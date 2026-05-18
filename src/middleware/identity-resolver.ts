import type { RequestHandler } from 'express';
import { getSql } from '../db.js';
import { getConfig } from '../config.js';
import { ALWAYS_ADMIN_ONLY } from '../import/permission-derivation.js';
import { isDbAdmin } from '../services/admin-roles.js';

export interface ResolvedCwMember {
  id: number;
  identifier: string;
  primaryEmail: string | null;
  securityRoleId: number | null;
  securityRoleName: string | null;
}

export interface ResolvedPolicy {
  allowedTools: Set<string>;
  fieldProjections: Record<string, string[]>;
}

export interface ResolvedIdentity {
  oauthSub: string;
  oauthEmail: string;
  cwMember: ResolvedCwMember | null;
  policy: ResolvedPolicy;
  isAdmin: boolean;
  serviceAccount?: { id: string; name: string };
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      identity?: ResolvedIdentity;
    }
  }
}

async function isAdminEmail(email: string): Promise<boolean> {
  const lower = email.toLowerCase();
  const fromEnv = (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (fromEnv.includes(lower)) return true;
  const fromDb = await getConfig<string[]>('extra_admin_emails', () => []);
  if (Array.isArray(fromDb) && fromDb.map((e) => e.toLowerCase()).includes(lower)) return true;
  return isDbAdmin(lower);
}

async function findOrAutoLinkMember(
  sub: string,
  email: string,
): Promise<ResolvedCwMember | null> {
  const sql = getSql();

  const mapped = await sql<
    {
      id: number;
      identifier: string;
      primary_email: string | null;
      security_role_id: number | null;
      security_role_name: string | null;
    }[]
  >`
    SELECT m.id, m.identifier, m.primary_email, m.security_role_id, m.security_role_name
      FROM user_mappings um
      JOIN cw_members m ON m.id = um.cw_member_id
     WHERE um.oauth_sub = ${sub}
       AND m.inactive_flag = FALSE
     LIMIT 1
  `;
  if (mapped[0]) {
    return {
      id: mapped[0].id,
      identifier: mapped[0].identifier,
      primaryEmail: mapped[0].primary_email,
      securityRoleId: mapped[0].security_role_id,
      securityRoleName: mapped[0].security_role_name,
    };
  }

  // No mapping yet — try a case-insensitive email auto-link.
  const candidates = await sql<
    {
      id: number;
      identifier: string;
      primary_email: string | null;
      security_role_id: number | null;
      security_role_name: string | null;
    }[]
  >`
    SELECT id, identifier, primary_email, security_role_id, security_role_name
      FROM cw_members
     WHERE LOWER(primary_email) = ${email.toLowerCase()}
       AND inactive_flag = FALSE
     LIMIT 1
  `;
  const candidate = candidates[0];
  if (!candidate) return null;

  await sql`
    INSERT INTO user_mappings (oauth_sub, cw_member_id, source, linked_by)
    VALUES (${sub}, ${candidate.id}, 'auto-email', NULL)
    ON CONFLICT (oauth_sub) DO NOTHING
  `;
  return {
    id: candidate.id,
    identifier: candidate.identifier,
    primaryEmail: candidate.primary_email,
    securityRoleId: candidate.security_role_id,
    securityRoleName: candidate.security_role_name,
  };
}

async function loadPolicyForRole(roleId: number | null): Promise<ResolvedPolicy> {
  const empty: ResolvedPolicy = { allowedTools: new Set(), fieldProjections: {} };
  if (roleId == null) return empty;
  const sql = getSql();
  const rows = await sql<{ allowed_tools: string[]; field_projections: Record<string, string[]> }[]>`
    SELECT allowed_tools, field_projections
      FROM permission_policies
     WHERE role_id = ${roleId}
     LIMIT 1
  `;
  const row = rows[0];
  if (!row) return empty;
  return {
    allowedTools: new Set(row.allowed_tools),
    fieldProjections: row.field_projections ?? {},
  };
}

/**
 * Per-request middleware. Runs after oauthMiddleware so req.oauth is
 * populated. Always succeeds (never blocks the request) — downstream
 * tool registration is what enforces the policy. A user with no
 * mapping and no admin status gets an empty tool surface.
 */
export const identityResolverMiddleware: RequestHandler = async (req, _res, next) => {
  // Service-account auth (if applicable) already populated req.identity.
  if (req.identity) return next();
  if (!req.oauth?.sub || !req.oauth?.email) {
    return next();
  }
  if (!process.env.DATABASE_URL) {
    // No DB available — fall through as anonymous identity.
    req.identity = {
      oauthSub: req.oauth.sub,
      oauthEmail: req.oauth.email,
      cwMember: null,
      policy: { allowedTools: new Set(), fieldProjections: {} },
      isAdmin: false,
    };
    return next();
  }

  try {
    const sql = getSql();
    const sub = req.oauth.sub;
    const email = req.oauth.email;

    await sql`
      INSERT INTO oauth_identities (sub, email, first_seen, last_seen)
      VALUES (${sub}, ${email}, now(), now())
      ON CONFLICT (sub) DO UPDATE SET
        email = EXCLUDED.email,
        last_seen = now()
    `;

    const [cwMember, isAdmin] = await Promise.all([
      findOrAutoLinkMember(sub, email),
      isAdminEmail(email),
    ]);
    const policy = isAdmin
      ? { allowedTools: new Set<string>(), fieldProjections: {} }
      : await loadPolicyForRole(cwMember?.securityRoleId ?? null);

    req.identity = { oauthSub: sub, oauthEmail: email, cwMember, policy, isAdmin };
  } catch (err) {
    console.warn(
      `[identity] resolver failed for ${req.oauth.email}: ${err instanceof Error ? err.message : String(err)}`,
    );
    req.identity = {
      oauthSub: req.oauth.sub,
      oauthEmail: req.oauth.email,
      cwMember: null,
      policy: { allowedTools: new Set(), fieldProjections: {} },
      isAdmin: false,
    };
  }
  next();
};

export function identityAllowsTool(identity: ResolvedIdentity, toolName: string): boolean {
  if (ALWAYS_ADMIN_ONLY.has(toolName)) return identity.isAdmin;
  if (identity.isAdmin) return true;
  return identity.policy.allowedTools.has(toolName);
}
