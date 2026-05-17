import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { cwFetch, handleToolCall } from '../client.js';
import { CwRequestContext } from '../types.js';
import { addTool, Schema, buildPaginationSchema, idSchema } from './helper.js';

const pag: Schema = buildPaginationSchema('schedule-entry');

const listSchema: Schema = { ...pag };
const byEntryId: Schema = { id: idSchema('Schedule entry ID'), fields: z.string().optional().describe('Fields to return') };

export function register(server: McpServer, ctx: CwRequestContext): void {
  addTool(server, 'get_schedule_entries', 'List schedule entries (calendar appointments, dispatch entries). Filter by member, date range, or ticket.', listSchema,
    (args) => handleToolCall(ctx, (c) => cwFetch(c, '/schedule/entries', args)));

  addTool(server, 'get_schedule_entry_by_id', 'Retrieve a single schedule entry by its ID.', byEntryId,
    (args) => handleToolCall(ctx, (c) => cwFetch(c, `/schedule/entries/${args.id}`, { fields: args.fields })));

  addTool(server, 'get_schedule_calendars', 'List resource calendars (work hour configurations for members).', listSchema,
    (args) => handleToolCall(ctx, (c) => cwFetch(c, '/schedule/calendars', args)));
}
