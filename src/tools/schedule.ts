import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { cwFetch, handleToolCall } from '../client.js';
import { CwRequestContext } from '../types.js';
import { addTool, Schema } from './helper.js';

const pag: Schema = {
  conditions: z.string().optional().describe('Filter expression, e.g. "dateStart>[2024-01-01T00:00:00Z]"'),
  childConditions: z.string().optional().describe('Filter on child/array fields'),
  customFieldConditions: z.string().optional().describe('Filter on custom fields'),
  orderBy: z.string().optional().describe('Sort expression, e.g. "dateStart asc"'),
  fields: z.string().optional().describe('Comma-separated field names to return'),
  page: z.number().int().min(1).optional().describe('Page number (starts at 1)'),
  pageSize: z.number().int().min(1).max(1000).optional().describe('Records per page (max 1000)'),
  pageId: z.number().int().optional().describe('Forward-only paging: start after this record ID'),
};

const listSchema: Schema = { ...pag };
const byEntryId: Schema = { id: z.number().int().describe('Schedule entry ID'), fields: z.string().optional().describe('Fields to return') };

export function register(server: McpServer, ctx: CwRequestContext): void {
  addTool(server, 'get_schedule_entries', 'List schedule entries (calendar appointments, dispatch entries). Filter by member, date range, or ticket.', listSchema,
    (args) => handleToolCall(ctx, (c) => cwFetch(c, '/schedule/entries', args)));

  addTool(server, 'get_schedule_entry_by_id', 'Retrieve a single schedule entry by its ID.', byEntryId,
    (args) => handleToolCall(ctx, (c) => cwFetch(c, `/schedule/entries/${args.id}`, { fields: args.fields })));

  addTool(server, 'get_schedule_calendars', 'List resource calendars (work hour configurations for members).', listSchema,
    (args) => handleToolCall(ctx, (c) => cwFetch(c, '/schedule/calendars', args)));
}
