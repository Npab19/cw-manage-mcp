import type { RequestHandler } from 'express';
import { getConfig } from '../config.js';
import type { ResolvedIdentity } from './identity-resolver.js';

interface Bucket {
  tokens: number;
  lastRefillAt: number;
}

interface BucketConfig {
  capacity: number;
  refillPerMinute: number;
}

const buckets = new Map<string, Bucket>();

const RECENT_429_LIMIT = 100;
const recent429s: Array<{ ts: number; key: string }> = [];

const DEFAULTS = {
  user: { capacity: 60, refillPerMinute: 60 },
  serviceAccount: { capacity: 600, refillPerMinute: 600 },
};

async function getBucketConfig(isServiceAccount: boolean): Promise<BucketConfig> {
  const capacityKey = isServiceAccount
    ? 'rate_limit.per_service_account_capacity'
    : 'rate_limit.per_user_capacity';
  const refillKey = isServiceAccount
    ? 'rate_limit.per_service_account_refill_per_minute'
    : 'rate_limit.per_user_refill_per_minute';
  const fallback = isServiceAccount ? DEFAULTS.serviceAccount : DEFAULTS.user;

  const [capacityRaw, refillRaw] = await Promise.all([
    getConfig<number>(capacityKey, () => fallback.capacity),
    getConfig<number>(refillKey, () => fallback.refillPerMinute),
  ]);
  const capacity =
    typeof capacityRaw === 'number' && capacityRaw > 0 ? capacityRaw : fallback.capacity;
  const refill =
    typeof refillRaw === 'number' && refillRaw > 0 ? refillRaw : fallback.refillPerMinute;
  return { capacity, refillPerMinute: refill };
}

function identityKey(identity: ResolvedIdentity): string {
  if (identity.serviceAccount) return `sa:${identity.serviceAccount.id}`;
  return `user:${identity.oauthSub}`;
}

function isToolsCall(body: unknown): boolean {
  if (!body || typeof body !== 'object') return false;
  return (body as { method?: unknown }).method === 'tools/call';
}

function record429(key: string): void {
  recent429s.push({ ts: Date.now(), key });
  while (recent429s.length > RECENT_429_LIMIT) recent429s.shift();
}

export const rateLimitMiddleware: RequestHandler = async (req, res, next) => {
  // Only meter actual tool invocations — initialize / ping / tools/list
  // pass through. Rate-limiting list calls would lock a Claude session
  // out of even discovering what it can do.
  if (!isToolsCall((req as { body?: unknown }).body)) return next();
  if (!req.identity) return next();

  const isSa = !!req.identity.serviceAccount;
  const config = await getBucketConfig(isSa);
  const key = identityKey(req.identity);
  const now = Date.now();

  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = { tokens: config.capacity, lastRefillAt: now };
    buckets.set(key, bucket);
  }

  const elapsedMs = now - bucket.lastRefillAt;
  const refilled = (config.refillPerMinute / 60_000) * elapsedMs;
  bucket.tokens = Math.min(config.capacity, bucket.tokens + refilled);
  bucket.lastRefillAt = now;

  if (bucket.tokens < 1) {
    const secondsUntilToken = Math.max(
      1,
      Math.ceil((1 - bucket.tokens) / (config.refillPerMinute / 60)),
    );
    res.setHeader('Retry-After', String(secondsUntilToken));
    record429(key);
    res.status(429).json({
      error: 'rate_limited',
      error_description: `Rate limit exceeded. Try again in ${secondsUntilToken}s.`,
    });
    return;
  }

  bucket.tokens -= 1;
  next();
};

export interface RateLimitStats {
  bucketCount: number;
  recent429Count: number;
  recent429sLastHour: number;
  recent: Array<{ ts: Date; key: string }>;
}

export function getRateLimitStats(): RateLimitStats {
  const oneHourAgo = Date.now() - 60 * 60 * 1000;
  const lastHour = recent429s.filter((r) => r.ts >= oneHourAgo).length;
  return {
    bucketCount: buckets.size,
    recent429Count: recent429s.length,
    recent429sLastHour: lastHour,
    recent: recent429s.slice(-20).map((r) => ({ ts: new Date(r.ts), key: r.key })),
  };
}

export function resetRateLimitBuckets(): void {
  buckets.clear();
}
