import type { RequestHandler } from 'express';
import { getSql } from '../db.js';

interface AliasRow {
  name: string;
  description: string | null;
  category: string | null;
  board_ids: number[];
  is_deprecated: boolean;
  created_by: string | null;
  updated_at: Date;
}

interface DeprecatedRow {
  board_id: number;
  reason: string | null;
  suggested_replacement_id: number | null;
  created_by: string | null;
  created_at: Date;
}

function parseBoardIds(raw: string | undefined): number[] {
  if (!raw) return [];
  return raw
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => Number(s))
    .filter((n) => Number.isInteger(n) && n > 0);
}

export const aliasesGetHandler: RequestHandler = async (req, res, next) => {
  try {
    const sql = getSql();
    const [aliases, deprecated] = await Promise.all([
      sql<AliasRow[]>`
        SELECT name, description, category, board_ids, is_deprecated, created_by, updated_at
          FROM board_aliases
         ORDER BY category NULLS LAST, is_deprecated ASC, name ASC
      `,
      sql<DeprecatedRow[]>`
        SELECT board_id, reason, suggested_replacement_id, created_by, created_at
          FROM deprecated_boards
         ORDER BY board_id ASC
      `,
    ]);
    // Group aliases by category for the rendered view.
    const byCategory = new Map<string, AliasRow[]>();
    for (const a of aliases) {
      const key = a.category ?? '';
      const bucket = byCategory.get(key) ?? [];
      bucket.push(a);
      byCategory.set(key, bucket);
    }
    const categorized = [...byCategory.entries()]
      .map(([category, rows]) => ({ category, rows }))
      .sort((a, b) => {
        if (a.category === '' && b.category !== '') return 1;
        if (b.category === '' && a.category !== '') return -1;
        return a.category.localeCompare(b.category);
      });
    res.render('aliases', {
      title: 'Board groups',
      admin: req.admin,
      aliases,
      categorized,
      deprecated,
      flash: typeof req.query.flash === 'string' ? req.query.flash : null,
      bulkResult: null,
    });
  } catch (err) {
    next(err);
  }
};

export const aliasCreateHandler: RequestHandler = async (req, res, next) => {
  try {
    const body = req.body as {
      name?: string;
      description?: string;
      category?: string;
      board_ids?: string;
      is_deprecated?: string;
    };
    const name = body.name?.trim();
    const boardIds = parseBoardIds(body.board_ids);
    if (!name || boardIds.length === 0) {
      res.redirect(302, '/admin/aliases?flash=alias-missing');
      return;
    }
    const sql = getSql();
    await sql`
      INSERT INTO board_aliases (name, description, category, board_ids, is_deprecated, created_by, updated_at)
      VALUES (
        ${name},
        ${body.description?.trim() || null},
        ${body.category?.trim() || null},
        ${boardIds},
        ${body.is_deprecated === 'on'},
        ${req.admin?.email ?? null},
        now()
      )
      ON CONFLICT (name) DO UPDATE SET
        description = EXCLUDED.description,
        category = EXCLUDED.category,
        board_ids = EXCLUDED.board_ids,
        is_deprecated = EXCLUDED.is_deprecated,
        updated_at = now()
    `;
    res.redirect(302, '/admin/aliases?flash=alias-saved');
  } catch (err) {
    next(err);
  }
};

interface BulkParseResult {
  rows: Array<{
    category: string | null;
    name: string;
    description: string | null;
    boardIds: number[];
  }>;
  errors: Array<{ line: number; raw: string; message: string }>;
}

// Minimal CSV parse — handles a single "quoted, with, commas" field per
// line. Format: category,name,description,board_ids
function parseBulkCsv(input: string): BulkParseResult {
  const result: BulkParseResult = { rows: [], errors: [] };
  const lines = input.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!.trim();
    if (!raw || raw.startsWith('#')) continue;
    if (i === 0 && /^category\s*,/i.test(raw)) continue; // optional header
    const fields = splitCsvLine(raw);
    if (fields.length < 4) {
      result.errors.push({ line: i + 1, raw, message: 'Expected 4 fields: category,name,description,board_ids' });
      continue;
    }
    const [category, name, description, boardIdsRaw] = fields;
    const ids = parseBoardIds(boardIdsRaw);
    if (!name?.trim()) {
      result.errors.push({ line: i + 1, raw, message: 'name is required' });
      continue;
    }
    if (ids.length === 0) {
      result.errors.push({ line: i + 1, raw, message: 'board_ids must list at least one positive integer' });
      continue;
    }
    result.rows.push({
      category: category?.trim() || null,
      name: name.trim(),
      description: description?.trim() || null,
      boardIds: ids,
    });
  }
  return result;
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let buf = '';
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (inQuote) {
      if (ch === '"' && line[i + 1] === '"') {
        buf += '"';
        i++;
      } else if (ch === '"') {
        inQuote = false;
      } else {
        buf += ch;
      }
    } else if (ch === '"') {
      inQuote = true;
    } else if (ch === ',') {
      out.push(buf);
      buf = '';
    } else {
      buf += ch;
    }
  }
  out.push(buf);
  return out;
}

