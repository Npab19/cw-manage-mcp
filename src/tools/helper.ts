/**
 * Thin wrapper around McpServer.tool() that bypasses TypeScript's TS2589
 * "type instantiation too deep" error, which occurs when tool schemas are
 * composed from spread objects with many optional zod fields.
 *
 * The MCP SDK validates schemas at runtime correctly — this only suppresses
 * a TypeScript compile-time depth limitation, not actual type safety in handlers.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ToolResult } from '../types.js';

export type Schema = Record<string, z.ZodTypeAny>;

export function addTool(
  server: McpServer,
  name: string,
  description: string,
  schema: Schema,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: (args: Record<string, any>) => Promise<ToolResult>
): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (server as any).tool(name, description, schema, handler);
}
