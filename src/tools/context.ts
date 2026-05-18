import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ResolvedIdentity } from '../middleware/identity-resolver.js';
import { composeMergedContext } from '../resources/context.js';
import { addTool } from './helper.js';

/**
 * Registers a get_context tool that returns the caller's merged context
 * document. Functionally equivalent to reading the context://current
 * MCP resource, but exposed as a tool so hosts that don't yet support
 * the MCP resources surface (Claude.ai's custom integration as of
 * 2026) can still pull domain context.
 *
 * Always registered ungated — every authenticated caller benefits from
 * org-specific context regardless of their tool allow-list.
 */
export function register(server: McpServer, identity: ResolvedIdentity | null): void {
  addTool(
    server,
    'get_context',
    'Returns the org-specific context for the current user: which boards are active vs deprecated, who is on the team, business rules, integration accounts to ignore from reports, query patterns, common misunderstandings. Composed per-caller from global, role-specific, and user-specific layers. Call this once at the start of a conversation to load domain context before reasoning about ConnectWise data.',
    {},
    async () => {
      const markdown = await composeMergedContext(identity);
      return { content: [{ type: 'text', text: markdown }] };
    },
  );
}
