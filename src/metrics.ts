/**
 * In-process metrics buffers consumed by the /admin/health page. Reset
 * on process restart by design — single-instance deployment per the
 * Foundational decisions.
 */

const TIMINGS_LIMIT = 500;
const timings: number[] = [];
let maxConcurrencyLastHour = 0;
let maxConcurrencySetAt = 0;

export function recordCwTiming(durationMs: number): void {
  if (!Number.isFinite(durationMs) || durationMs < 0) return;
  timings.push(durationMs);
  while (timings.length > TIMINGS_LIMIT) timings.shift();
}

export function getCwTimingStats(): {
  count: number;
  p50: number | null;
  p95: number | null;
  mean: number | null;
  max: number | null;
} {
  if (timings.length === 0) {
    return { count: 0, p50: null, p95: null, mean: null, max: null };
  }
  const sorted = [...timings].sort((a, b) => a - b);
  const at = (q: number) =>
    sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? null;
  const mean = sorted.reduce((s, x) => s + x, 0) / sorted.length;
  return {
    count: timings.length,
    p50: at(0.5),
    p95: at(0.95),
    mean: Math.round(mean),
    max: sorted[sorted.length - 1] ?? null,
  };
}

/**
 * Records a concurrency observation; the page surfaces the max seen in
 * the last hour. We don't keep a full ring buffer because we only need
 * the high-water mark.
 */
export function recordConcurrency(active: number): void {
  const now = Date.now();
  const oneHourAgo = now - 60 * 60 * 1000;
  if (maxConcurrencySetAt < oneHourAgo) {
    maxConcurrencyLastHour = active;
    maxConcurrencySetAt = now;
    return;
  }
  if (active > maxConcurrencyLastHour) {
    maxConcurrencyLastHour = active;
    maxConcurrencySetAt = now;
  }
}

export function getConcurrencyHighWater(): number {
  if (Date.now() - maxConcurrencySetAt > 60 * 60 * 1000) return 0;
  return maxConcurrencyLastHour;
}
