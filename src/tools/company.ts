import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { cwFetch, handleToolCall } from '../client.js';
import { CwRequestContext } from '../types.js';
import { addTool, Schema, buildPaginationSchema, idSchema } from './helper.js';
import { cwFetchListWithExclusions } from '../composites/company-exclusions.js';

const pag: Schema = buildPaginationSchema('company');

const includeExcludedField = {
  include_excluded: z
    .boolean()
    .optional()
    .describe('When true, include companies on the global exclusion list. Default false.'),
};
const listSchema: Schema = { ...pag, ...includeExcludedField };
const listSchemaNoExclusion: Schema = { ...pag };
const withCompanyId: Schema = { id: idSchema('Company ID'), ...pag };
const withContactId: Schema = { id: idSchema('Contact ID'), ...pag };
const byCompanyId: Schema = { id: idSchema('Company ID'), fields: z.string().optional().describe('Fields to return') };
const byContactId: Schema = { id: idSchema('Contact ID'), fields: z.string().optional().describe('Fields to return') };
const byConfigId: Schema = { id: idSchema('Configuration ID'), fields: z.string().optional().describe('Fields to return') };

export function register(server: McpServer, ctx: CwRequestContext): void {
  addTool(server, 'get_companies', 'Default tool for company-lookup questions. Always pass `conditions` to filter — this can return thousands of records. Pass `fields="id,name,..."` to project only what you need. Globally-excluded companies are hidden by default; pass `include_excluded: true` to override.', listSchema,
    (args) => handleToolCall(ctx, (c) => cwFetchListWithExclusions(c, '/company/companies', args, { conditionsField: 'id', resultIdPath: 'id' })));

  addTool(server, 'get_company_by_id', 'Retrieve a single company by its ID.', byCompanyId,
    (args) => handleToolCall(ctx, (c) => cwFetch(c, `/company/companies/${args.id}`, { fields: args.fields })));

  addTool(server, 'get_company_sites', 'List sites associated with a specific company.', withCompanyId,
    (args) => handleToolCall(ctx, (c) => cwFetch(c, `/company/companies/${args.id}/sites`, args)));

  addTool(server, 'get_company_notes', 'List notes on a specific company.', withCompanyId,
    (args) => handleToolCall(ctx, (c) => cwFetch(c, `/company/companies/${args.id}/notes`, args)));

  addTool(server, 'get_contacts', 'Default tool for contact-lookup questions. Always pass `conditions` to filter — this can return thousands of records. Pass `fields="id,firstName,lastName,..."` to project only what you need.', listSchemaNoExclusion,
    (args) => handleToolCall(ctx, (c) => cwFetch(c, '/company/contacts', args)));

  addTool(server, 'get_contact_by_id', 'Retrieve a single contact by their ID.', byContactId,
    (args) => handleToolCall(ctx, (c) => cwFetch(c, `/company/contacts/${args.id}`, { fields: args.fields })));

  addTool(server, 'get_contact_communications', 'List communication records (email, phone, etc.) for a specific contact.', withContactId,
    (args) => handleToolCall(ctx, (c) => cwFetch(c, `/company/contacts/${args.id}/communications`, args)));

  addTool(server, 'get_contact_notes', 'List notes on a specific contact.', withContactId,
    (args) => handleToolCall(ctx, (c) => cwFetch(c, `/company/contacts/${args.id}/notes`, args)));

  addTool(server, 'get_company_configurations', 'List company configurations (managed devices, assets). Always pass `conditions` to filter — this can return thousands of records. Pass `fields` to project only what you need.', listSchemaNoExclusion,
    (args) => handleToolCall(ctx, (c) => cwFetch(c, '/company/configurations', args)));

  addTool(server, 'get_company_configuration_by_id', 'Retrieve a single company configuration by its ID.', byConfigId,
    (args) => handleToolCall(ctx, (c) => cwFetch(c, `/company/configurations/${args.id}`, { fields: args.fields })));
}
