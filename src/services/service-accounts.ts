import argon2 from 'argon2';
import { randomBytes } from 'crypto';
import { getSql } from '../db.js';

export interface ServiceAccountRow {
  id: string;
  name: string;
  description: string | null;
  key_prefix: string;
  allowed_tools: string[];
  created_by: string;
  created_at: Date;
  last_used_at: Date | null;
  revoked_at: Date | null;
}

interface ServiceAccountWithHash extends ServiceAccountRow {
  key_hash: string;
}

const PREFIX_LEN = 8;
const SECRET_LEN = 32;
const KEY_RE = /^sa_([0-9a-f]{8})_([A-Za-z0-9_-]{32,})$/;

const ARGON2_OPTS: argon2.HashOptions = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

function base64Url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function generateKey(): { fullKey: string; prefix: string } {
  const prefix = randomBytes(4).toString('hex');
  const secret = base64Url(randomBytes(SECRET_LEN)).slice(0, SECRET_LEN);
  return { fullKey: `sa_${prefix}_${secret}`, prefix };
}

export function parseServiceAccountKey(token: string): { prefix: string } | null {
  const match = KEY_RE.exec(token);
  if (!match) return null;
  return { prefix: match[1]! };
}

export function looksLikeServiceAccountKey(token: string): boolean {
  return token.startsWith('sa_');
}

export async function listServiceAccounts(): Promise<ServiceAccountRow[]> {
  const sql = getSql();
  return sql<ServiceAccountRow[]>`
    SELECT id::text AS id, name, description, key_prefix, allowed_tools,
           created_by, created_at, last_used_at, revoked_at
      FROM service_accounts
     ORDER BY revoked_at NULLS FIRST, created_at DESC
  `;
}

export async function createServiceAccount(opts: {
  name: string;
  description: string | null;
  allowedTools: string[];
  createdBy: string;
}): Promise<{ row: ServiceAccountRow; fullKey: string }> {
  const { fullKey, prefix } = generateKey();
  const keyHash = await argon2.hash(fullKey, ARGON2_OPTS);

  const sql = getSql();
  const inserted = await sql<ServiceAccountRow[]>`
    INSERT INTO service_accounts (name, description, key_hash, key_prefix, allowed_tools, created_by)
    VALUES (${opts.name}, ${opts.description}, ${keyHash}, ${prefix}, ${opts.allowedTools}, ${opts.createdBy})
    RETURNING id::text AS id, name, description, key_prefix, allowed_tools,
              created_by, created_at, last_used_at, revoked_at
  `;
  const row = inserted[0];
  if (!row) throw new Error('Service account insert returned no row');
  return { row, fullKey };
}

export async function revokeServiceAccount(id: string, revokedBy: string): Promise<void> {
  const sql = getSql();
  await sql`
    UPDATE service_accounts
       SET revoked_at = now()
     WHERE id = ${id}::uuid AND revoked_at IS NULL
  `;
  // revokedBy isn't persisted on the row (kept to match the simple schema);
  // it's logged here for the audit trail via the request-context logger.
  console.log(JSON.stringify({ event: 'service_account_revoked', id, revokedBy }));
}

interface ServiceAccountMatch {
  id: string;
  name: string;
  allowedTools: string[];
}

/**
 * Verifies the supplied token against any active service account.
 * Returns null on no-match (unknown prefix, hash mismatch, or revoked).
 * Updates last_used_at on success — best-effort, failures don't block.
 */
export async function verifyServiceAccountKey(token: string): Promise<ServiceAccountMatch | null> {
  const parsed = parseServiceAccountKey(token);
  if (!parsed) return null;
  const sql = getSql();
  const rows = await sql<ServiceAccountWithHash[]>`
    SELECT id::text AS id, name, description, key_prefix, key_hash, allowed_tools,
           created_by, created_at, last_used_at, revoked_at
      FROM service_accounts
     WHERE key_prefix = ${parsed.prefix} AND revoked_at IS NULL
     LIMIT 1
  `;
  const row = rows[0];
  if (!row) return null;
  let ok = false;
  try {
    ok = await argon2.verify(row.key_hash, token);
  } catch {
    ok = false;
  }
  if (!ok) return null;
  sql`UPDATE service_accounts SET last_used_at = now() WHERE id = ${row.id}::uuid`.catch(() => {});
  return { id: row.id, name: row.name, allowedTools: row.allowed_tools };
}
