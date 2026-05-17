import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { cwFetch, handleToolCall } from '../client.js';
import { CwRequestContext } from '../types.js';
import { addTool, Schema, buildPaginationSchema, idSchema } from './helper.js';

const pag: Schema = buildPaginationSchema();

const listSchema: Schema = { ...pag };
const byCallbackId: Schema = {
  id: idSchema('Callback ID'),
  fields: z.string().optional().describe('Fields to return'),
};

export function register(server: McpServer, ctx: CwRequestContext): void {
  addTool(
    server,
    'get_callbacks',
    'List registered webhook callbacks (event subscriptions). Pass `conditions` to filter by type, level, or owner.',
    listSchema,
    (args) => handleToolCall(ctx, (c) => cwFetch(c, '/system/callbacks', args)),
  );

  addTool(
    server,
    'get_callback_by_id',
    'Retrieve a single webhook callback registration by its ID.',
    byCallbackId,
    (args) =>
      handleToolCall(ctx, (c) =>
        cwFetch(c, `/system/callbacks/${args.id}`, { fields: args.fields }),
      ),
  );
}
