import type { RequestHandler } from 'express';
import {
  getCwConnection,
  getOauthProvider,
  writeConfig,
  type CwConnectionConfig,
  type OauthProviderConfig,
} from '../config.js';
import { buildAuthHeaders } from '../auth.js';

const REGION_BASE_URLS: Record<string, string> = {
  na: 'https://api-na.myconnectwise.net',
  eu: 'https://api-eu.myconnectwise.net',
  au: 'https://api-au.myconnectwise.net',
  staging: 'https://api-staging.connectwisedev.com',
};

const CODEBASE_OPTIONS = ['v2025_1', 'v2024_1', 'v2023_1', 'v2022_1', 'v2021_2', 'v4_6_release'];

function maskSecret(value: string | undefined): string {
  if (!value) return '';
  if (value.length <= 6) return '••••';
  return `${value.slice(0, 3)}••••${value.slice(-2)}`;
}

function requireFields(body: Record<string, string | undefined>, fields: string[]): string[] {
  const missing: string[] = [];
  for (const f of fields) if (!body[f]?.trim()) missing.push(f);
  return missing;
}

export const settingsGetHandler: RequestHandler = async (req, res, next) => {
  try {
    const [cw, oauth] = await Promise.all([getCwConnection(), getOauthProvider()]);
    const flash = typeof req.query.flash === 'string' ? req.query.flash : null;
    res.render('settings', {
      title: 'Settings',
      admin: req.admin,
      cw,
      oauth,
      maskSecret,
      regionOptions: REGION_BASE_URLS,
      codebaseOptions: CODEBASE_OPTIONS,
      flash,
    });
  } catch (err) {
    next(err);
  }
};

export const updateCwConnectionHandler: RequestHandler = async (req, res, next) => {
  try {
    const body = req.body as Record<string, string | undefined>;
    const missing = requireFields(body, [
      'cwBaseUrl',
      'cwCodebase',
      'cwClientId',
      'cwCompanyId',
      'cwPublicKey',
    ]);
    if (missing.length) {
      res.redirect(302, `/admin/settings?flash=missing:${missing.join(',')}`);
      return;
    }
    const existing = await getCwConnection();
    const privateKey = body.cwPrivateKey?.trim();
    if (!privateKey && !existing?.privateKey) {
      res.redirect(302, '/admin/settings?flash=missing:cwPrivateKey');
      return;
    }
    const next: CwConnectionConfig = {
      baseUrl: body.cwBaseUrl!.trim().replace(/\/$/, ''),
      codebase: body.cwCodebase!.trim(),
      clientId: body.cwClientId!.trim(),
      companyId: body.cwCompanyId!.trim(),
      publicKey: body.cwPublicKey!.trim(),
      privateKey: privateKey || existing!.privateKey,
    };
    await writeConfig('cw_connection', next, req.admin?.email ?? null);
    res.redirect(302, '/admin/settings?flash=cw-saved');
  } catch (err) {
    next(err);
  }
};

export const updateOauthProviderHandler: RequestHandler = async (req, res, next) => {
  try {
    const body = req.body as Record<string, string | undefined>;
    const missing = requireFields(body, [
      'oauthIssuer',
      'oauthClientId',
      'allowedEmailDomains',
      'publicBaseUrl',
    ]);
    if (missing.length) {
      res.redirect(302, `/admin/settings?flash=missing:${missing.join(',')}`);
      return;
    }
    const existing = await getOauthProvider();
    const clientSecret = body.oauthClientSecret?.trim();
    if (!clientSecret && !existing?.clientSecret) {
      res.redirect(302, '/admin/settings?flash=missing:oauthClientSecret');
      return;
    }
    const next: OauthProviderConfig = {
      issuer: body.oauthIssuer!.trim().replace(/\/$/, ''),
      clientId: body.oauthClientId!.trim(),
      clientSecret: clientSecret || existing!.clientSecret,
      allowedEmailDomains: body
        .allowedEmailDomains!.split(',')
        .map((d) => d.trim().toLowerCase())
        .filter(Boolean),
      publicBaseUrl: body.publicBaseUrl!.trim().replace(/\/$/, ''),
    };
    await writeConfig('oauth_provider', next, req.admin?.email ?? null);
    res.redirect(302, '/admin/settings?flash=oauth-saved');
  } catch (err) {
    next(err);
  }
};

export const testCwConnectionAuthedHandler: RequestHandler = async (req, res) => {
  const body = req.body as Record<string, string | undefined>;
  // Allow blank private key — fall back to existing stored value.
  const existing = await getCwConnection();
  const baseUrl = (body.cwBaseUrl ?? existing?.baseUrl ?? '').replace(/\/$/, '');
  const codebase = body.cwCodebase ?? existing?.codebase ?? '';
  const clientId = body.cwClientId ?? existing?.clientId ?? '';
  const companyId = body.cwCompanyId ?? existing?.companyId ?? '';
  const publicKey = body.cwPublicKey ?? existing?.publicKey ?? '';
  const privateKey = body.cwPrivateKey?.trim() || existing?.privateKey || '';

  if (!baseUrl || !codebase || !clientId || !companyId || !publicKey || !privateKey) {
    res.type('html').send(`<span style="color: var(--error)">✗ Missing required fields</span>`);
    return;
  }
  try {
    const headers = buildAuthHeaders({ baseUrl, codebase, clientId, companyId, publicKey, privateKey });
    const url = `${baseUrl}/${codebase}/apis/3.0/system/info`;
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 10_000);
    let resp: Response;
    try {
      resp = await fetch(url, { method: 'GET', headers, signal: ac.signal });
    } finally {
      clearTimeout(t);
    }
    if (!resp.ok) {
      const text = await resp.text();
      res
        .type('html')
        .send(`<span style="color: var(--error)">✗ HTTP ${resp.status}: ${escapeHtml(text.slice(0, 300))}</span>`);
      return;
    }
    const info = (await resp.json()) as { version?: string; cloudRegion?: string };
    res.type('html').send(
      `<span style="color: green">✓ Connected — version ${escapeHtml(info.version ?? 'unknown')}, region ${escapeHtml(info.cloudRegion ?? 'unknown')}</span>`,
    );
  } catch (err) {
    res
      .type('html')
      .send(`<span style="color: var(--error)">✗ ${escapeHtml(err instanceof Error ? err.message : String(err))}</span>`);
  }
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
