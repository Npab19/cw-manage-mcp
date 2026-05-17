import { getSql } from './db.js';

const CACHE_TTL_MS = 30_000;

interface CacheEntry<T> {
  value: T | null;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry<unknown>>();

export function invalidate(key?: string): void {
  if (key) cache.delete(key);
  else cache.clear();
}

async function readFromDb<T>(key: string): Promise<T | null> {
  if (!process.env.DATABASE_URL) return null;
  const sql = getSql();
  const rows = await sql<{ value: T }[]>`SELECT value FROM dashboard_settings WHERE key = ${key}`;
  return rows[0]?.value ?? null;
}

/**
 * Resolves a config namespace. DB row wins; if absent, the envFallback
 * builds the shape from process.env. Returns null when neither side has
 * enough information.
 */
export async function getConfig<T>(
  key: string,
  envFallback: () => T | null,
): Promise<T | null> {
  const cached = cache.get(key) as CacheEntry<T> | undefined;
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }
  let value: T | null = null;
  try {
    value = await readFromDb<T>(key);
  } catch (err) {
    console.warn(`getConfig('${key}') DB read failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (value === null) value = envFallback();
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}

export interface CwConnectionConfig {
  baseUrl: string;
  codebase: string;
  clientId: string;
  companyId: string;
  publicKey: string;
  privateKey: string;
}

export async function getCwConnection(): Promise<CwConnectionConfig | null> {
  return getConfig<CwConnectionConfig>('cw_connection', () => {
    const baseUrl = process.env.CW_BASE_URL;
    const codebase = process.env.CW_CODEBASE;
    const clientId = process.env.CW_CLIENT_ID;
    const companyId = process.env.CW_COMPANY_ID;
    const publicKey = process.env.CW_PUBLIC_KEY;
    const privateKey = process.env.CW_PRIVATE_KEY;
    if (!baseUrl || !codebase || !clientId) return null;
    if (!companyId || !publicKey || !privateKey) {
      return { baseUrl, codebase, clientId, companyId: '', publicKey: '', privateKey: '' };
    }
    return { baseUrl, codebase, clientId, companyId, publicKey, privateKey };
  });
}

export interface OauthProviderConfig {
  issuer: string;
  clientId: string;
  clientSecret: string;
  allowedEmailDomains: string[];
  publicBaseUrl: string;
}

export async function getOauthProvider(): Promise<OauthProviderConfig | null> {
  return getConfig<OauthProviderConfig>('oauth_provider', () => {
    const issuer = process.env.OAUTH_ISSUER;
    const clientId = process.env.OAUTH_CLIENT_ID;
    const clientSecret = process.env.OAUTH_CLIENT_SECRET;
    const allowedRaw = process.env.OAUTH_ALLOWED_EMAIL_DOMAINS;
    const publicBaseUrl = process.env.PUBLIC_BASE_URL;
    if (!issuer || !clientId || !clientSecret || !allowedRaw || !publicBaseUrl) return null;
    return {
      issuer: issuer.replace(/\/$/, ''),
      clientId,
      clientSecret,
      allowedEmailDomains: allowedRaw
        .split(',')
        .map((d) => d.trim().toLowerCase())
        .filter(Boolean),
      publicBaseUrl: publicBaseUrl.replace(/\/$/, ''),
    };
  });
}

export async function writeConfig<T>(
  key: string,
  value: T,
  updatedBy: string | null,
): Promise<void> {
  const sql = getSql();
  await sql`
    INSERT INTO dashboard_settings (key, value, updated_by, updated_at)
    VALUES (${key}, ${sql.json(value as never)}, ${updatedBy}, now())
    ON CONFLICT (key) DO UPDATE
      SET value = EXCLUDED.value,
          updated_by = EXCLUDED.updated_by,
          updated_at = now()
  `;
  invalidate(key);
}
