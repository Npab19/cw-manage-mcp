import type { RequestHandler } from 'express';
import { getSql } from '../db.js';

interface McpRequestBody {
  method?: unknown;
  params?: { name?: unknown; arguments?: unknown };
}

function extractMcpToolName(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as McpRequestBody;
  if (b.method !== 'tools/call') return null;
  return typeof b.params?.name === 'string' ? b.params.name : null;
}

function extractMcpArgs(body: unknown): unknown {
  if (!body || typeof body !== 'object') return null;
  const b = body as McpRequestBody;
  if (b.method !== 'tools/call') return null;
  return b.params?.arguments ?? null;
}

export const auditCaptureMiddleware: RequestHandler = (req, res, next) => {
  if (!process.env.DATABASE_URL) {
    return next();
  }
  const startedAt = Date.now();
  res.on('finish', () => {
    const tool = extractMcpToolName((req as { body?: unknown }).body);
    if (!tool) return; // only audit tools/call requests
    const args = extractMcpArgs((req as { body?: unknown }).body);
    const durationMs = Date.now() - startedAt;
    const status = res.statusCode >= 200 && res.statusCode < 300 ? 'success' : 'error';
    const errorMessage = status === 'error' ? `HTTP ${res.statusCode}` : null;
    const requestId = req.requestId ?? null;
    const sub = req.oauth?.sub ?? null;
    const email = req.oauth?.email ?? null;
    const sql = getSql();
    sql`
      INSERT INTO mcp_audit_log (request_id, auth_sub, auth_email, tool, args, duration_ms, status, error_message)
      VALUES (${requestId}, ${sub}, ${email}, ${tool}, ${sql.json((args ?? null) as never)}, ${durationMs}, ${status}, ${errorMessage})
    `.catch((err: unknown) => {
      console.warn(
        `[audit] failed to record /mcp call (tool=${tool}): ${err instanceof Error ? err.message : String(err)}`,
      );
    });
  });
  next();
};
