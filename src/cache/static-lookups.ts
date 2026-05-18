import { cwFetch } from '../client.js';
import { cacheKey, getOrFetch } from '../cache.js';
import type { CwRequestContext, PaginationParams } from '../types.js';

/**
 * Drop-in replacement for cwFetch on endpoints whose results change
 * rarely (boards, priorities, SLAs, work roles, departments, ...).
 * Keyed by path + canonical params, so the same params produce a hit
 * regardless of object-key ordering or whitespace.
 */
export async function cachedCwFetch<T = unknown>(
  ctx: CwRequestContext,
  path: string,
  params: PaginationParams = {},
): Promise<{ data: T; linkHeader?: string; nextPageUrl?: string }> {
  const key = cacheKey(path, params);
  return getOrFetch(key, () => cwFetch<T>(ctx, path, params));
}
