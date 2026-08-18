import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { identityAllowsTool, type ResolvedIdentity } from './identity-resolver.js';
import { composeMergedContext } from '../resources/context.js';
import { redactToolResponseText } from './field-projection.js';

const EMPTY_CONTEXT_MARKER = '_No context documents configured';
const CONTEXT_TTL_MS =
  Math.max(0, parseInt(process.env.CONTEXT_AUTO_INJECT_TTL_MIN ?? '10', 10) || 10) * 60 * 1000;
const lastContextInjection = new Map<string, number>();

function shouldInjectContext(identity: ResolvedIdentity, toolName: string): boolean {
  if (CONTEXT_TTL_MS <= 0) return false;
  if (toolName === 'get_context') return false;
  if (!identity.oauthSub) return false;
  const last = lastContextInjection.get(identity.oauthSub);
  return !(last && Date.now() - last < CONTEXT_TTL_MS);
}

interface ToolResult {
  content?: Array<{ type: string; text?: string; [k: string]: unknown }>;
  [k: string]: unknown;
}

function wrapHandlerWithFieldRedaction(
  handler: (...args: unknown[]) => Promise<ToolResult>,
  identity: ResolvedIdentity,
  toolName: string,
): (...args: unknown[]) => Promise<ToolResult> {
  return async (...args: unknown[]) => {
    const result = await handler(...args);
    if (!result?.content || !Array.isArray(result.content)) return result;
    const projections = identity.policy.fieldProjections[toolName];
    if (identity.isAdmin || identity.serviceAccount || !projections || projections.length === 0) {
      return result;
    }
    const next = result.content.map((entry) => {
      if (entry?.type === 'text' && typeof entry.text === 'string') {
        return { ...entry, text: redactToolResponseText(identity, toolName, entry.text) };
      }
      return entry;
    });
    return { ...result, content: next };
  };
}

function wrapHandlerWithContextInjection(
  handler: (...args: unknown[]) => Promise<ToolResult>,
  identity: ResolvedIdentity,
  toolName: string,
): (...args: unknown[]) => Promise<ToolResult> {
  return async (...args: unknown[]) => {
    const result = await handler(...args);
    if (!shouldInjectContext(identity, toolName)) return result;
    try {
      const context = await composeMergedContext(identity);
      if (context.includes(EMPTY_CONTEXT_MARKER)) return result;
      lastContextInjection.set(identity.oauthSub, Date.now());
      return {
        ...result,
        content: [
          {
            type: 'text',
            text:
              '[Auto-loaded org context — composed from global/role/user layers. Use this when interpreting tool results.]\n\n' +
              context,
          },
          ...(result.content ?? []),
        ],
      };
    } catch {
      return result; // best-effort: never fail a tool call because context injection broke
    }
  };
}

/**
 * Wraps a tool-registration method (.tool() or .registerTool()) so that it
 * (a) only registers tools the identity is permitted to call, and (b)
 * prepends the caller's merged context document to the first tool response
 * per identity per CONTEXT_AUTO_INJECT_TTL_MIN window (default 10 minutes;
 * set to 0 to disable). Disallowed tools never enter the server's internal
 * registry, so tools/list omits them and tools/call returns the SDK's
 * standard "tool not found" error.
 *
 * Both registration methods take the tool name first and the handler last
 * (.tool(name, description, schema, handler) vs .registerTool(name, config,
 * handler)), so the same wrapping logic covers both — this is what lets
 * MCP Apps tools (registered via registerAppTool -> server.registerTool)
 * inherit the same identity gating as every other tool.
 *
 * Why TTL-based: stateless HTTP transport gives us no native concept of
 * "conversation start", so we approximate by tracking per-OAuth-sub
 * last-injection time. First call within a fresh window prepends
 * context; subsequent calls don't (the AI already has it in window
 * from the first prepend). Cap and refresh interval are tunable via
 * env var.
 *
 * Prompts (.prompt()) are untouched. get_context itself is excluded
 * from the auto-inject wrapper since its whole purpose is returning
 * the same content.
 */
function gateRegistrationMethod(
  value: (...args: unknown[]) => unknown,
  target: McpServer,
  identity: ResolvedIdentity | null,
): (name: string, ...rest: unknown[]) => unknown {
  return function (name: string, ...rest: unknown[]) {
    if (!identity) return; // no identity -> no tools
    if (!identityAllowsTool(identity, name)) return;
    if (rest.length > 0) {
      const lastIdx = rest.length - 1;
      const handler = rest[lastIdx];
      if (typeof handler === 'function') {
        // Outer (called first) → inner (called last):
        //   context-injection → field-redaction → original handler.
        // Original handler runs first, redaction trims its response,
        // then context-injection prepends the org context entry.
        let wrapped = handler as (...args: unknown[]) => Promise<ToolResult>;
        wrapped = wrapHandlerWithFieldRedaction(wrapped, identity, name);
        wrapped = wrapHandlerWithContextInjection(wrapped, identity, name);
        rest[lastIdx] = wrapped;
      }
    }
    return value.call(target, name, ...rest);
  };
}

export function gateServerWithPolicy(server: McpServer, identity: ResolvedIdentity | null): McpServer {
  return new Proxy(server, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if ((prop === 'tool' || prop === 'registerTool') && typeof value === 'function') {
        return gateRegistrationMethod(value as (...args: unknown[]) => unknown, target, identity);
      }
      return value;
    },
  });
}
