import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { cwFetch, handleToolCall } from '../client.js';
import { CwRequestContext } from '../types.js';
import { addTool, Schema, buildPaginationSchema, idSchema } from './helper.js';

const pag: Schema = buildPaginationSchema();

const listSchema: Schema = { ...pag };
const byEntryId: Schema = {
  id: idSchema('Expense entry ID'),
  fields: z.string().optional().describe('Fields to return'),
};

export function register(server: McpServer, ctx: CwRequestContext): void {
  addTool(
    server,
    'get_expense_entries',
    'List expense entries logged against tickets, projects, or members. Pass `conditions` to filter by member, date range, or charge-to entity. Pass `fields` to project only what you need.',
    listSchema,
    (args) => handleToolCall(ctx, (c) => cwFetch(c, '/expense/entries', args)),
  );

  addTool(
    server,
    'get_expense_entry_by_id',
    'Retrieve a single expense entry by its ID.',
    byEntryId,
    (args) =>
      handleToolCall(ctx, (c) => cwFetch(c, `/expense/entries/${args.id}`, { fields: args.fields })),
  );

  addTool(
    server,
    'get_expense_types',
    'List expense type definitions (mileage, lodging, meals, etc.).',
    listSchema,
    (args) => handleToolCall(ctx, (c) => cwFetch(c, '/expense/types', args)),
  );

  addTool(
    server,
    'get_expense_reports',
    'List expense reports (member-submitted groupings of expense entries).',
    listSchema,
    (args) => handleToolCall(ctx, (c) => cwFetch(c, '/expense/reports', args)),
  );
}
