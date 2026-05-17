import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { cwFetch, handleToolCall } from '../client.js';
import { CwRequestContext } from '../types.js';
import { addTool, Schema, buildPaginationSchema } from './helper.js';

const pag: Schema = buildPaginationSchema();

const listSchema: Schema = { ...pag };

export function register(server: McpServer, ctx: CwRequestContext): void {
  addTool(
    server,
    'get_marketing_campaigns',
    'List marketing campaigns. Pass `conditions` to filter by status, type, or date range. Pass `fields` to project.',
    listSchema,
    (args) => handleToolCall(ctx, (c) => cwFetch(c, '/marketing/campaigns', args)),
  );

  addTool(
    server,
    'get_marketing_groups',
    'List marketing groups (audience segments used by campaigns).',
    listSchema,
    (args) => handleToolCall(ctx, (c) => cwFetch(c, '/marketing/groups', args)),
  );
}
