import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { cwFetch, handleToolCall } from '../client.js';
import { CwRequestContext } from '../types.js';
import { addTool, Schema, buildPaginationSchema, idSchema } from './helper.js';
import { cwFetchListWithExclusions } from '../composites/company-exclusions.js';
import { cachedCwFetch } from '../cache/static-lookups.js';

const pag: Schema = buildPaginationSchema('ticket');

const listSchema: Schema = { ...pag };
const ticketListSchema: Schema = {
  ...pag,
  include_excluded: z
    .boolean()
    .optional()
    .describe('When true, include tickets for globally-excluded companies. Default false.'),
};
const withTicketId: Schema = { id: idSchema('Ticket ID'), ...pag };
const withBoardId: Schema = { id: idSchema('Board ID'), ...pag };
const byId: Schema = { id: idSchema('Ticket ID'), fields: z.string().optional().describe('Fields to return') };

export function register(server: McpServer, ctx: CwRequestContext): void {
  addTool(server, 'get_service_tickets', 'Default tool for ticket questions. Use `conditions` to scope the result set. Examples: `closedFlag=false` for open tickets, `priority/id<=2` for high-priority, `board/id=N` to scope to a board, `lastUpdated>[2024-01-01T00:00:00Z]` for recently-touched. Pass `fields="id,summary,status,..."` to project only what you need — keeps responses small and fast. Tickets for globally-excluded companies are hidden by default; pass `include_excluded: true` to override.', ticketListSchema,
    (args) => handleToolCall(ctx, (c) => cwFetchListWithExclusions(c, '/service/tickets', args, { conditionsField: 'company/id', resultIdPath: 'company.id' })));

  addTool(server, 'get_service_ticket_by_id', 'Retrieve a single service ticket by its ID.', byId,
    (args) => handleToolCall(ctx, (c) => cwFetch(c, `/service/tickets/${args.id}`, { fields: args.fields })));

  addTool(server, 'get_service_ticket_notes', 'List notes on a specific service ticket.', withTicketId,
    (args) => handleToolCall(ctx, (c) => cwFetch(c, `/service/tickets/${args.id}/notes`, args)));

  addTool(server, 'get_service_ticket_time_entries', 'List time entries logged against a specific service ticket.', withTicketId,
    (args) => handleToolCall(ctx, (c) => cwFetch(c, `/service/tickets/${args.id}/timeentries`, args)));

  addTool(server, 'get_service_ticket_tasks', 'List tasks on a specific service ticket.', withTicketId,
    (args) => handleToolCall(ctx, (c) => cwFetch(c, `/service/tickets/${args.id}/tasks`, args)));

  addTool(server, 'get_service_boards', 'List service boards (queues) in ConnectWise Manage.', listSchema,
    (args) => handleToolCall(ctx, (c) => cachedCwFetch(c, '/service/boards', args)));

  addTool(server, 'get_service_board_statuses', 'List statuses configured on a specific service board.', withBoardId,
    (args) => handleToolCall(ctx, (c) => cachedCwFetch(c, `/service/boards/${args.id}/statuses`, args)));

  addTool(server, 'get_service_priorities', 'List ticket priority levels.', listSchema,
    (args) => handleToolCall(ctx, (c) => cachedCwFetch(c, '/service/priorities', args)));

  addTool(server, 'get_service_slas', 'List Service Level Agreements (SLAs).', listSchema,
    (args) => handleToolCall(ctx, (c) => cachedCwFetch(c, '/service/SLAs', args)));

  addTool(server, 'get_service_impacts', 'List ticket impact levels.', listSchema,
    (args) => handleToolCall(ctx, (c) => cachedCwFetch(c, '/service/impacts', args)));

  // ── Ticket count ────────────────────────────────────────────────────
  addTool(server, 'get_service_ticket_count', 'Get total count of service tickets matching a filter (returns a number, not records).', listSchema,
    (args) => handleToolCall(ctx, (c) => cwFetch(c, '/service/tickets/count', args)));

  // ── Ticket sub-resources ────────────────────────────────────────────
  addTool(server, 'get_service_ticket_configurations', 'List managed device configurations associated with a ticket.', withTicketId,
    (args) => handleToolCall(ctx, (c) => cwFetch(c, `/service/tickets/${args.id}/configurations`, args)));

  addTool(server, 'get_service_ticket_documents', 'List documents/attachments on a specific service ticket.', withTicketId,
    (args) => handleToolCall(ctx, (c) => cwFetch(c, `/service/tickets/${args.id}/documents`, args)));

  addTool(server, 'get_service_ticket_products', 'List products referenced on a specific service ticket.', withTicketId,
    (args) => handleToolCall(ctx, (c) => cwFetch(c, `/service/tickets/${args.id}/products`, args)));

  // ── Ticket links ────────────────────────────────────────────────────
  addTool(server, 'get_service_ticket_links', 'List linked/related tickets across all tickets. Use conditions to filter by ticket ID.', listSchema,
    (args) => handleToolCall(ctx, (c) => cwFetch(c, '/service/ticketLinks', args)));

  // ── Sources & Severities ────────────────────────────────────────────
  addTool(server, 'get_service_sources', 'List ticket sources (email, phone, portal, etc.).', listSchema,
    (args) => handleToolCall(ctx, (c) => cachedCwFetch(c, '/service/sources', args)));

  addTool(server, 'get_service_severities', 'List ticket severity levels.', listSchema,
    (args) => handleToolCall(ctx, (c) => cachedCwFetch(c, '/service/severities', args)));

  addTool(server, 'get_service_teams', 'List service teams.', listSchema,
    (args) => handleToolCall(ctx, (c) => cachedCwFetch(c, '/service/teams', args)));

  // ── Board sub-resources ─────────────────────────────────────────────
  addTool(server, 'get_service_board_types', 'List ticket type definitions on a specific service board.', withBoardId,
    (args) => handleToolCall(ctx, (c) => cachedCwFetch(c, `/service/boards/${args.id}/types`, args)));

  addTool(server, 'get_service_board_subtypes', 'List ticket subtype definitions on a specific service board.', withBoardId,
    (args) => handleToolCall(ctx, (c) => cachedCwFetch(c, `/service/boards/${args.id}/subtypes`, args)));

  addTool(server, 'get_service_board_teams', 'List teams assigned to a specific service board.', withBoardId,
    (args) => handleToolCall(ctx, (c) => cachedCwFetch(c, `/service/boards/${args.id}/teams`, args)));

  // ── Knowledge Base ──────────────────────────────────────────────────
  addTool(server, 'get_knowledge_base_articles', 'List knowledge base articles. Use conditions to search by title or content.', listSchema,
    (args) => handleToolCall(ctx, (c) => cwFetch(c, '/service/knowledgeBaseArticles', args)));

  addTool(server, 'get_knowledge_base_article_by_id', 'Retrieve a single knowledge base article by its ID.', byId,
    (args) => handleToolCall(ctx, (c) => cwFetch(c, `/service/knowledgeBaseArticles/${args.id}`, { fields: args.fields })));

  addTool(server, 'get_knowledge_base_categories', 'List knowledge base categories.', listSchema,
    (args) => handleToolCall(ctx, (c) => cachedCwFetch(c, '/service/knowledgeBaseCategories', args)));

  addTool(server, 'get_knowledge_base_subcategories', 'List knowledge base subcategories.', listSchema,
    (args) => handleToolCall(ctx, (c) => cachedCwFetch(c, '/service/knowledgeBaseSubCategories', args)));

  // ── Surveys ─────────────────────────────────────────────────────────
  const withSurveyId: Schema = { id: z.number().int().describe('Survey ID'), ...pag };

  addTool(server, 'get_service_surveys', 'List customer satisfaction surveys.', listSchema,
    (args) => handleToolCall(ctx, (c) => cwFetch(c, '/service/surveys', args)));

  addTool(server, 'get_service_survey_questions', 'List questions on a specific survey.', withSurveyId,
    (args) => handleToolCall(ctx, (c) => cwFetch(c, `/service/surveys/${args.id}/questions`, args)));

  addTool(server, 'get_service_survey_results', 'List survey results/responses for a specific survey.', withSurveyId,
    (args) => handleToolCall(ctx, (c) => cwFetch(c, `/service/surveys/${args.id}/results`, args)));
}
