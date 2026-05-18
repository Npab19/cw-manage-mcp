import type { RequestHandler } from 'express';
import { getSql } from '../db.js';
import { getAllBoards, buildBoardNameMap } from '../composites/boards-cache.js';

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
    const [aliases, deprecated, boards] = await Promise.all([
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
      getAllBoards(),
    ]);
    const boardNames = buildBoardNameMap(boards);
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
      boards,
      boardNames,
      flash: typeof req.query.flash === 'string' ? req.query.flash : null,
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
