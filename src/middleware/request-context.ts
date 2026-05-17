import { randomUUID } from 'crypto';
import type { RequestHandler } from 'express';

function extractMcpToolName(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as { method?: unknown; params?: { name?: unknown } };
  if (b.method !== 'tools/call') return null;
  return typeof b.params?.name === 'string' ? b.params.name : null;
}

export const requestContextMiddleware: RequestHandler = (req, res, next) => {
  const requestId = randomUUID();
  req.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);

  const startedAt = Date.now();
  res.on('finish', () => {
    const durationMs = Date.now() - startedAt;
    const line = {
      ts: new Date().toISOString(),
      requestId,
      method: req.method,
      path: req.path,
      tool: extractMcpToolName((req as { body?: unknown }).body),
      status: res.statusCode,
      durationMs,
      authSub: req.oauth?.sub ?? null,
      authEmail: req.oauth?.email ?? null,
    };
    console.log(JSON.stringify(line));
  });

  next();
};
