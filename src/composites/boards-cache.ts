import { cwFetch } from '../client.js';
import { getCwConnection } from '../config.js';

export interface BoardSummary {
  id: number;
  name: string;
}

const CACHE_TTL_MS = 5 * 60 * 1000;
let cache: { boards: BoardSummary[]; expiresAt: number } | null = null;

/**
 * Fetches every CW board (paginated up to 1000/page, hard ceiling 10k).
 * Result cached for 5 minutes — boards rarely change and the admin
 * pages reload often during configuration.
 */
export async function getAllBoards(): Promise<BoardSummary[]> {
  if (cache && cache.expiresAt > Date.now()) return cache.boards;
  const conn = await getCwConnection();
  if (!conn || !conn.companyId || !conn.publicKey || !conn.privateKey) return [];
  try {
    const all: BoardSummary[] = [];
    let page = 1;
    while (page <= 10) {
      const result = await cwFetch<Array<{ id: number; name?: string }>>(conn, '/service/boards', {
        pageSize: 1000,
        page,
        fields: 'id,name',
      });
      const batch = Array.isArray(result.data) ? result.data : [];
      for (const b of batch) {
        if (typeof b.id === 'number' && typeof b.name === 'string') {
          all.push({ id: b.id, name: b.name });
        }
      }
      if (batch.length < 1000) break;
      page++;
    }
    all.sort((a, b) => a.name.localeCompare(b.name));
    cache = { boards: all, expiresAt: Date.now() + CACHE_TTL_MS };
    return all;
  } catch {
    return [];
  }
}

export function buildBoardNameMap(boards: BoardSummary[]): Map<number, string> {
  const m = new Map<number, string>();
  for (const b of boards) m.set(b.id, b.name);
  return m;
}

export function invalidateBoardsCache(): void {
  cache = null;
}
