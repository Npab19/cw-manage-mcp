import pLimit from 'p-limit';
import { buildAuthHeaders } from './auth.js';
import { CwRequestContext, PaginationParams, ToolResult } from './types.js';
import { recordCwTiming, recordConcurrency } from './metrics.js';

const CW_TIMEOUT_MS = 180_000;
const CW_CONCURRENCY = 10;
const FIVE_XX_RETRY_DELAY_MS = 1_000;

const limit = pLimit(CW_CONCURRENCY);

export function getCwConcurrencyStats(): { active: number; pending: number; limit: number } {
  return { active: limit.activeCount, pending: limit.pendingCount, limit: CW_CONCURRENCY };
}

function buildUrl(ctx: CwRequestContext, path: string, params: PaginationParams): string {
  const baseUrl = ctx.baseUrl.replace(/\/$/, '');
  const codebase = ctx.codebase;
  const url = new URL(`${baseUrl}/${codebase}/apis/3.0${path}`);

  if (params.conditions) url.searchParams.set('conditions', params.conditions);
  if (params.childConditions) url.searchParams.set('childConditions', params.childConditions);
  if (params.customFieldConditions)
    url.searchParams.set('customFieldConditions', params.customFieldConditions);
  if (params.orderBy) url.searchParams.set('orderBy', params.orderBy);
  if (params.fields) url.searchParams.set('fields', params.fields);
  if (params.page !== undefined) url.searchParams.set('page', String(params.page));
  if (params.pageSize !== undefined) url.searchParams.set('pageSize', String(params.pageSize));
  if (params.pageId !== undefined) url.searchParams.set('pageId', String(params.pageId));

  return url.toString();
}

function parseNextPageUrl(linkHeader: string | undefined): string | undefined {
  if (!linkHeader) return undefined;
  for (const segment of linkHeader.split(',')) {
    const match = /<([^>]+)>\s*;\s*rel\s*=\s*"?next"?/i.exec(segment.trim());
    if (match) return match[1];
  }
  return undefined;
}

function parseRetryAfterMs(headerValue: string | null): number | null {
  if (!headerValue) return null;
  const asNumber = Number(headerValue);
  if (!Number.isNaN(asNumber) && asNumber >= 0) return Math.floor(asNumber * 1_000);
  const asDate = Date.parse(headerValue);
  if (!Number.isNaN(asDate)) return Math.max(0, asDate - Date.now());
  return null;
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchOnce(url: string, headers: Record<string, string>): Promise<Response> {
  try {
    return await fetchWithTimeout(url, { method: 'GET', headers }, CW_TIMEOUT_MS);
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`ConnectWise call timed out after ${CW_TIMEOUT_MS / 1000}s for ${url}`);
    }
    throw err;
  }
}

async function fetchWithRetry(url: string, headers: Record<string, string>): Promise<Response> {
  const first = await fetchOnce(url, headers);
  if (first.ok) return first;
  const isRetryable = first.status === 429 || (first.status >= 500 && first.status < 600);
  if (!isRetryable) return first;

  let delayMs: number;
  if (first.status === 429) {
    const retryAfter = parseRetryAfterMs(first.headers.get('Retry-After'));
    delayMs = retryAfter ?? FIVE_XX_RETRY_DELAY_MS;
  } else {
    delayMs = FIVE_XX_RETRY_DELAY_MS;
  }
  await new Promise((resolve) => setTimeout(resolve, delayMs));

  return await fetchOnce(url, headers);
}

/**
 * Core fetch wrapper for all ConnectWise Manage API calls.
 * - 180s abort timeout; aborted requests surface a clear timeout error.
 * - One retry on 429 (honoring Retry-After) and on 5xx (1s linear backoff).
 * - Module-scoped concurrency limiter (max 10 in-flight CW calls process-wide).
 * - 401/403: clear permission error. 404: not-found. Other: forwards CW status + body.
 * - Returns `nextPageUrl` parsed from the `Link: <...>; rel="next"` header when present.
 */
export async function cwFetch<T = unknown>(
  ctx: CwRequestContext,
  path: string,
  params: PaginationParams = {}
): Promise<{ data: T; linkHeader?: string; nextPageUrl?: string }> {
  const url = buildUrl(ctx, path, params);
  const headers = buildAuthHeaders(ctx);

  const response = await limit(() => {
    recordConcurrency(limit.activeCount);
    const startedAt = Date.now();
    return fetchWithRetry(url, headers).finally(() => recordCwTiming(Date.now() - startedAt));
  });

  if (!response.ok) {
    const body = await response.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      parsed = body;
    }

    if (response.status === 401 || response.status === 403) {
      throw new Error(
        `ConnectWise returned ${response.status} for ${path}. ` +
          `The provided credentials do not have permission to access this resource. ` +
          `Check the member's security role in ConnectWise Manage.`
      );
    }

    if (response.status === 404) {
      throw new Error(
        `ConnectWise returned 404 for ${path}. The requested record was not found.`
      );
    }

    if (response.status === 429) {
      const retryAfter = response.headers.get('Retry-After') ?? 'unknown';
      throw new Error(
        `ConnectWise rate limit exceeded (HTTP 429) after retry. Please retry after ${retryAfter} second(s).`
      );
    }

    throw new Error(`ConnectWise API error (HTTP ${response.status}): ${JSON.stringify(parsed)}`);
  }

  const linkHeader = response.headers.get('Link') ?? undefined;
  const nextPageUrl = parseNextPageUrl(linkHeader);
  const data = (await response.json()) as T;

  return { data, linkHeader, nextPageUrl };
}

/**
 * Fetches the next page from a parsed `Link: rel="next"` URL produced by cwFetch.
 * Used by composite reporting tools to walk pagination until exhausted.
 */
export async function cwFetchNextPage<T = unknown>(
  ctx: CwRequestContext,
  nextPageUrl: string
): Promise<{ data: T; linkHeader?: string; nextPageUrl?: string }> {
  const headers = buildAuthHeaders(ctx);
  const response = await limit(() => {
    recordConcurrency(limit.activeCount);
    const startedAt = Date.now();
    return fetchWithRetry(nextPageUrl, headers).finally(() =>
      recordCwTiming(Date.now() - startedAt),
    );
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`ConnectWise pagination follow-up failed (HTTP ${response.status}): ${body}`);
  }
  const linkHeader = response.headers.get('Link') ?? undefined;
  const next = parseNextPageUrl(linkHeader);
  const data = (await response.json()) as T;
  return { data, linkHeader, nextPageUrl: next };
}

/**
 * Standard tool handler wrapper: calls handler with a CW context, returns MCP tool result.
 */
export async function handleToolCall(
  ctx: CwRequestContext,
  handler: (ctx: CwRequestContext) => Promise<unknown>
): Promise<ToolResult> {
  try {
    const result = await handler(ctx);
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: 'text', text: message }],
      isError: true,
    };
  }
}
