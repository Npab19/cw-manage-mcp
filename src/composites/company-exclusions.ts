import { getSql } from '../db.js';
import { cwFetch, cwFetchNextPage } from '../client.js';
import type { CwRequestContext, PaginationParams } from '../types.js';

const EXCLUSION_CACHE_TTL_MS = 30_000;

interface CachedExclusions {
  ids: number[];
  expiresAt: number;
}
let cached: CachedExclusions | null = null;

export async function getExcludedCompanyIds(): Promise<number[]> {
  if (cached && cached.expiresAt > Date.now()) return cached.ids;
  if (!process.env.DATABASE_URL) return [];
  try {
    const sql = getSql();
    const rows = await sql<{ cw_company_id: number }[]>`
      SELECT cw_company_id FROM excluded_companies ORDER BY cw_company_id
    `;
    const ids = rows.map((r) => r.cw_company_id);
    cached = { ids, expiresAt: Date.now() + EXCLUSION_CACHE_TTL_MS };
    return ids;
  } catch {
    return [];
  }
}

export function invalidateExclusionsCache(): void {
  cached = null;
}

/**
 * Conservative conditions safety check. The PRD only allows server-side
 * merging when the existing conditions string is empty or a simple
 * AND-of-fragments. Any `or` or parentheses → fall back to client-side
 * filtering so we never accidentally widen the result set.
 */
function conditionsAreSafeForAndMerge(conditions: string | undefined): boolean {
  if (!conditions || !conditions.trim()) return true;
  if (/\bor\b/i.test(conditions)) return false;
  if (/[()]/.test(conditions)) return false;
  return true;
}

function buildNotInClause(field: string, ids: number[]): string {
  return `${field} not in (${ids.join(',')})`;
}

function extractIdFromRow(row: unknown, idPath: string): number | null {
  if (!row || typeof row !== 'object') return null;
  const parts = idPath.split('.');
  let cur: unknown = row;
  for (const p of parts) {
    if (cur && typeof cur === 'object' && p in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[p];
    } else {
      return null;
    }
  }
  return typeof cur === 'number' ? cur : null;
}

export interface ListWithExclusionsResult<T> {
  data: T[];
  linkHeader?: string;
  nextPageUrl?: string;
  meta: {
    excludedCount: number;
    appliedAt: 'server' | 'client' | 'none';
    includeExcluded: boolean;
  };
}

interface ExclusionOpts {
  /**
   * CW conditions field path for the company id, e.g. 'id' for
   * /company/companies or 'company/id' for /service/tickets.
   */
  conditionsField: string;
  /**
   * Dot-delimited JS path used for client-side filtering when the
   * conditions string can't be safely merged. For /company/companies
   * this is 'id'; for /service/tickets it's 'company.id'.
   */
  resultIdPath: string;
}

/**
 * Drop-in replacement for cwFetch<T[]>() that applies the global
 * company-exclusion list. Honors include_excluded:true on the args to
 * skip the filter. Returns the (possibly filtered) data plus meta
 * describing what was applied.
 */
export async function cwFetchListWithExclusions<T = unknown>(
  ctx: CwRequestContext,
  path: string,
  args: PaginationParams & { include_excluded?: boolean },
  opts: ExclusionOpts,
): Promise<ListWithExclusionsResult<T>> {
  const { include_excluded, ...rest } = args;
  const params: PaginationParams = rest;
  const includeExcluded = include_excluded === true;

  const excluded = includeExcluded ? [] : await getExcludedCompanyIds();
  if (excluded.length === 0) {
    const result = await cwFetch<T[]>(ctx, path, params);
    return {
      data: Array.isArray(result.data) ? result.data : [],
      linkHeader: result.linkHeader,
      nextPageUrl: result.nextPageUrl,
      meta: { excludedCount: 0, appliedAt: 'none', includeExcluded },
    };
  }

  if (conditionsAreSafeForAndMerge(params.conditions)) {
    const notIn = buildNotInClause(opts.conditionsField, excluded);
    const merged = params.conditions ? `${params.conditions} AND ${notIn}` : notIn;
    const result = await cwFetch<T[]>(ctx, path, { ...params, conditions: merged });
    return {
      data: Array.isArray(result.data) ? result.data : [],
      linkHeader: result.linkHeader,
      nextPageUrl: result.nextPageUrl,
      meta: { excludedCount: excluded.length, appliedAt: 'server', includeExcluded },
    };
  }

  // Conditions too complex to merge safely. Fetch raw, filter the
  // response client-side, count what we dropped.
  const result = await cwFetch<T[]>(ctx, path, params);
  const arr = Array.isArray(result.data) ? result.data : [];
  const excludedSet = new Set(excluded);
  let removed = 0;
  const kept = arr.filter((row) => {
    const id = extractIdFromRow(row, opts.resultIdPath);
    if (id != null && excludedSet.has(id)) {
      removed++;
      return false;
    }
    return true;
  });
  return {
    data: kept,
    linkHeader: result.linkHeader,
    nextPageUrl: result.nextPageUrl,
    meta: { excludedCount: removed, appliedAt: 'client', includeExcluded },
  };
}

/**
 * Re-export for composites that page beyond the first request — they
 * follow cwFetchNextPage; this just re-exports the helper so the
 * exclusion layer doesn't double-import client.js.
 */
export { cwFetchNextPage };
