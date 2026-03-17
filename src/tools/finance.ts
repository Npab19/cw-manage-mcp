import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { cwFetch, handleToolCall } from '../client.js';
import { CwRequestContext } from '../types.js';
import { addTool, Schema } from './helper.js';

const pag: Schema = {
  conditions: z.string().optional().describe('Filter expression'),
  childConditions: z.string().optional().describe('Filter on child/array fields'),
  customFieldConditions: z.string().optional().describe('Filter on custom fields'),
  orderBy: z.string().optional().describe('Sort expression'),
  fields: z.string().optional().describe('Comma-separated field names to return'),
  page: z.number().int().min(1).optional().describe('Page number (starts at 1)'),
  pageSize: z.number().int().min(1).max(1000).optional().describe('Records per page (max 1000)'),
  pageId: z.number().int().optional().describe('Forward-only paging: start after this record ID'),
};

const listSchema: Schema = { ...pag };
const withAgreementId: Schema = { id: z.number().int().describe('Agreement ID'), ...pag };
const byAgreementId: Schema = { id: z.number().int().describe('Agreement ID'), fields: z.string().optional().describe('Fields to return') };

export function register(server: McpServer, ctx: CwRequestContext): void {
  addTool(server, 'get_agreements', 'List service/managed agreements in ConnectWise Manage.', listSchema,
    (args) => handleToolCall(ctx, (c) => cwFetch(c, '/finance/agreements', args)));

  addTool(server, 'get_agreement_by_id', 'Retrieve a single agreement by its ID.', byAgreementId,
    (args) => handleToolCall(ctx, (c) => cwFetch(c, `/finance/agreements/${args.id}`, { fields: args.fields })));

  addTool(server, 'get_agreement_additions', 'List additions (recurring line items) on a specific agreement.', withAgreementId,
    (args) => handleToolCall(ctx, (c) => cwFetch(c, `/finance/agreements/${args.id}/additions`, args)));

  addTool(server, 'get_agreement_adjustments', 'List adjustments on a specific agreement.', withAgreementId,
    (args) => handleToolCall(ctx, (c) => cwFetch(c, `/finance/agreements/${args.id}/adjustments`, args)));

  addTool(server, 'get_agreement_sites', 'List sites covered by a specific agreement.', withAgreementId,
    (args) => handleToolCall(ctx, (c) => cwFetch(c, `/finance/agreements/${args.id}/sites`, args)));

  addTool(server, 'get_agreement_recap', 'Retrieve the financial recap for agreements (billing/revenue summary).', listSchema,
    (args) => handleToolCall(ctx, (c) => cwFetch(c, '/finance/agreementRecap', args)));

  addTool(server, 'get_agreement_types', 'List agreement type definitions.', listSchema,
    (args) => handleToolCall(ctx, (c) => cwFetch(c, '/finance/agreementTypes', args)));
}
