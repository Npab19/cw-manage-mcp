import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { cwFetch, handleToolCall } from '../client.js';
import { CwRequestContext } from '../types.js';
import { addTool, Schema, buildPaginationSchema, idSchema } from './helper.js';
import { cwFetchListWithExclusions } from '../composites/company-exclusions.js';

const pag: Schema = buildPaginationSchema('project');

const listSchema: Schema = { ...pag };
const projectListSchema: Schema = {
  ...pag,
  include_excluded: z
    .boolean()
    .optional()
    .describe('When true, include projects for globally-excluded companies. Default false.'),
};
const withProjectId: Schema = { id: idSchema('Project ID'), ...pag };
const byProjectId: Schema = { id: idSchema('Project ID'), fields: z.string().optional().describe('Fields to return') };

export function register(server: McpServer, ctx: CwRequestContext): void {
  addTool(server, 'get_projects', 'List projects in ConnectWise Manage. Projects for globally-excluded companies are hidden by default; pass `include_excluded: true` to override.', projectListSchema,
    (args) => handleToolCall(ctx, (c) => cwFetchListWithExclusions(c, '/project/projects', args, { conditionsField: 'company/id', resultIdPath: 'company.id' })));

  addTool(server, 'get_project_by_id', 'Retrieve a single project by its ID.', byProjectId,
    (args) => handleToolCall(ctx, (c) => cwFetch(c, `/project/projects/${args.id}`, { fields: args.fields })));

  addTool(server, 'get_project_phases', 'List phases of a specific project.', withProjectId,
    (args) => handleToolCall(ctx, (c) => cwFetch(c, `/project/projects/${args.id}/phases`, args)));

  addTool(server, 'get_project_tickets', 'List project tickets. Filter by project using conditions, e.g. "project/id=123".', listSchema,
    (args) => handleToolCall(ctx, (c) => cwFetch(c, '/project/tickets', args)));

  addTool(server, 'get_project_team_members', 'List team members assigned to a specific project.', withProjectId,
    (args) => handleToolCall(ctx, (c) => cwFetch(c, `/project/projects/${args.id}/teamMembers`, args)));

  addTool(server, 'get_project_notes', 'List notes on a specific project.', withProjectId,
    (args) => handleToolCall(ctx, (c) => cwFetch(c, `/project/projects/${args.id}/notes`, args)));

  addTool(server, 'get_project_statuses', 'List project status definitions.', listSchema,
    (args) => handleToolCall(ctx, (c) => cwFetch(c, '/project/statuses', args)));
}
