import type { RequestHandler } from 'express';
import { getSql } from '../db.js';
import { writeConfig, invalidate, type CwConnectionConfig, type OauthProviderConfig } from '../config.js';
import { bootstrapCodeMatches, consumeBootstrapCode } from './auth.js';
import { buildAuthHeaders } from '../auth.js';

const REGION_BASE_URLS: Record<string, string> = {
  na: 'https://api-na.myconnectwise.net',
  eu: 'https://api-eu.myconnectwise.net',
  au: 'https://api-au.myconnectwise.net',
  staging: 'https://api-staging.connectwisedev.com',
};

const CODEBASE_OPTIONS = ['v2025_1', 'v2024_1', 'v2023_1', 'v2022_1', 'v2021_2', 'v4_6_release'];

let setupCompleteCache: boolean | null = null;
async function isSetupComplete(): Promise<boolean> {
  if (setupCompleteCache !== null) return setupCompleteCache;
  if (!process.env.DATABASE_URL) {
    setupCompleteCache = false;
    return false;
  }
  const sql = getSql();
  const rows = await sql<{ setup_completed_at: Date | null }[]>`
    SELECT setup_completed_at FROM setup_state WHERE id = 1
  `;
  setupCompleteCache = rows[0]?.setup_completed_at != null;
  return setupCompleteCache;
}

async function markSetupComplete(by: string): Promise<void> {
  const sql = getSql();
  await sql`
    UPDATE setup_state SET setup_completed_at = now(), completed_by = ${by} WHERE id = 1
  `;
  setupCompleteCache = true;
}

function requireFormFields(body: Record<string, string | undefined>, fields: string[]): string[] {
  const missing: string[] = [];
  for (const f of fields) if (!body[f]?.trim()) missing.push(f);
  return missing;
}

export const setupGetHandler: RequestHandler = async (req, res, next) => {
  try {
    if (await isSetupComplete()) {
      res.redirect(302, '/admin');
      return;
    }
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    if (!bootstrapCodeMatches(code)) {
      res.status(404).render('setup-locked', { title: 'Setup' });
      return;
    }
    res.render('setup', {
      title: 'Setup wizard',
      code,
      regionOptions: REGION_BASE_URLS,
      codebaseOptions: CODEBASE_OPTIONS,
      form: {},
      errors: [],
    });
  } catch (err) {
    next(err);
  }
};

export const setupPostHandler: RequestHandler = async (req, res, next) => {
  try {
    if (await isSetupComplete()) {
      res.status(410).send('Setup has already been completed');
      return;
    }
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    if (!bootstrapCodeMatches(code)) {
      res.status(403).send('Invalid or expired bootstrap code');
      return;
    }
    const body = req.body as Record<string, string | undefined>;
    const errors: string[] = [];
    const missing = requireFormFields(body, [
      'oauthIssuer',
      'oauthClientId',
      'oauthClientSecret',
      'allowedEmailDomains',
      'publicBaseUrl',
      'adminEmail',
      'cwBaseUrl',
      'cwCodebase',
      'cwClientId',
      'cwCompanyId',
      'cwPublicKey',
      'cwPrivateKey',
    ]);
    if (missing.length) errors.push(`Missing required fields: ${missing.join(', ')}`);

    if (errors.length) {
      res.status(400).render('setup', {
        title: 'Setup wizard',
        code,
        regionOptions: REGION_BASE_URLS,
        codebaseOptions: CODEBASE_OPTIONS,
        form: body,
        errors,
      });
      return;
    }

    const oauthProvider: OauthProviderConfig = {
      issuer: body.oauthIssuer!.trim().replace(/\/$/, ''),
      clientId: body.oauthClientId!.trim(),
      clientSecret: body.oauthClientSecret!.trim(),
      allowedEmailDomains: body
        .allowedEmailDomains!.split(',')
        .map((d) => d.trim().toLowerCase())
        .filter(Boolean),
      publicBaseUrl: body.publicBaseUrl!.trim().replace(/\/$/, ''),
    };
    const cwConnection: CwConnectionConfig = {
      baseUrl: body.cwBaseUrl!.trim().replace(/\/$/, ''),
      codebase: body.cwCodebase!.trim(),
      clientId: body.cwClientId!.trim(),
      companyId: body.cwCompanyId!.trim(),
      publicKey: body.cwPublicKey!.trim(),
      privateKey: body.cwPrivateKey!.trim(),
    };
    const adminEmail = body.adminEmail!.trim().toLowerCase();

    await writeConfig('oauth_provider', oauthProvider, adminEmail);
    await writeConfig('cw_connection', cwConnection, adminEmail);
    await writeConfig('extra_admin_emails', [adminEmail], adminEmail);
    await markSetupComplete(adminEmail);
    consumeBootstrapCode(code);
    invalidate();

    res.render('setup-done', {
      title: 'Setup complete',
      adminEmail,
    });
  } catch (err) {
    next(err);
  }
};

export const testCwConnectionHandler: RequestHandler = async (req, res) => {
  if (await isSetupComplete()) {
    res.status(410).json({ ok: false, error: 'Setup has already been completed' });
    return;
  }
  const code = typeof req.query.code === 'string' ? req.query.code : '';
  if (!bootstrapCodeMatches(code)) {
    res.status(403).json({ ok: false, error: 'Invalid or expired bootstrap code' });
    return;
  }
  const body = req.body as Record<string, string | undefined>;
  const missing = requireFormFields(body, [
    'cwBaseUrl',
    'cwCodebase',
    'cwClientId',
    'cwCompanyId',
    'cwPublicKey',
    'cwPrivateKey',
  ]);
  if (missing.length) {
    res.status(400).json({ ok: false, error: `Missing: ${missing.join(', ')}` });
    return;
  }
  try {
    const baseUrl = body.cwBaseUrl!.replace(/\/$/, '');
    const codebase = body.cwCodebase!;
    const headers = buildAuthHeaders({
      baseUrl,
      codebase,
      clientId: body.cwClientId!,
      companyId: body.cwCompanyId!,
      publicKey: body.cwPublicKey!,
      privateKey: body.cwPrivateKey!,
    });
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
      res.type('html').send(
        `<span style="color: var(--error)">✗ HTTP ${resp.status}: ${escapeHtml(text.slice(0, 300))}</span>`,
      );
      return;
    }
    const info = (await resp.json()) as { version?: string; cloudRegion?: string };
    res.type('html').send(
      `<span style="color: green">✓ Connected — version ${escapeHtml(info.version ?? 'unknown')}, region ${escapeHtml(info.cloudRegion ?? 'unknown')}</span>`,
    );
  } catch (err) {
    res.type('html').send(
      `<span style="color: var(--error)">✗ ${escapeHtml(err instanceof Error ? err.message : String(err))}</span>`,
    );
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

export function invalidateSetupCache(): void {
  setupCompleteCache = null;
}

export function printBootstrapBanner(host: string, code: string): void {
  const border = '='.repeat(70);
  // Direct console.log: this is an operator instruction, not a log line.
  console.log('');
  console.log('');
  console.log(border);
  console.log('');
  console.log('  SETUP REQUIRED');
  console.log('');
  console.log('  Visit this URL to complete first-time setup:');
  console.log('');
  console.log(`    ${host}/admin/setup?code=${code}`);
  console.log('');
  console.log('  This code is valid for one setup attempt and rotates if the');
  console.log('  container restarts before setup completes.');
  console.log('');
  console.log(border);
  console.log('');
  console.log('');
}
