import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { cwFetch, handleToolCall } from '../client.js';
import { CwRequestContext } from '../types.js';
import { addTool, Schema, buildPaginationSchema, idSchema } from './helper.js';
import { cwFetchListWithExclusions } from '../composites/company-exclusions.js';
import { cachedCwFetch } from '../cache/static-lookups.js';

const pag: Schema = buildPaginationSchema('agreement');

const listSchema: Schema = { ...pag };
const agreementListSchema: Schema = {
  ...pag,
  include_excluded: z
    .boolean()
    .optional()
    .describe('When true, include agreements for globally-excluded companies. Default false.'),
};
const withAgreementId: Schema = { id: idSchema('Agreement ID'), ...pag };
const byAgreementId: Schema = { id: idSchema('Agreement ID'), fields: z.string().optional().describe('Fields to return') };

export function register(server: McpServer, ctx: CwRequestContext): void {
  addTool(server, 'get_agreements', 'List service/managed agreements in ConnectWise Manage. Agreements for globally-excluded companies are hidden by default; pass `include_excluded: true` to override.', agreementListSchema,
    (args) => handleToolCall(ctx, (c) => cwFetchListWithExclusions(c, '/finance/agreements', args, { conditionsField: 'company/id', resultIdPath: 'company.id' })));

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
    (args) => handleToolCall(ctx, (c) => cachedCwFetch(c, '/finance/agreementTypes', args)));
}
