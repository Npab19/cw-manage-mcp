import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { cwFetch, handleToolCall } from '../client.js';
import { CwRequestContext, PaginationParams } from '../types.js';
import { addTool } from './helper.js';

async function safeFetch<T = unknown>(
  ctx: CwRequestContext,
  path: string,
  params: PaginationParams = {}
): Promise<{ data: T | null; error?: string }> {
  try {
    const result = await cwFetch<T>(ctx, path, params);
    return { data: result.data };
  } catch (err) {
    return { data: null, error: err instanceof Error ? err.message : String(err) };
  }
}

function collectErrors(results: Array<{ error?: string }>, labels: string[]): string[] {
  const errors: string[] = [];
  results.forEach((r, i) => {
    if (r.error) errors.push(`${labels[i]}: ${r.error}`);
  });
  return errors;
}

export function register(server: McpServer, ctx: CwRequestContext): void {

  // ── get_ticket_summary ──────────────────────────────────────────────
  addTool(server, 'get_ticket_summary',
    'Retrieve a complete ticket summary: ticket details, notes, time entries, and tasks in a single call.',
    { id: z.number().int().describe('Ticket ID') },
    (args) => handleToolCall(ctx, async (c) => {
      const [ticket, notes, timeEntries, tasks] = await Promise.all([
        safeFetch(c, `/service/tickets/${args.id}`),
        safeFetch<unknown[]>(c, `/service/tickets/${args.id}/notes`, { pageSize: 1000 }),
        safeFetch<unknown[]>(c, `/service/tickets/${args.id}/timeentries`, { pageSize: 1000 }),
        safeFetch<unknown[]>(c, `/service/tickets/${args.id}/tasks`, { pageSize: 1000 }),
      ]);

      const timeArr = timeEntries.data ?? [];
      const taskArr = tasks.data ?? [];
      const totalTimeHours = timeArr.reduce((sum: number, e: any) => sum + (e.actualHours ?? 0), 0);
      const tasksCompleted = taskArr.filter((t: any) => t.closedFlag === true).length;

      return {
        ticket: ticket.data,
        notes: notes.data,
        timeEntries: timeEntries.data,
        tasks: tasks.data,
        summary: {
          totalTimeHours: Math.round(totalTimeHours * 100) / 100,
          noteCount: notes.data?.length ?? 0,
          taskCount: taskArr.length,
          tasksCompleted,
        },
        _errors: collectErrors([ticket, notes, timeEntries, tasks],
          ['ticket', 'notes', 'timeEntries', 'tasks']),
      };
    }));

  // ── get_member_utilization ──────────────────────────────────────────
  addTool(server, 'get_member_utilization',
    'Calculate a member\'s utilization: logged hours vs scheduled hours for a date range.',
    {
      memberIdentifier: z.string().describe('Member identifier (e.g. "jsmith")'),
      startDate: z.string().describe('Start date (YYYY-MM-DD)'),
      endDate: z.string().describe('End date (YYYY-MM-DD)'),
    },
    (args) => handleToolCall(ctx, async (c) => {
      const memberId = args.memberIdentifier;
      const timeConditions = `member/identifier='${memberId}' AND timeStart>=[${args.startDate}T00:00:00Z] AND timeEnd<=[${args.endDate}T23:59:59Z]`;
      const schedConditions = `member/identifier='${memberId}' AND dateStart>=[${args.startDate}T00:00:00Z] AND dateEnd<=[${args.endDate}T23:59:59Z]`;

      const [timeEntries, schedEntries, calendars] = await Promise.all([
        safeFetch<unknown[]>(c, '/time/entries', { conditions: timeConditions, pageSize: 1000 }),
        safeFetch<unknown[]>(c, '/schedule/entries', { conditions: schedConditions, pageSize: 1000 }),
        safeFetch<unknown[]>(c, '/schedule/calendars', { pageSize: 100 }),
      ]);

      const timeArr = timeEntries.data ?? [];
      const schedArr = schedEntries.data ?? [];
      const totalHoursLogged = timeArr.reduce((sum: number, e: any) => sum + (e.actualHours ?? 0), 0);
      const scheduledHours = schedArr.reduce((sum: number, e: any) => sum + (e.hours ?? 0), 0);
      const utilizationPercentage = scheduledHours > 0
        ? Math.round((totalHoursLogged / scheduledHours) * 10000) / 100
        : null;

      return {
        memberIdentifier: memberId,
        dateRange: { start: args.startDate, end: args.endDate },
        timeEntries: timeEntries.data,
        scheduleEntries: schedEntries.data,
        calendars: calendars.data,
        utilization: {
          totalHoursLogged: Math.round(totalHoursLogged * 100) / 100,
          scheduledHours: Math.round(scheduledHours * 100) / 100,
          utilizationPercentage,
          entryCount: timeArr.length,
        },
        _errors: collectErrors([timeEntries, schedEntries, calendars],
          ['timeEntries', 'scheduleEntries', 'calendars']),
      };
    }));

  // ── get_agreement_profitability ─────────────────────────────────────
  addTool(server, 'get_agreement_profitability',
    'Retrieve agreement details with additions, adjustments, and financial recap for profitability analysis.',
    { id: z.number().int().describe('Agreement ID') },
    (args) => handleToolCall(ctx, async (c) => {
      const [agreement, additions, adjustments, recap] = await Promise.all([
        safeFetch(c, `/finance/agreements/${args.id}`),
        safeFetch<unknown[]>(c, `/finance/agreements/${args.id}/additions`, { pageSize: 1000 }),
        safeFetch<unknown[]>(c, `/finance/agreements/${args.id}/adjustments`, { pageSize: 1000 }),
        safeFetch<unknown[]>(c, '/finance/agreementRecap', { conditions: `agreementId=${args.id}`, pageSize: 100 }),
      ]);

      return {
        agreement: agreement.data,
        additions: additions.data,
        adjustments: adjustments.data,
        recap: recap.data,
        profitability: {
          totalAdditions: additions.data?.length ?? 0,
          totalAdjustments: adjustments.data?.length ?? 0,
        },
        _errors: collectErrors([agreement, additions, adjustments, recap],
          ['agreement', 'additions', 'adjustments', 'recap']),
      };
    }));

  // ── get_board_overview ──────────────────────────────────────────────
  addTool(server, 'get_board_overview',
    'Get a board overview: board details, statuses, and ticket counts per status. Ticket counts capped at 1000.',
    { id: z.number().int().describe('Board ID') },
    (args) => handleToolCall(ctx, async (c) => {
      const [board, statuses, tickets] = await Promise.all([
        safeFetch(c, `/service/boards/${args.id}`),
        safeFetch<unknown[]>(c, `/service/boards/${args.id}/statuses`, { pageSize: 100 }),
        safeFetch<unknown[]>(c, '/service/tickets', {
          conditions: `board/id=${args.id} AND closedFlag=false`,
          fields: 'id,status',
          pageSize: 1000,
        }),
      ]);

      const ticketArr = tickets.data ?? [];
      const countsByStatus: Record<string, { statusId: number; statusName: string; ticketCount: number }> = {};
      for (const t of ticketArr as any[]) {
        const statusName = t.status?.name ?? 'Unknown';
        const statusId = t.status?.id ?? 0;
        const key = String(statusId);
        if (!countsByStatus[key]) {
          countsByStatus[key] = { statusId, statusName, ticketCount: 0 };
        }
        countsByStatus[key].ticketCount++;
      }

      return {
        board: board.data,
        statuses: statuses.data,
        ticketsByStatus: Object.values(countsByStatus),
        totalOpenTickets: ticketArr.length,
        _errors: collectErrors([board, statuses, tickets],
          ['board', 'statuses', 'tickets']),
      };
    }));

  // ── get_tech_skills_report ──────────────────────────────────────────
  addTool(server, 'get_tech_skills_report',
    'Comprehensive technician skills report: member profile, skills, recent tickets, and recent time entries.',
    {
      id: z.number().int().describe('Member ID'),
      recentDays: z.number().int().optional().describe('Number of past days for recent activity (default: 30)'),
    },
    (args) => handleToolCall(ctx, async (c) => {
      const days = args.recentDays ?? 30;
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - days);
      const cutoffDate = cutoff.toISOString().split('T')[0];

      const [member, skills, tickets, timeEntries] = await Promise.all([
        safeFetch(c, `/system/members/${args.id}`),
        safeFetch<unknown[]>(c, `/system/members/${args.id}/skills`, { pageSize: 100 }),
        safeFetch<unknown[]>(c, '/service/tickets', {
          childConditions: `resources/member/id=${args.id}`,
          conditions: `lastUpdated>=[${cutoffDate}T00:00:00Z]`,
          pageSize: 100,
          orderBy: 'lastUpdated desc',
        }),
        safeFetch<unknown[]>(c, '/time/entries', {
          conditions: `member/id=${args.id} AND timeStart>=[${cutoffDate}T00:00:00Z]`,
          pageSize: 1000,
          orderBy: 'timeStart desc',
        }),
      ]);

      const timeArr = timeEntries.data ?? [];
      const recentHoursLogged = timeArr.reduce((sum: number, e: any) => sum + (e.actualHours ?? 0), 0);

      return {
        member: member.data,
        skills: skills.data,
        recentTickets: tickets.data,
        recentTimeEntries: timeEntries.data,
        summary: {
          skillCount: skills.data?.length ?? 0,
          recentTicketCount: tickets.data?.length ?? 0,
          recentHoursLogged: Math.round(recentHoursLogged * 100) / 100,
          periodDays: days,
        },
        _errors: collectErrors([member, skills, tickets, timeEntries],
          ['member', 'skills', 'tickets', 'timeEntries']),
      };
    }));
}
