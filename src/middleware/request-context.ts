import { randomUUID } from 'crypto';
import type { RequestHandler } from 'express';

/**
 * Assigns a UUID request ID, echoes it via X-Request-Id, and emits one
 * structured JSON log line per request on response finish.
 *
 * Phase 0 will replace this with a fuller logging story (Pino). The
 * shape of the log line is the same so the swap is mechanical.
 */
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
      status: res.statusCode,
      durationMs,
      authSub: req.oauth?.sub ?? null,
      authEmail: req.oauth?.email ?? null,
    };
    console.log(JSON.stringify(line));
  });

  next();
};
