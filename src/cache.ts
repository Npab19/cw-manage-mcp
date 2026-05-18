import { getConfig } from './config.js';

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const DEFAULT_TTL_SECONDS = 3600;

const store = new Map<string, CacheEntry<unknown>>();
let hits = 0;
let misses = 0;

function canonicalize(obj: unknown): string {
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return '[' + obj.map(canonicalize).join(',') + ']';
  const record = obj as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return (
    '{' +
    keys
      .map((k) => JSON.stringify(k) + ':' + canonicalize(record[k]))
      .join(',') +
    '}'
  );
}

export function cacheKey(path: string, params: unknown): string {
  return `${path}::${canonicalize(params ?? {})}`;
}

async function ttlMs(): Promise<number> {
  const seconds = await getConfig<number>(
    'cache.lookup_ttl_seconds',
    () => DEFAULT_TTL_SECONDS,
  );
  const v = typeof seconds === 'number' && seconds > 0 ? seconds : DEFAULT_TTL_SECONDS;
  return v * 1000;
}

export async function getOrFetch<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const existing = store.get(key) as CacheEntry<T> | undefined;
  if (existing && existing.expiresAt > now) {
    hits++;
    return existing.value;
  }
  misses++;
  const value = await fetcher();
  store.set(key, { value, expiresAt: now + (await ttlMs()) });
  return value;
}

/**
 * Drops cached entries. Returns the number dropped.
 *   invalidate()             — clears everything
 *   invalidate('/path')      — clears entries whose key begins with '/path::'
 */
export function invalidate(prefix?: string): number {
  if (!prefix) {
    const n = store.size;
    store.clear();
    return n;
  }
  const needle = `${prefix}::`;
  let n = 0;
  for (const key of [...store.keys()]) {
    if (key.startsWith(needle)) {
      store.delete(key);
      n++;
    }
  }
  return n;
}

export function getCacheStats(): {
  size: number;
  hits: number;
  misses: number;
  hitRate: number | null;
} {
  const total = hits + misses;
  return {
    size: store.size,
    hits,
    misses,
    hitRate: total > 0 ? hits / total : null,
  };
}