export const aliasBulkHandler: RequestHandler = async (req, res, next) => {
  try {
    const body = req.body as { csv?: string };
    const csv = body.csv?.trim();
    if (!csv) {
      res.redirect(302, '/admin/aliases?flash=bulk-empty');
      return;
    }
    const parsed = parseBulkCsv(csv);
    if (parsed.rows.length === 0 && parsed.errors.length === 0) {
      res.redirect(302, '/admin/aliases?flash=bulk-empty');
      return;
    }
    const sql = getSql();
    let added = 0;
    let updated = 0;
    for (const row of parsed.rows) {
      const result = await sql<{ inserted: boolean }[]>`
        INSERT INTO board_aliases (name, description, category, board_ids, created_by, updated_at)
        VALUES (
          ${row.name},
          ${row.description},
          ${row.category},
          ${row.boardIds},
          ${req.admin?.email ?? null},
          now()
        )
        ON CONFLICT (name) DO UPDATE SET
          description = EXCLUDED.description,
          category = EXCLUDED.category,
          board_ids = EXCLUDED.board_ids,
          updated_at = now()
        RETURNING (xmax = 0) AS inserted
      `;
      if (result[0]?.inserted) added++;
      else updated++;
    }
    res.render('aliases', {
      title: 'Board groups',
      admin: req.admin,
      aliases: [],
      categorized: [],
      deprecated: [],
      flash: null,
      bulkResult: { added, updated, errors: parsed.errors, total: parsed.rows.length },
    });
  } catch (err) {
    next(err);
  }
};

export const aliasDeleteHandler: RequestHandler = async (req, res, next) => {
  try {
    const name = req.params.name;
    if (!name) {
      res.status(400).send('Missing alias name');
      return;
    }
    const sql = getSql();
    await sql`DELETE FROM board_aliases WHERE name = ${name}`;
    res.redirect(302, '/admin/aliases?flash=alias-deleted');
  } catch (err) {
    next(err);
  }
};

export const deprecatedBoardAddHandler: RequestHandler = async (req, res, next) => {
  try {
    const body = req.body as {
      board_id?: string;
      reason?: string;
      suggested_replacement_id?: string;
    };
    const boardId = Number(body.board_id?.trim());
    if (!Number.isInteger(boardId) || boardId <= 0) {
      res.redirect(302, '/admin/aliases?flash=deprecated-bad-id');
      return;
    }
    const suggested = body.suggested_replacement_id?.trim();
    const suggestedId = suggested ? Number(suggested) : null;
    const sql = getSql();
    await sql`
      INSERT INTO deprecated_boards (board_id, reason, suggested_replacement_id, created_by)
      VALUES (
        ${boardId},
        ${body.reason?.trim() || null},
        ${suggestedId && Number.isInteger(suggestedId) && suggestedId > 0 ? suggestedId : null},
        ${req.admin?.email ?? null}
      )
      ON CONFLICT (board_id) DO UPDATE SET
        reason = EXCLUDED.reason,
        suggested_replacement_id = EXCLUDED.suggested_replacement_id
    `;
    res.redirect(302, '/admin/aliases?flash=deprecated-saved');
  } catch (err) {
    next(err);
  }
};

export const deprecatedBoardDeleteHandler: RequestHandler = async (req, res, next) => {
  try {
    const boardId = Number(req.params.boardId);
    if (!Number.isInteger(boardId) || boardId <= 0) {
      res.status(400).send('Bad board ID');
      return;
    }
    const sql = getSql();
    await sql`DELETE FROM deprecated_boards WHERE board_id = ${boardId}`;
    res.redirect(302, '/admin/aliases?flash=deprecated-deleted');
  } catch (err) {
    next(err);
  }
};
