import { getSql } from '../db.js';

export interface ResolvedBoardFilter {
  boardIds: number[];
  warnings: string[];
  aliasName: string | null;
  aliasDeprecated: boolean;
}

interface AliasRow {
  name: string;
  board_ids: number[];
  is_deprecated: boolean;
}

interface DeprecatedRow {
  board_id: number;
  reason: string | null;
  suggested_replacement_id: number | null;
}

async function lookupAlias(name: string): Promise<AliasRow | null> {
  const sql = getSql();
  const rows = await sql<AliasRow[]>`
    SELECT name, board_ids, is_deprecated
      FROM board_aliases
     WHERE LOWER(name) = ${name.toLowerCase()}
     LIMIT 1
  `;
  return rows[0] ?? null;
}

async function lookupDeprecated(boardIds: number[]): Promise<DeprecatedRow[]> {
  if (boardIds.length === 0) return [];
  const sql = getSql();
  return sql<DeprecatedRow[]>`
    SELECT board_id, reason, suggested_replacement_id
      FROM deprecated_boards
     WHERE board_id IN ${sql(boardIds)}
  `;
}

/**
 * Resolves a tool's board_filter argument into a concrete list of CW
 * board IDs plus any deprecation warnings to surface on the response.
 *
 * Accepted shapes:
 *   - undefined / null: returns null (caller falls back to "all boards")
 *   - string: alias name (case-insensitive) OR a numeric string (single ID)
 *   - number: single board ID
 *   - number[]: explicit list
 *
 * Unknown alias names throw — surface that to the caller as an error.
 */
export async function resolveBoardFilter(
  filter: string | number | number[] | undefined | null,
): Promise<ResolvedBoardFilter | null> {
  if (filter == null) return null;

  let boardIds: number[] = [];
  let aliasName: string | null = null;
  let aliasDeprecated = false;
  const warnings: string[] = [];

  if (Array.isArray(filter)) {
    boardIds = filter.filter((n) => Number.isInteger(n) && n > 0);
  } else if (typeof filter === 'number') {
    if (Number.isInteger(filter) && filter > 0) boardIds = [filter];
  } else if (typeof filter === 'string') {
    const trimmed = filter.trim();
    if (!trimmed) return null;
    const asNumber = Number(trimmed);
    if (Number.isInteger(asNumber) && asNumber > 0 && String(asNumber) === trimmed) {
      boardIds = [asNumber];
    } else {
      const alias = await lookupAlias(trimmed);
      if (!alias) {
        throw new Error(
          `Unknown board alias "${trimmed}". Pass a numeric board ID, a list of IDs, or a configured alias name.`,
        );
      }
      boardIds = alias.board_ids.filter((n) => Number.isInteger(n) && n > 0);
      aliasName = alias.name;
      aliasDeprecated = alias.is_deprecated;
      if (alias.is_deprecated) {
        warnings.push(`Alias "${alias.name}" is marked deprecated.`);
      }
    }
  }

  if (boardIds.length === 0) return null;

  const deprecated = await lookupDeprecated(boardIds);
  for (const d of deprecated) {
    const suggestion = d.suggested_replacement_id
      ? ` Did you mean board ${d.suggested_replacement_id}?`
      : '';
    const reason = d.reason ? ` (${d.reason})` : '';
    warnings.push(`Board ${d.board_id} is marked deprecated${reason}.${suggestion}`);
  }

  return { boardIds, warnings, aliasName, aliasDeprecated };
}

/**
 * Renders a CW conditions fragment for the resolved board IDs. Returns
 * an empty string if the list is empty.
 */
export function boardFilterCondition(boardIds: number[]): string {
  if (boardIds.length === 0) return '';
  if (boardIds.length === 1) return `board/id=${boardIds[0]}`;
  return `board/id in (${boardIds.join(',')})`;
}
