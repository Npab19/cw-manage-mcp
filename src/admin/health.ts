import type { RequestHandler } from 'express';
import { getSql } from '../db.js';
import { getCacheStats } from '../cache.js';
import { getRateLimitStats } from '../middleware/rate-limit.js';
import { getCwTimingStats, getConcurrencyHighWater } from '../metrics.js';
import { getCwConcurrencyStats } from '../client.js';
import { lastUserImportRun } from '../import/cw-users.js';

interface ErrorRow {
  ts: Date;
  auth_email: string | null;
  tool: string | null;
  error_message: string | null;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatUptime(seconds: number): string {
  const s = Math.floor(seconds % 60);
  const m = Math.floor((seconds / 60) % 60);
  const h = Math.floor((seconds / 3600) % 24);
  const d = Math.floor(seconds / 86400);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export const healthGetHandler: RequestHandler = async (req, res, next) => {
  try {
    const partial = req.query.partial === '1';
    const sql = getSql();
    const recentErrors = await sql<ErrorRow[]>`
      SELECT ts, auth_email, tool, error_message
        FROM mcp_audit_log
       WHERE status = 'error'
       ORDER BY ts DESC
       LIMIT 20
    `;
    const lastImport = await lastUserImportRun();
    const mem = process.memoryUsage();

    const view = partial ? 'health-body' : 'health';
    res.render(view, {
      title: 'Health',
      admin: req.admin,
      layout: partial ? false : 'layout',
      proc: {
        uptime: formatUptime(process.uptime()),
        rss: formatBytes(mem.rss),
        heapUsed: formatBytes(mem.heapUsed),
        heapTotal: formatBytes(mem.heapTotal),
        nodeVersion: process.version,
      },
      cache: getCacheStats(),
      rateLimit: getRateLimitStats(),
      cwTimings: getCwTimingStats(),
      cwConcurrency: { ...getCwConcurrencyStats(), highWaterLastHour: getConcurrencyHighWater() },
      lastImport,
      recentErrors,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
};
