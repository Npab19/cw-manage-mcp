import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { identityAllowsTool, type ResolvedIdentity } from './identity-resolver.js';

/**
 * Wraps an McpServer so that calls to .tool(name, ...) only register
 * tools the identity is permitted to call. Disallowed tools never enter
 * the server's internal registry, so tools/list omits them and
 * tools/call returns the SDK's standard "tool not found" error.
 *
 * Prompts (.prompt()) are untouched — they're admin-facing UX and
 * always exposed.
 */
export function gateServerWithPolicy(server: McpServer, identity: ResolvedIdentity | null): McpServer {
  return new Proxy(server, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (prop === 'tool' && typeof value === 'function') {
        return function (this: unknown, name: string, ...rest: unknown[]) {
          if (!identity) return; // no identity -> no tools
          if (!identityAllowsTool(identity, name)) return;
          return (value as (...args: unknown[]) => unknown).call(target, name, ...rest);
        };
      }
      return value;
    },
  });
}
