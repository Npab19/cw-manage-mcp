import type { RequestHandler } from 'express';
import {
  getCwConnection,
  getOauthProvider,
  getConfig,
  writeConfig,
  type CwConnectionConfig,
  type OauthProviderConfig,
} from '../config.js';
import { buildAuthHeaders } from '../auth.js';
import { invalidate as invalidateCache, getCacheStats } from '../cache.js';
import { resetRateLimitBuckets } from '../middleware/rate-limit.js';

interface OperationalSettings {
  cacheLookupTtlSeconds: number;
  rateUserCapacity: number;
  rateUserRefillPerMinute: number;
  rateSaCapacity: number;
  rateSaRefillPerMinute: number;
  userImportCron: string;
  auditLogRetentionDays: number;
  backupEnabled: boolean;
  backupPath: string;
  backupRetentionDays: number;
}

const OP_DEFAULTS: OperationalSettings = {
  cacheLookupTtlSeconds: 3600,
  rateUserCapacity: 60,
  rateUserRefillPerMinute: 60,
  rateSaCapacity: 600,
  rateSaRefillPerMinute: 600,
  userImportCron: '0 2 * * *',
  auditLogRetentionDays: 90,
  backupEnabled: true,
  backupPath: '/backups',
  backupRetentionDays: 30,
};

async function loadOperationalSettings(): Promise<OperationalSettings> {
  const fields: Array<[string, keyof OperationalSettings]> = [
    ['cache.lookup_ttl_seconds', 'cacheLookupTtlSeconds'],
    ['rate_limit.per_user_capacity', 'rateUserCapacity'],
    ['rate_limit.per_user_refill_per_minute', 'rateUserRefillPerMinute'],
    ['rate_limit.per_service_account_capacity', 'rateSaCapacity'],
    ['rate_limit.per_service_account_refill_per_minute', 'rateSaRefillPerMinute'],
    ['sync.user_import_cron', 'userImportCron'],
    ['retention.mcp_audit_log_days', 'auditLogRetentionDays'],
    ['backup.enabled', 'backupEnabled'],
    ['backup.path', 'backupPath'],
    ['backup.retention_days', 'backupRetentionDays'],
  ];
  const out = { ...OP_DEFAULTS };
  for (const [key, prop] of fields) {
    const value = await getConfig<unknown>(key, () => OP_DEFAULTS[prop]);
    if (value != null) (out[prop] as unknown) = value;
  }
  return out;
}

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
    const [cw, oauth, operational] = await Promise.all([
      getCwConnection(),
      getOauthProvider(),
      loadOperationalSettings(),
    ]);
    const flash = typeof req.query.flash === 'string' ? req.query.flash : null;
    res.render('settings', {
      title: 'Settings',
      admin: req.admin,
      cw,
      oauth,
      operational,
      cacheStats: getCacheStats(),
      maskSecret,
      regionOptions: REGION_BASE_URLS,
      codebaseOptions: CODEBASE_OPTIONS,
      flash,
    });
  } catch (err) {
    next(err);
  }
};

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

export const updateOperationalHandler: RequestHandler = async (req, res, next) => {
  try {
    const body = req.body as Record<string, string | undefined>;
    const updates: Array<[string, unknown]> = [
      ['cache.lookup_ttl_seconds', parsePositiveInt(body.cacheLookupTtlSeconds, OP_DEFAULTS.cacheLookupTtlSeconds)],
      ['rate_limit.per_user_capacity', parsePositiveInt(body.rateUserCapacity, OP_DEFAULTS.rateUserCapacity)],
      ['rate_limit.per_user_refill_per_minute', parsePositiveInt(body.rateUserRefillPerMinute, OP_DEFAULTS.rateUserRefillPerMinute)],
      ['rate_limit.per_service_account_capacity', parsePositiveInt(body.rateSaCapacity, OP_DEFAULTS.rateSaCapacity)],
      ['rate_limit.per_service_account_refill_per_minute', parsePositiveInt(body.rateSaRefillPerMinute, OP_DEFAULTS.rateSaRefillPerMinute)],
      ['sync.user_import_cron', body.userImportCron?.trim() || OP_DEFAULTS.userImportCron],
      ['retention.mcp_audit_log_days', parsePositiveInt(body.auditLogRetentionDays, OP_DEFAULTS.auditLogRetentionDays)],
      ['backup.enabled', body.backupEnabled === 'on'],
      ['backup.path', body.backupPath?.trim() || OP_DEFAULTS.backupPath],
      ['backup.retention_days', parsePositiveInt(body.backupRetentionDays, OP_DEFAULTS.backupRetentionDays)],
    ];
    for (const [key, value] of updates) {
      await writeConfig(key, value, req.admin?.email ?? null);
    }
    res.redirect(302, '/admin/settings?flash=operational-saved');
  } catch (err) {
    next(err);
  }
};

export const clearCacheHandler: RequestHandler = (req, res) => {
  const n = invalidateCache();
  res.redirect(302, `/admin/settings?flash=cache-cleared:${n}`);
};

export const resetRateBucketsHandler: RequestHandler = (req, res) => {
  resetRateLimitBuckets();
  res.redirect(302, '/admin/settings?flash=rate-buckets-cleared');
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
