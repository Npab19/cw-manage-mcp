import { buildAuthHeaders } from './auth.js';
import { CwRequestContext, PaginationParams, ToolResult } from './types.js';

function buildUrl(path: string, params: PaginationParams): string {
  const baseUrl = process.env.CW_BASE_URL!.replace(/\/$/, '');
  const codebase = process.env.CW_CODEBASE!;
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

/**
 * Core fetch wrapper for all ConnectWise Manage API calls.
 * - 401/403: surfaces a clear permission error to the caller (not a server error)
 * - 404: surfaces a not-found message
 * - 429: surfaces rate-limit info with Retry-After
 * - Other errors: forwards original CW status + body for debugging
 */
export async function cwFetch<T = unknown>(
  ctx: CwRequestContext,
  path: string,
  params: PaginationParams = {}
): Promise<{ data: T; linkHeader?: string }> {
  const url = buildUrl(path, params);
  const headers = buildAuthHeaders(ctx);

  const response = await fetch(url, { method: 'GET', headers });

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
        `ConnectWise rate limit exceeded (HTTP 429). Please retry after ${retryAfter} second(s).`
      );
    }

    throw new Error(`ConnectWise API error (HTTP ${response.status}): ${JSON.stringify(parsed)}`);
  }

  const linkHeader = response.headers.get('Link') ?? undefined;
  const data = (await response.json()) as T;

  return { data, linkHeader };
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
