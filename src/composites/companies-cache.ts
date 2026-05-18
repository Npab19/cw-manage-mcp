import { cwFetch } from '../client.js';
import { getCwConnection } from '../config.js';

export interface CompanySummary {
  id: number;
  name: string;
  identifier: string;
}

const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_COMPANIES = 5000;
const PAGE_SIZE = 1000;

let cache: { companies: CompanySummary[]; truncated: boolean; expiresAt: number } | null = null;

/**
 * Fetches every active CW company up to MAX_COMPANIES, paginated 1000
 * per page. Cached for 5 minutes. Sorted by name. The picker UI on
 * /admin/exclusions loads from this — most tenants have a few thousand
 * companies, well under the cap.
 */
export async function getActiveCompanies(): Promise<{ companies: CompanySummary[]; truncated: boolean }> {
  if (cache && cache.expiresAt > Date.now()) {
    return { companies: cache.companies, truncated: cache.truncated };
  }
  const conn = await getCwConnection();
  if (!conn || !conn.companyId || !conn.publicKey || !conn.privateKey) {
    return { companies: [], truncated: false };
  }
  try {
    const all: CompanySummary[] = [];
    let page = 1;
    let truncated = false;
    while (all.length < MAX_COMPANIES) {
      const result = await cwFetch<Array<{ id?: number; name?: string; identifier?: string }>>(
        conn,
        '/company/companies',
        {
          pageSize: PAGE_SIZE,
          page,
          conditions: "status/name='Active'",
          fields: 'id,name,identifier',
        },
      );
      const batch = Array.isArray(result.data) ? result.data : [];
      for (const c of batch) {
        if (typeof c.id === 'number' && typeof c.name === 'string') {
          all.push({ id: c.id, name: c.name, identifier: c.identifier ?? '' });
          if (all.length >= MAX_COMPANIES) {
            truncated = true;
            break;
          }
        }
      }
      if (batch.length < PAGE_SIZE) break;
      page++;
    }
    all.sort((a, b) => a.name.localeCompare(b.name));
    cache = { companies: all, truncated, expiresAt: Date.now() + CACHE_TTL_MS };
    return { companies: all, truncated };
  } catch {
    return { companies: [], truncated: false };
  }
}

export function invalidateCompaniesCache(): void {
  cache = null;
}
