import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { cwFetch, handleToolCall } from '../client.js';
import { CwRequestContext } from '../types.js';
import { addTool, Schema } from './helper.js';

const pag: Schema = {
  conditions: z.string().optional().describe('Filter expression, e.g. "status/name=\'New\'"'),
  childConditions: z.string().optional().describe('Filter on child/array fields'),
  customFieldConditions: z.string().optional().describe('Filter on custom fields'),
  orderBy: z.string().optional().describe('Sort expression, e.g. "lastUpdated desc"'),
  fields: z.string().optional().describe('Comma-separated field names to return'),
  page: z.number().int().min(1).optional().describe('Page number (starts at 1)'),
  pageSize: z.number().int().min(1).max(1000).optional().describe('Records per page (max 1000)'),
  pageId: z.number().int().optional().describe('Forward-only paging: start after this record ID'),
};

const listSchema: Schema = { ...pag };
const withTicketId: Schema = { id: z.number().int().describe('Ticket ID'), ...pag };
const withBoardId: Schema = { id: z.number().int().describe('Board ID'), ...pag };
const byId: Schema = { id: z.number().int().describe('Ticket ID'), fields: z.string().optional().describe('Fields to return') };

export function register(server: McpServer, ctx: CwRequestContext): void {
  addTool(server, 'get_service_tickets', 'List service tickets (incidents) from ConnectWise Manage.', listSchema,
    (args) => handleToolCall(ctx, (c) => cwFetch(c, '/service/tickets', args)));

  addTool(server, 'get_service_ticket_by_id', 'Retrieve a single service ticket by its ID.', byId,
    (args) => handleToolCall(ctx, (c) => cwFetch(c, `/service/tickets/${args.id}`, { fields: args.fields })));

  addTool(server, 'get_service_ticket_notes', 'List notes on a specific service ticket.', withTicketId,
    (args) => handleToolCall(ctx, (c) => cwFetch(c, `/service/tickets/${args.id}/notes`, args)));

  addTool(server, 'get_service_ticket_time_entries', 'List time entries logged against a specific service ticket.', withTicketId,
    (args) => handleToolCall(ctx, (c) => cwFetch(c, `/service/tickets/${args.id}/timeentries`, args)));

  addTool(server, 'get_service_ticket_tasks', 'List tasks on a specific service ticket.', withTicketId,
    (args) => handleToolCall(ctx, (c) => cwFetch(c, `/service/tickets/${args.id}/tasks`, args)));

  addTool(server, 'get_service_boards', 'List service boards (queues) in ConnectWise Manage.', listSchema,
    (args) => handleToolCall(ctx, (c) => cwFetch(c, '/service/boards', args)));

  addTool(server, 'get_service_board_statuses', 'List statuses configured on a specific service board.', withBoardId,
    (args) => handleToolCall(ctx, (c) => cwFetch(c, `/service/boards/${args.id}/statuses`, args)));

  addTool(server, 'get_service_priorities', 'List ticket priority levels.', listSchema,
    (args) => handleToolCall(ctx, (c) => cwFetch(c, '/service/priorities', args)));

  addTool(server, 'get_service_slas', 'List Service Level Agreements (SLAs).', listSchema,
    (args) => handleToolCall(ctx, (c) => cwFetch(c, '/service/SLAs', args)));

  addTool(server, 'get_service_impacts', 'List ticket impact levels.', listSchema,
    (args) => handleToolCall(ctx, (c) => cwFetch(c, '/service/impacts', args)));
}
