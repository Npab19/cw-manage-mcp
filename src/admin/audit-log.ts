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

const PAGE_SIZE = 50;
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

async function distinctTools(): Promise<string[]> {
  const sql = getSql();
  const rows = await sql<{ tool: string }[]>`
    SELECT DISTINCT tool FROM mcp_audit_log WHERE tool IS NOT NULL ORDER BY tool ASC LIMIT 200
  `;
  return rows.map((r) => r.tool);
}

function buildWhere(sql: ReturnType<typeof getSql>, f: Filters) {
  const fragments: ReturnType<typeof sql>[] = [];
  if (f.from) fragments.push(sql`ts >= ${f.from}`);
  if (f.to) fragments.push(sql`ts <= ${f.to}`);
  if (f.email) fragments.push(sql`auth_email ILIKE ${'%' + f.email + '%'}`);
  if (f.tool) fragments.push(sql`tool = ${f.tool}`);
  if (f.status) fragments.push(sql`status = ${f.status}`);
  if (f.argsSearch) fragments.push(sql`args::text ILIKE ${'%' + f.argsSearch + '%'}`);
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
    const filters = parseFilters(req.query as Record<string, string | undefined>);
    const page = Math.max(1, parseInt((req.query.page as string) ?? '1', 10) || 1);
    const offset = (page - 1) * PAGE_SIZE;

    const sql = getSql();
    const where = buildWhere(sql, filters);
    const [rows, countRows, tools] = await Promise.all([
      sql<AuditRow[]>`
        SELECT id, ts, request_id, auth_sub, auth_email, tool, args, duration_ms, status, error_message
        FROM mcp_audit_log
        ${where}
        ORDER BY ts DESC
        LIMIT ${PAGE_SIZE} OFFSET ${offset}
      `,
      sql<{ count: string }[]>`SELECT COUNT(*)::text AS count FROM mcp_audit_log ${where}`,
      distinctTools(),
    ]);
    const total = parseInt(countRows[0]?.count ?? '0', 10);

    res.render('audit-log', {
      title: 'MCP audit log',
      admin: req.admin,
      rows,
      filters,
      tools,
      page,
      pageSize: PAGE_SIZE,
      total,
      totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
      qs: req.url.split('?')[1] ?? '',
    });
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
