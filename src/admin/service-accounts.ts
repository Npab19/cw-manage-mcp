import type { RequestHandler } from 'express';
import {
  ALWAYS_ADMIN_ONLY,
  MODULE_TOOLS,
  COMPOSITE_REQUIREMENTS,
} from '../import/permission-derivation.js';
import {
  listServiceAccounts,
  createServiceAccount,
  revokeServiceAccount,
} from '../services/service-accounts.js';

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
  return groups;
}

export const serviceAccountsGetHandler: RequestHandler = async (req, res, next) => {
  try {
    const accounts = await listServiceAccounts();
    res.render('service-accounts', {
      title: 'Service accounts',
      admin: req.admin,
      accounts,
      groups: buildToolCatalog(),
      flash: typeof req.query.flash === 'string' ? req.query.flash : null,
    });
  } catch (err) {
    next(err);
  }
};

export const serviceAccountCreateHandler: RequestHandler = async (req, res, next) => {
  try {
    const body = req.body as {
      name?: string;
      description?: string;
      allowed_tools?: string[] | string;
    };
    const name = body.name?.trim();
    if (!name) {
      res.redirect(302, '/admin/service-accounts?flash=missing-name');
      return;
    }
    const raw = body.allowed_tools;
    const submitted = Array.isArray(raw) ? raw : raw ? [raw] : [];
    const allowed = submitted.filter(
      (t) => typeof t === 'string' && !ALWAYS_ADMIN_ONLY.has(t),
    );
    if (allowed.length === 0) {
      res.redirect(302, '/admin/service-accounts?flash=no-tools');
      return;
    }
    const { row, fullKey } = await createServiceAccount({
      name,
      description: body.description?.trim() || null,
      allowedTools: allowed,
      createdBy: req.admin?.email ?? 'admin',
    });
    res.render('service-account-created', {
      title: 'Service account created',
      admin: req.admin,
      account: row,
      fullKey,
    });
  } catch (err) {
    if (err instanceof Error && /unique/i.test(err.message)) {
      res.redirect(302, '/admin/service-accounts?flash=duplicate-name');
      return;
    }
    next(err);
  }
};

export const serviceAccountRevokeHandler: RequestHandler = async (req, res, next) => {
  try {
    const id = req.params.id;
    if (typeof id !== 'string' || !id) {
      res.status(400).send('Missing id');
      return;
    }
    await revokeServiceAccount(id, req.admin?.email ?? 'admin');
    res.redirect(302, '/admin/service-accounts?flash=revoked');
  } catch (err) {
    next(err);
  }
};
