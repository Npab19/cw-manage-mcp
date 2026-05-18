import type { RequestHandler } from 'express';
import { getSql } from '../db.js';
import {
  ALWAYS_ADMIN_ONLY,
  MODULE_TOOLS,
  COMPOSITE_REQUIREMENTS,
} from '../import/permission-derivation.js';
import { resyncRolePolicy } from '../import/cw-users.js';

interface RoleRow {
  role_id: string;
  role_name: string;
  auto_derived: boolean;
  updated_at: Date;
  updated_by: string | null;
  member_count: string;
}

interface RoleDetail {
  role_id: string;
  role_name: string;
  allowed_tools: string[];
  auto_derived: boolean;
  updated_at: Date;
  updated_by: string | null;
}

/**
 * Returns the complete tool catalog grouped by module, plus the
 * composite-tools group and the admin-only group. Used by the editor
 * to render checkboxes for every tool the system knows about.
 */
function buildToolCatalog(): { group: string; tools: { name: string; alwaysAdmin: boolean }[] }[] {
  const groups: { group: string; tools: { name: string; alwaysAdmin: boolean }[] }[] = [];
  for (const [mod, tools] of Object.entries(MODULE_TOOLS)) {
    groups.push({
      group: mod,
      tools: tools.map((name) => ({ name, alwaysAdmin: ALWAYS_ADMIN_ONLY.has(name) })),
    });
  }
  groups.push({
    group: 'Composite reports',
    tools: Object.keys(COMPOSITE_REQUIREMENTS).map((name) => ({
      name,
      alwaysAdmin: ALWAYS_ADMIN_ONLY.has(name),
    })),
  });
  groups.push({
    group: 'Admin-only (cannot be granted to roles)',
    tools: [...ALWAYS_ADMIN_ONLY].map((name) => ({ name, alwaysAdmin: true })),
  });
  return groups;
}

export const permissionsListHandler: RequestHandler = async (req, res, next) => {
  try {
    const sql = getSql();
    const rows = await sql<RoleRow[]>`
      SELECT
        p.role_id::text AS role_id,
        p.role_name,
        p.auto_derived,
        p.updated_at,
        p.updated_by,
        COUNT(m.id)::text AS member_count
      FROM permission_policies p
      LEFT JOIN cw_members m
             ON m.security_role_id = p.role_id AND m.inactive_flag = FALSE
      GROUP BY p.role_id, p.role_name, p.auto_derived, p.updated_at, p.updated_by
      ORDER BY p.role_name ASC
    `;
    res.render('permissions', {
      title: 'Permissions',
      admin: req.admin,
      roles: rows,
      flash: typeof req.query.flash === 'string' ? req.query.flash : null,
    });
  } catch (err) {
    next(err);
  }
};

export const permissionsEditHandler: RequestHandler = async (req, res, next) => {
  try {
    const roleId = req.params.roleId;
    if (!roleId) {
      res.status(400).send('Missing roleId');
      return;
    }
    const sql = getSql();
    const rows = await sql<RoleDetail[]>`
      SELECT
        role_id::text AS role_id,
        role_name,
        allowed_tools,
        auto_derived,
        updated_at,
        updated_by
      FROM permission_policies
      WHERE role_id = ${roleId}::bigint
      LIMIT 1
    `;
    const role = rows[0];
    if (!role) {
      res.status(404).send('Role not found');
      return;
    }
    const memberRows = await sql<
      { id: string; identifier: string; first_name: string | null; last_name: string | null }[]
    >`
      SELECT id::text AS id, identifier, first_name, last_name
      FROM cw_members
      WHERE security_role_id = ${roleId}::bigint AND inactive_flag = FALSE
      ORDER BY last_name, first_name
      LIMIT 200
    `;
    res.render('permissions-edit', {
      title: `Permissions — ${role.role_name}`,
      admin: req.admin,
      role,
      members: memberRows,
      allowedSet: new Set(role.allowed_tools),
      groups: buildToolCatalog(),
      flash: typeof req.query.flash === 'string' ? req.query.flash : null,
    });
  } catch (err) {
    next(err);
  }
};

export const permissionsResyncHandler: RequestHandler = async (req, res, next) => {
  try {
    const roleId = req.params.roleId;
    if (!roleId) {
      res.status(400).send('Missing roleId');
      return;
    }
    const numericRoleId = Number(roleId);
    if (!Number.isInteger(numericRoleId) || numericRoleId <= 0) {
      res.status(400).send('Invalid roleId');
      return;
    }
    const result = await resyncRolePolicy(numericRoleId, req.admin?.email ?? 'admin');
    const flash = result.sourcedFromCw ? 'resynced' : 'resynced_default';
    res.redirect(302, `/admin/permissions/${roleId}?flash=${flash}`);
  } catch (err) {
    next(err);
  }
};

export const permissionsUpdateHandler: RequestHandler = async (req, res, next) => {
  try {
    const roleId = req.params.roleId;
    if (!roleId) {
      res.status(400).send('Missing roleId');
      return;
    }
    const body = req.body as { allowed_tools?: string[] | string };
    const raw = body.allowed_tools;
    const submitted = Array.isArray(raw) ? raw : raw ? [raw] : [];
    // Drop admin-only tools defensively — never persistable on a role.
    const allowed = submitted.filter((t) => typeof t === 'string' && !ALWAYS_ADMIN_ONLY.has(t));

    const sql = getSql();
    const result = await sql<{ updated_at: Date }[]>`
      UPDATE permission_policies
        SET allowed_tools = ${allowed},
            auto_derived = FALSE,
            updated_at = now(),
            updated_by = ${req.admin?.email ?? null}
        WHERE role_id = ${roleId}::bigint
        RETURNING updated_at
    `;
    if (result.length === 0) {
      res.status(404).send('Role not found');
      return;
    }
    res.redirect(302, `/admin/permissions/${roleId}?flash=saved`);
  } catch (err) {
    next(err);
  }
};
