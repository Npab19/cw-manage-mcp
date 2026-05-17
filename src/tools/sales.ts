import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { cwFetch, handleToolCall } from '../client.js';
import { CwRequestContext } from '../types.js';
import { addTool, Schema, buildPaginationSchema, idSchema } from './helper.js';

const pag: Schema = buildPaginationSchema('opportunity');

const listSchema: Schema = { ...pag };
const withOpportunityId: Schema = { id: idSchema('Opportunity ID'), ...pag };
const byOpportunityId: Schema = { id: idSchema('Opportunity ID'), fields: z.string().optional().describe('Fields to return') };

export function register(server: McpServer, ctx: CwRequestContext): void {
  addTool(server, 'get_opportunities', 'List sales opportunities in ConnectWise Manage.', listSchema,
    (args) => handleToolCall(ctx, (c) => cwFetch(c, '/sales/opportunities', args)));

  addTool(server, 'get_opportunity_by_id', 'Retrieve a single sales opportunity by its ID.', byOpportunityId,
    (args) => handleToolCall(ctx, (c) => cwFetch(c, `/sales/opportunities/${args.id}`, { fields: args.fields })));

  addTool(server, 'get_opportunity_forecast', 'Retrieve forecast line items for a specific opportunity.', withOpportunityId,
    (args) => handleToolCall(ctx, (c) => cwFetch(c, `/sales/opportunities/${args.id}/forecast`, args)));

  addTool(server, 'get_opportunity_notes', 'List notes on a specific opportunity.', withOpportunityId,
    (args) => handleToolCall(ctx, (c) => cwFetch(c, `/sales/opportunities/${args.id}/notes`, args)));

  addTool(server, 'get_sales_activities', 'List sales activities (calls, emails, follow-ups) in ConnectWise Manage.', listSchema,
    (args) => handleToolCall(ctx, (c) => cwFetch(c, '/sales/activities', args)));
}
