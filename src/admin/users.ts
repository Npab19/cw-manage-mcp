import type { RequestHandler } from 'express';
import { getSql } from '../db.js';
import { runUserImport, lastUserImportRun } from '../import/cw-users.js';
import { grantAdminRole, revokeAdminRole, listAdminRoleAssignments } from '../services/admin-roles.js';

interface MemberRow {
  id: string;
  identifier: string;
  first_name: string | null;
  last_name: string | null;
  primary_email: string | null;
  security_role_name: string | null;
  member_type: string | null;
  inactive_flag: boolean;
  mapped_oauth_email: string | null;
  mapped_oauth_sub: string | null;
  mapping_source: string | null;
}

interface UnmappedIdentityRow {
  sub: string;
  email: string | null;
  first_seen: Date;
  last_seen: Date;
}

export const usersGetHandler: RequestHandler = async (req, res, next) => {
  try {
    const sql = getSql();
    const showApi = req.query.showApi === '1';
    const [members, unmapped, lastRun, adminAssignments] = await Promise.all([
      sql<MemberRow[]>`
        SELECT
          m.id::text AS id,
          m.identifier,
          m.first_name,
          m.last_name,
          m.primary_email,
          m.security_role_name,
          m.member_type,
          m.inactive_flag,
          oi.email AS mapped_oauth_email,
          um.oauth_sub AS mapped_oauth_sub,
          um.source AS mapping_source
        FROM cw_members m
        LEFT JOIN user_mappings um ON um.cw_member_id = m.id
        LEFT JOIN oauth_identities oi ON oi.sub = um.oauth_sub
        WHERE ${showApi ? sql`TRUE` : sql`(m.member_type IS NULL OR m.member_type <> 'API')`}
        ORDER BY m.inactive_flag ASC, m.last_name ASC, m.first_name ASC
        LIMIT 5000
      `,
      sql<UnmappedIdentityRow[]>`
        SELECT oi.sub, oi.email, oi.first_seen, oi.last_seen
        FROM oauth_identities oi
        LEFT JOIN user_mappings um ON um.oauth_sub = oi.sub
        WHERE um.oauth_sub IS NULL
        ORDER BY oi.last_seen DESC
        LIMIT 100
      `,
      lastUserImportRun(),
      listAdminRoleAssignments(),
    ]);
    const envAdminEmails = (process.env.ADMIN_EMAILS ?? '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);
    const dbAdminEmails = new Set(
      adminAssignments.filter((a) => !a.revoked_at).map((a) => a.email.toLowerCase()),
    );
    res.render('users', {
      title: 'Users',
      admin: req.admin,
      members,
      unmapped,
      lastRun,
      showApi,
      envAdminEmails,
      dbAdminEmails,
      adminAssignments,
      flash: typeof req.query.flash === 'string' ? req.query.flash : null,
    });
  } catch (err) {
    next(err);
  }
};

export const usersSyncHandler: RequestHandler = async (req, res, next) => {
  try {
    const result = await runUserImport(req.admin?.email ?? 'admin');
    if (result.status === 'error') {
      res.redirect(302, `/admin/users?flash=sync-error`);
      return;
    }
    res.redirect(
      302,
      `/admin/users?flash=sync-ok:${result.rowsAdded}+${result.rowsUpdated}-${result.rowsDeactivated}`,
    );
  } catch (err) {
    next(err);
  }
};

export const usersMapHandler: RequestHandler = async (req, res, next) => {
  try {
    const body = req.body as { oauth_sub?: string; cw_member_id?: string };
    const oauthSub = body.oauth_sub?.trim();
    const cwMemberId = body.cw_member_id?.trim();
    if (!oauthSub || !cwMemberId) {
      res.redirect(302, '/admin/users?flash=map-missing');
      return;
    }
    const sql = getSql();
    await sql`
      INSERT INTO user_mappings (oauth_sub, cw_member_id, source, linked_by, linked_at)
      VALUES (${oauthSub}, ${cwMemberId}, 'manual', ${req.admin?.email ?? null}, now())
      ON CONFLICT (oauth_sub) DO UPDATE SET
        cw_member_id = EXCLUDED.cw_member_id,
        source = 'manual',
        linked_by = EXCLUDED.linked_by,
        linked_at = now()
    `;
    res.redirect(302, '/admin/users?flash=map-ok');
  } catch (err) {
    next(err);
  }
};

export const usersUnmapHandler: RequestHandler = async (req, res, next) => {
  try {
    const body = req.body as { oauth_sub?: string };
    const oauthSub = body.oauth_sub?.trim();
    if (!oauthSub) {
      res.redirect(302, '/admin/users?flash=unmap-missing');
      return;
    }
    const sql = getSql();
    await sql`DELETE FROM user_mappings WHERE oauth_sub = ${oauthSub}`;
    res.redirect(302, '/admin/users?flash=unmap-ok');
  } catch (err) {
    next(err);
  }
};

export const adminPromoteHandler: RequestHandler = async (req, res, next) => {
  try {
    const body = req.body as { email?: string };
    const email = body.email?.trim().toLowerCase();
    if (!email) {
      res.redirect(302, '/admin/users?flash=admin-missing');
      return;
    }
    await grantAdminRole(email, req.admin?.email ?? 'admin');
    res.redirect(302, '/admin/users?flash=admin-promoted');
  } catch (err) {
    next(err);
  }
};

export const adminRevokeHandler: RequestHandler = async (req, res, next) => {
  try {
    const body = req.body as { email?: string };
    const email = body.email?.trim().toLowerCase();
    if (!email) {
      res.redirect(302, '/admin/users?flash=admin-missing');
      return;
    }
    // Soft block: don't let an admin revoke their own currently-signed-in
    // session. ADMIN_EMAILS still works as a break-glass anyway, but the
    // accidental self-revoke would be confusing.
    if (req.admin?.email && req.admin.email.toLowerCase() === email) {
      res.redirect(302, '/admin/users?flash=admin-self');
      return;
    }
    await revokeAdminRole(email, req.admin?.email ?? 'admin');
    res.redirect(302, '/admin/users?flash=admin-revoked');
  } catch (err) {
    next(err);
  }
};
