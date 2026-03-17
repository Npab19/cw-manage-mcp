import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { cwFetch, handleToolCall } from '../client.js';
import { CwRequestContext } from '../types.js';
import { addTool, Schema } from './helper.js';

const pag: Schema = {
  conditions: z.string().optional().describe('Filter expression, e.g. "member/identifier=\'jsmith\'"'),
  childConditions: z.string().optional().describe('Filter on child/array fields'),
  customFieldConditions: z.string().optional().describe('Filter on custom fields'),
  orderBy: z.string().optional().describe('Sort expression, e.g. "timeStart desc"'),
  fields: z.string().optional().describe('Comma-separated field names to return'),
  page: z.number().int().min(1).optional().describe('Page number (starts at 1)'),
  pageSize: z.number().int().min(1).max(1000).optional().describe('Records per page (max 1000)'),
  pageId: z.number().int().optional().describe('Forward-only paging: start after this record ID'),
};

const listSchema: Schema = { ...pag };
const byEntryId: Schema = { id: z.number().int().describe('Time entry ID'), fields: z.string().optional().describe('Fields to return') };
const bySheetId: Schema = { id: z.number().int().describe('Timesheet ID'), fields: z.string().optional().describe('Fields to return') };

export function register(server: McpServer, ctx: CwRequestContext): void {
  addTool(server, 'get_time_entries', 'List time entries across all tickets and projects. Filter by member, date range, ticket, etc.', listSchema,
    (args) => handleToolCall(ctx, (c) => cwFetch(c, '/time/entries', args)));

  addTool(server, 'get_time_entry_by_id', 'Retrieve a single time entry by its ID.', byEntryId,
    (args) => handleToolCall(ctx, (c) => cwFetch(c, `/time/entries/${args.id}`, { fields: args.fields })));

  addTool(server, 'get_time_sheets', 'List timesheets (weekly time period records) for members.', listSchema,
    (args) => handleToolCall(ctx, (c) => cwFetch(c, '/time/sheets', args)));

  addTool(server, 'get_time_sheet_by_id', 'Retrieve a single timesheet by its ID.', bySheetId,
    (args) => handleToolCall(ctx, (c) => cwFetch(c, `/time/sheets/${args.id}`, { fields: args.fields })));

  addTool(server, 'get_work_roles', 'List work roles (billing rate categories for time entries).', listSchema,
    (args) => handleToolCall(ctx, (c) => cwFetch(c, '/time/workRoles', args)));

  addTool(server, 'get_work_types', 'List work types (e.g. Regular, Overtime) used to classify time entries.', listSchema,
    (args) => handleToolCall(ctx, (c) => cwFetch(c, '/time/workTypes', args)));

  addTool(server, 'get_charge_codes', 'List charge codes used to categorize time entries.', listSchema,
    (args) => handleToolCall(ctx, (c) => cwFetch(c, '/time/chargeCodes', args)));
}
