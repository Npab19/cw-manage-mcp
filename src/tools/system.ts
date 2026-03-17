import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { cwFetch, handleToolCall } from '../client.js';
import { CwRequestContext } from '../types.js';
import { addTool, Schema } from './helper.js';

const pag: Schema = {
  conditions: z.string().optional().describe('Filter expression, e.g. "identifier=\'jsmith\'"'),
  childConditions: z.string().optional().describe('Filter on child/array fields'),
  customFieldConditions: z.string().optional().describe('Filter on custom fields'),
  orderBy: z.string().optional().describe('Sort expression, e.g. "identifier asc"'),
  fields: z.string().optional().describe('Comma-separated field names to return'),
  page: z.number().int().min(1).optional().describe('Page number (starts at 1)'),
  pageSize: z.number().int().min(1).max(1000).optional().describe('Records per page (max 1000)'),
  pageId: z.number().int().optional().describe('Forward-only paging: start after this record ID'),
};

const listSchema: Schema = { ...pag };
const withMemberId: Schema = { id: z.number().int().describe('Member ID'), ...pag };
const byMemberId: Schema = { id: z.number().int().describe('Member ID'), fields: z.string().optional().describe('Fields to return') };

export function register(server: McpServer, ctx: CwRequestContext): void {
  addTool(server, 'get_members', 'List members (technicians/staff) in ConnectWise Manage.', listSchema,
    (args) => handleToolCall(ctx, (c) => cwFetch(c, '/system/members', args)));

  addTool(server, 'get_member_by_id', 'Retrieve a single member by their ID.', byMemberId,
    (args) => handleToolCall(ctx, (c) => cwFetch(c, `/system/members/${args.id}`, { fields: args.fields })));

  addTool(server, 'get_member_skills', 'List skills associated with a specific member.', withMemberId,
    (args) => handleToolCall(ctx, (c) => cwFetch(c, `/system/members/${args.id}/skills`, args)));

  addTool(server, 'get_departments', 'List organizational departments.', listSchema,
    (args) => handleToolCall(ctx, (c) => cwFetch(c, '/system/departments', args)));

  addTool(server, 'get_audit_trail', 'Retrieve the audit trail (activity log). Use conditions to filter by record type and ID.', listSchema,
    (args) => handleToolCall(ctx, (c) => cwFetch(c, '/system/auditTrail', args)));
}
