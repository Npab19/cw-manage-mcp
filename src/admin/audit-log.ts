import type { RequestHandler } from 'express';
import { getSql } from '../db.js';

interface AuditRow {
  id: string;
  ts: Date;
  request_id: string | null;
  auth_sub: string | null;
  auth_email: string | null;
  tool: string | null;
  args: unknown;
  duration_ms: number | null;
  status: 'success' | 'error';
  error_message: string | null;
}

const DEFAULT_PAGE_SIZE = 100;
const MAX_CSV_ROWS = 10_000;

interface Filters {
  from: string | null;
  to: string | null;
  email: string | null;
  tool: string | null;
  status: 'success' | 'error' | null;
  argsSearch: string | null;
}

function parseFilters(q: Record<string, string | undefined>): Filters {
  const status = q.status === 'success' || q.status === 'error' ? q.status : null;
  return {
    from: q.from?.trim() || null,
    to: q.to?.trim() || null,
    email: q.email?.trim() || null,
    tool: q.tool?.trim() || null,
    status,
    argsSearch: q.argsSearch?.trim() || null,
  };
}

function filterQueryString(filters: Filters): string {
  const params = new URLSearchParams();
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  if (filters.email) params.set('email', filters.email);
  if (filters.tool) params.set('tool', filters.tool);
  if (filters.status) params.set('status', filters.status);
  if (filters.argsSearch) params.set('argsSearch', filters.argsSearch);
  return params.toString();
}

async function distinctTools(): Promise<string[]> {
  const sql = getSql();
  const rows = await sql<{ tool: string }[]>`
    SELECT DISTINCT tool FROM mcp_audit_log WHERE tool IS NOT NULL ORDER BY tool ASC LIMIT 200
  `;
  return rows.map((r) => r.tool);
}

function buildWhere(
  sql: ReturnType<typeof getSql>,
  f: Filters,
  cursor?: { kind: 'before' | 'since'; ts: string },
) {
  const fragments: ReturnType<typeof sql>[] = [];
  if (f.from) fragments.push(sql`ts >= ${f.from}`);
  if (f.to) fragments.push(sql`ts <= ${f.to}`);
  if (f.email) fragments.push(sql`auth_email ILIKE ${'%' + f.email + '%'}`);
  if (f.tool) fragments.push(sql`tool = ${f.tool}`);
  if (f.status) fragments.push(sql`status = ${f.status}`);
  if (f.argsSearch) fragments.push(sql`args::text ILIKE ${'%' + f.argsSearch + '%'}`);
  if (cursor?.kind === 'before') fragments.push(sql`ts < ${cursor.ts}`);
  if (cursor?.kind === 'since') fragments.push(sql`ts > ${cursor.ts}`);
  const first = fragments[0];
  if (!first) return sql``;
  let combined = sql`WHERE ${first}`;
  for (let i = 1; i < fragments.length; i++) {
    const frag = fragments[i];
    if (!frag) continue;
    combined = sql`${combined} AND ${frag}`;
  }
  return combined;
}

export const auditLogGetHandler: RequestHandler = async (req, res, next) => {
  try {
    const q = req.query as Record<string, string | undefined>;
    const filters = parseFilters(q);
    const before = q.before?.trim() || null;
    const sql = getSql();
    const where = buildWhere(sql, filters, before ? { kind: 'before', ts: before } : undefined);
    const [rows, countRows, tools] = await Promise.all([
      sql<AuditRow[]>`
        SELECT id, ts, request_id, auth_sub, auth_email, tool, args, duration_ms, status, error_message
        FROM mcp_audit_log
        ${where}
        ORDER BY ts DESC
        LIMIT ${DEFAULT_PAGE_SIZE}
      `,
      sql<{ count: string }[]>`SELECT COUNT(*)::text AS count FROM mcp_audit_log ${buildWhere(sql, filters)}`,
      distinctTools(),
    ]);
    const total = parseInt(countRows[0]?.count ?? '0', 10);
    const oldestTs = rows.length > 0 ? rows[rows.length - 1]!.ts.toISOString() : null;
    const filterQs = filterQueryString(filters);

    res.render('audit-log', {
      title: 'MCP audit log',
      admin: req.admin,
      rows,
      filters,
      tools,
      total,
      pageSize: DEFAULT_PAGE_SIZE,
      oldestTs,
      filterQs,
      isCursorPage: !!before,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Partial endpoint used by htmx polling and "load older" actions.
 *   - since=<ISO>: rows newer than `since` (live-update polling).
 *   - before=<ISO>: rows older than `before` (load-older append).
 *   - neither: latest 100 (used as the polling no-cursor fallback).
 * Empty body when no rows match.
 */
export const auditLogRowsHandler: RequestHandler = async (req, res, next) => {
  try {
    const q = req.query as Record<string, string | undefined>;
    const filters = parseFilters(q);
    const since = q.since?.trim() || null;
    const before = q.before?.trim() || null;

    const sql = getSql();
    const cursor =
      since != null
        ? { kind: 'since' as const, ts: since }
        : before != null
          ? { kind: 'before' as const, ts: before }
          : undefined;
    const where = buildWhere(sql, filters, cursor);
    const rows = await sql<AuditRow[]>`
      SELECT id, ts, request_id, auth_sub, auth_email, tool, args, duration_ms, status, error_message
      FROM mcp_audit_log
      ${where}
      ORDER BY ts DESC
      LIMIT ${DEFAULT_PAGE_SIZE}
    `;
    if (rows.length === 0) {
      res.type('html').send('');
      return;
    }
    res.render('_audit-log-rows', { rows, layout: false });
  } catch (err) {
    next(err);
  }
};

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = typeof value === 'string' ? value : JSON.stringify(value);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export const auditLogCsvHandler: RequestHandler = async (req, res, next) => {
  try {
    const filters = parseFilters(req.query as Record<string, string | undefined>);
    const sql = getSql();
    const where = buildWhere(sql, filters);
    const rows = await sql<AuditRow[]>`
      SELECT id, ts, request_id, auth_sub, auth_email, tool, args, duration_ms, status, error_message
      FROM mcp_audit_log
      ${where}
      ORDER BY ts DESC
      LIMIT ${MAX_CSV_ROWS}
    `;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="mcp-audit-log-${Date.now()}.csv"`);
    const header = [
      'id',
      'ts',
      'request_id',
      'auth_sub',
      'auth_email',
      'tool',
      'args',
      'duration_ms',
      'status',
      'error_message',
    ];
    res.write(header.join(',') + '\n');
    for (const r of rows) {
      const line = [
        r.id,
        r.ts.toISOString(),
        r.request_id,
        r.auth_sub,
        r.auth_email,
        r.tool,
        r.args,
        r.duration_ms,
        r.status,
        r.error_message,
      ].map(csvEscape).join(',');
      res.write(line + '\n');
    }
    res.end();
  } catch (err) {
    next(err);
  }
};
