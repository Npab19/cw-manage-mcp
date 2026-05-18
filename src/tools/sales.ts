import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { cwFetch, handleToolCall } from '../client.js';
import { CwRequestContext } from '../types.js';
import { addTool, Schema, buildPaginationSchema, idSchema } from './helper.js';
import { cwFetchListWithExclusions } from '../composites/company-exclusions.js';

const pag: Schema = buildPaginationSchema('opportunity');

const listSchema: Schema = { ...pag };
const opportunityListSchema: Schema = {
  ...pag,
  include_excluded: z
    .boolean()
    .optional()
    .describe('When true, include opportunities for globally-excluded companies. Default false.'),
};
const withOpportunityId: Schema = { id: idSchema('Opportunity ID'), ...pag };
const byOpportunityId: Schema = { id: idSchema('Opportunity ID'), fields: z.string().optional().describe('Fields to return') };

export function register(server: McpServer, ctx: CwRequestContext): void {
  addTool(server, 'get_opportunities', 'List sales opportunities in ConnectWise Manage. Opportunities for globally-excluded companies are hidden by default; pass `include_excluded: true` to override.', opportunityListSchema,
    (args) => handleToolCall(ctx, (c) => cwFetchListWithExclusions(c, '/sales/opportunities', args, { conditionsField: 'company/id', resultIdPath: 'company.id' })));

  addTool(server, 'get_opportunity_by_id', 'Retrieve a single sales opportunity by its ID.', byOpportunityId,
    (args) => handleToolCall(ctx, (c) => cwFetch(c, `/sales/opportunities/${args.id}`, { fields: args.fields })));

  addTool(server, 'get_opportunity_forecast', 'Retrieve forecast line items for a specific opportunity.', withOpportunityId,
    (args) => handleToolCall(ctx, (c) => cwFetch(c, `/sales/opportunities/${args.id}/forecast`, args)));

  addTool(server, 'get_opportunity_notes', 'List notes on a specific opportunity.', withOpportunityId,
    (args) => handleToolCall(ctx, (c) => cwFetch(c, `/sales/opportunities/${args.id}/notes`, args)));

  addTool(server, 'get_sales_activities', 'List sales activities (calls, emails, follow-ups) in ConnectWise Manage.', listSchema,
    (args) => handleToolCall(ctx, (c) => cwFetch(c, '/sales/activities', args)));
}
