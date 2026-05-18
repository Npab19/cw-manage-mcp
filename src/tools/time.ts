import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { cwFetch, handleToolCall } from '../client.js';
import { CwRequestContext } from '../types.js';
import { addTool, Schema, buildPaginationSchema, idSchema } from './helper.js';
import { cwFetchListWithExclusions } from '../composites/company-exclusions.js';
import { cachedCwFetch } from '../cache/static-lookups.js';

const pag: Schema = buildPaginationSchema('time-entry');

const listSchema: Schema = { ...pag };
const timeEntryListSchema: Schema = {
  ...pag,
  include_excluded: z
    .boolean()
    .optional()
    .describe('When true, include time entries for globally-excluded companies. Default false.'),
};
const byEntryId: Schema = { id: idSchema('Time entry ID'), fields: z.string().optional().describe('Fields to return') };
const bySheetId: Schema = { id: idSchema('Timesheet ID'), fields: z.string().optional().describe('Fields to return') };

export function register(server: McpServer, ctx: CwRequestContext): void {
  addTool(server, 'get_time_entries', 'Default tool for time-entry questions. Always pass `conditions` to filter (member, date range, ticket) — this can return thousands of records. Example: `member/identifier=\'jsmith\' and timeStart>[2024-01-01T00:00:00Z]`. Pass `fields` to project only what you need. Time entries for globally-excluded companies are hidden by default; pass `include_excluded: true` to override.', timeEntryListSchema,
    (args) => handleToolCall(ctx, (c) => cwFetchListWithExclusions(c, '/time/entries', args, { conditionsField: 'company/id', resultIdPath: 'company.id' })));

  addTool(server, 'get_time_entry_by_id', 'Retrieve a single time entry by its ID.', byEntryId,
    (args) => handleToolCall(ctx, (c) => cwFetch(c, `/time/entries/${args.id}`, { fields: args.fields })));

  addTool(server, 'get_time_sheets', 'List timesheets (weekly time period records) for members.', listSchema,
    (args) => handleToolCall(ctx, (c) => cwFetch(c, '/time/sheets', args)));

  addTool(server, 'get_time_sheet_by_id', 'Retrieve a single timesheet by its ID.', bySheetId,
    (args) => handleToolCall(ctx, (c) => cwFetch(c, `/time/sheets/${args.id}`, { fields: args.fields })));

  addTool(server, 'get_work_roles', 'List work roles (billing rate categories for time entries).', listSchema,
    (args) => handleToolCall(ctx, (c) => cachedCwFetch(c, '/time/workRoles', args)));

  addTool(server, 'get_work_types', 'List work types (e.g. Regular, Overtime) used to classify time entries.', listSchema,
    (args) => handleToolCall(ctx, (c) => cachedCwFetch(c, '/time/workTypes', args)));

  addTool(server, 'get_charge_codes', 'List charge codes used to categorize time entries.', listSchema,
    (args) => handleToolCall(ctx, (c) => cachedCwFetch(c, '/time/chargeCodes', args)));
}
