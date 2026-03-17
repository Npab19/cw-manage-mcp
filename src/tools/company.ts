import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { cwFetch, handleToolCall } from '../client.js';
import { CwRequestContext } from '../types.js';
import { addTool, Schema } from './helper.js';

const pag: Schema = {
  conditions: z.string().optional().describe('Filter expression'),
  childConditions: z.string().optional().describe('Filter on child/array fields'),
  customFieldConditions: z.string().optional().describe('Filter on custom fields'),
  orderBy: z.string().optional().describe('Sort expression, e.g. "name asc"'),
  fields: z.string().optional().describe('Comma-separated field names to return'),
  page: z.number().int().min(1).optional().describe('Page number (starts at 1)'),
  pageSize: z.number().int().min(1).max(1000).optional().describe('Records per page (max 1000)'),
  pageId: z.number().int().optional().describe('Forward-only paging: start after this record ID'),
};

const listSchema: Schema = { ...pag };
const withCompanyId: Schema = { id: z.number().int().describe('Company ID'), ...pag };
const withContactId: Schema = { id: z.number().int().describe('Contact ID'), ...pag };
const byCompanyId: Schema = { id: z.number().int().describe('Company ID'), fields: z.string().optional().describe('Fields to return') };
const byContactId: Schema = { id: z.number().int().describe('Contact ID'), fields: z.string().optional().describe('Fields to return') };
const byConfigId: Schema = { id: z.number().int().describe('Configuration ID'), fields: z.string().optional().describe('Fields to return') };

export function register(server: McpServer, ctx: CwRequestContext): void {
  addTool(server, 'get_companies', 'List companies in ConnectWise Manage.', listSchema,
    (args) => handleToolCall(ctx, (c) => cwFetch(c, '/company/companies', args)));

  addTool(server, 'get_company_by_id', 'Retrieve a single company by its ID.', byCompanyId,
    (args) => handleToolCall(ctx, (c) => cwFetch(c, `/company/companies/${args.id}`, { fields: args.fields })));

  addTool(server, 'get_company_sites', 'List sites associated with a specific company.', withCompanyId,
    (args) => handleToolCall(ctx, (c) => cwFetch(c, `/company/companies/${args.id}/sites`, args)));

  addTool(server, 'get_company_notes', 'List notes on a specific company.', withCompanyId,
    (args) => handleToolCall(ctx, (c) => cwFetch(c, `/company/companies/${args.id}/notes`, args)));

  addTool(server, 'get_contacts', 'List contacts in ConnectWise Manage.', listSchema,
    (args) => handleToolCall(ctx, (c) => cwFetch(c, '/company/contacts', args)));

  addTool(server, 'get_contact_by_id', 'Retrieve a single contact by their ID.', byContactId,
    (args) => handleToolCall(ctx, (c) => cwFetch(c, `/company/contacts/${args.id}`, { fields: args.fields })));

  addTool(server, 'get_contact_communications', 'List communication records (email, phone, etc.) for a specific contact.', withContactId,
    (args) => handleToolCall(ctx, (c) => cwFetch(c, `/company/contacts/${args.id}/communications`, args)));

  addTool(server, 'get_contact_notes', 'List notes on a specific contact.', withContactId,
    (args) => handleToolCall(ctx, (c) => cwFetch(c, `/company/contacts/${args.id}/notes`, args)));

  addTool(server, 'get_company_configurations', 'List company configurations (managed devices, assets).', listSchema,
    (args) => handleToolCall(ctx, (c) => cwFetch(c, '/company/configurations', args)));

  addTool(server, 'get_company_configuration_by_id', 'Retrieve a single company configuration by its ID.', byConfigId,
    (args) => handleToolCall(ctx, (c) => cwFetch(c, `/company/configurations/${args.id}`, { fields: args.fields })));
}
