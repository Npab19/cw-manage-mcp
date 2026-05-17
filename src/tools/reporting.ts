import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { cwFetch, handleToolCall } from '../client.js';
import { CwRequestContext, PaginationParams } from '../types.js';
import { addTool, escapeConditionLiteral } from './helper.js';

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
      const safeMemberId = escapeConditionLiteral(memberId);
      const timeConditions = `member/identifier='${safeMemberId}' AND timeStart>=[${args.startDate}T00:00:00Z] AND timeEnd<=[${args.endDate}T23:59:59Z]`;
      const schedConditions = `member/identifier='${safeMemberId}' AND dateStart>=[${args.startDate}T00:00:00Z] AND dateEnd<=[${args.endDate}T23:59:59Z]`;

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

  // ── get_recurring_issues_report ─────────────────────────────────────
  addTool(server, 'get_recurring_issues_report',
    'Analyze recurring ticket patterns: groups closed tickets by type/subType over a date range and ranks by frequency.',
    {
      boardId: z.number().int().optional().describe('Board ID to filter (omit for all boards)'),
      days: z.number().int().optional().describe('Number of past days to analyze (default: 90)'),
    },
    (args) => handleToolCall(ctx, async (c) => {
      const days = args.days ?? 90;
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - days);
      const cutoffDate = cutoff.toISOString().split('T')[0];

      let conditions = `closedFlag=true AND closedDate>=[${cutoffDate}T00:00:00Z]`;
      if (args.boardId) conditions += ` AND board/id=${args.boardId}`;

      const tickets = await safeFetch<any[]>(c, '/service/tickets', {
        conditions,
        fields: 'id,summary,type,subType,board,company,dateEntered,closedDate,priority',
        pageSize: 1000,
        orderBy: 'closedDate desc',
      });

      const ticketArr = tickets.data ?? [];
      const groups: Record<string, {
        type: string; subType: string; count: number;
        companies: Set<string>; totalResolutionMs: number;
      }> = {};

      for (const t of ticketArr) {
        const typeName = t.type?.name ?? 'Untyped';
        const subTypeName = t.subType?.name ?? 'None';
        const key = `${typeName}||${subTypeName}`;
        if (!groups[key]) {
          groups[key] = { type: typeName, subType: subTypeName, count: 0, companies: new Set(), totalResolutionMs: 0 };
        }
        groups[key].count++;
        if (t.company?.name) groups[key].companies.add(t.company.name);
        if (t.dateEntered && t.closedDate) {
          groups[key].totalResolutionMs += new Date(t.closedDate).getTime() - new Date(t.dateEntered).getTime();
        }
      }

      const ranked = Object.values(groups)
        .map(g => ({
          type: g.type,
          subType: g.subType,
          count: g.count,
          affectedCompanies: [...g.companies],
          avgResolutionHours: g.count > 0 ? Math.round((g.totalResolutionMs / g.count / 3600000) * 100) / 100 : null,
        }))
        .sort((a, b) => b.count - a.count);

      return {
        periodDays: days,
        totalClosedTickets: ticketArr.length,
        recurringIssues: ranked,
        _errors: collectErrors([tickets], ['tickets']),
      };
    }));

  // ── get_ticket_tone_analysis ────────────────────────────────────────
  addTool(server, 'get_ticket_tone_analysis',
    'Retrieve ticket details and all notes with metadata for tone/sentiment analysis by the AI.',
    { id: z.number().int().describe('Ticket ID') },
    (args) => handleToolCall(ctx, async (c) => {
      const [ticket, notes] = await Promise.all([
        safeFetch<any>(c, `/service/tickets/${args.id}`),
        safeFetch<any[]>(c, `/service/tickets/${args.id}/notes`, { pageSize: 1000, orderBy: 'dateCreated asc' }),
      ]);

      const noteArr = (notes.data ?? []).map((n: any, i: number, arr: any[]) => ({
        id: n.id,
        text: n.text,
        createdBy: n.createdBy ?? n.member?.name ?? 'Unknown',
        dateCreated: n.dateCreated,
        internalFlag: n.internalFlag ?? n.internalAnalysisFlag ?? null,
        externalFlag: n.externalFlag ?? n.detailDescriptionFlag ?? null,
        wordCount: typeof n.text === 'string' ? n.text.split(/\s+/).filter(Boolean).length : 0,
        minutesSincePrevious: i > 0 && n.dateCreated && arr[i - 1].dateCreated
          ? Math.round((new Date(n.dateCreated).getTime() - new Date(arr[i - 1].dateCreated).getTime()) / 60000)
          : null,
      }));

      return {
        ticket: ticket.data,
        notes: noteArr,
        summary: {
          noteCount: noteArr.length,
          totalWordCount: noteArr.reduce((s: number, n: any) => s + n.wordCount, 0),
          internalNotes: noteArr.filter((n: any) => n.internalFlag === true).length,
          externalNotes: noteArr.filter((n: any) => n.externalFlag === true).length,
          spanMinutes: noteArr.length >= 2 && noteArr[0].dateCreated && noteArr[noteArr.length - 1].dateCreated
            ? Math.round((new Date(noteArr[noteArr.length - 1].dateCreated).getTime() - new Date(noteArr[0].dateCreated).getTime()) / 60000)
            : null,
        },
        _errors: collectErrors([ticket, notes], ['ticket', 'notes']),
      };
    }));

  // ── get_common_issues_by_company ────────────────────────────────────
  addTool(server, 'get_common_issues_by_company',
    'Analyze common ticket patterns for a specific company: groups tickets by type/subType with open vs closed ratios.',
    {
      companyIdentifier: z.string().describe('Company name to filter (used in conditions contains)'),
      days: z.number().int().optional().describe('Number of past days to analyze (default: 90)'),
    },
    (args) => handleToolCall(ctx, async (c) => {
      const days = args.days ?? 90;
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - days);
      const cutoffDate = cutoff.toISOString().split('T')[0];

      const safeCompany = escapeConditionLiteral(args.companyIdentifier);
      const tickets = await safeFetch<any[]>(c, '/service/tickets', {
        conditions: `company/name contains '${safeCompany}' AND dateEntered>=[${cutoffDate}T00:00:00Z]`,
        fields: 'id,summary,type,subType,board,status,priority,dateEntered,closedDate,closedFlag',
        pageSize: 1000,
        orderBy: 'dateEntered desc',
      });

      const ticketArr = tickets.data ?? [];
      const groups: Record<string, { type: string; subType: string; open: number; closed: number }> = {};

      for (const t of ticketArr) {
        const typeName = t.type?.name ?? 'Untyped';
        const subTypeName = t.subType?.name ?? 'None';
        const key = `${typeName}||${subTypeName}`;
        if (!groups[key]) groups[key] = { type: typeName, subType: subTypeName, open: 0, closed: 0 };
        if (t.closedFlag) groups[key].closed++;
        else groups[key].open++;
      }

      const ranked = Object.values(groups)
        .map(g => ({ ...g, total: g.open + g.closed }))
        .sort((a, b) => b.total - a.total);

      return {
        companyIdentifier: args.companyIdentifier,
        periodDays: days,
        totalTickets: ticketArr.length,
        openTickets: ticketArr.filter((t: any) => !t.closedFlag).length,
        closedTickets: ticketArr.filter((t: any) => t.closedFlag).length,
        issuesByType: ranked,
        _errors: collectErrors([tickets], ['tickets']),
      };
    }));

  // ── get_helpdesk_team_report ────────────────────────────────────────
  addTool(server, 'get_helpdesk_team_report',
    'Helpdesk team performance report: per-member stats (tickets, hours, resolution time) and board-level metrics.',
    {
      boardId: z.number().int().optional().describe('Board ID to filter (omit for all boards)'),
      days: z.number().int().optional().describe('Number of past days to analyze (default: 30)'),
    },
    (args) => handleToolCall(ctx, async (c) => {
      const days = args.days ?? 30;
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - days);
      const cutoffDate = cutoff.toISOString().split('T')[0];

      let ticketConditions = `dateEntered>=[${cutoffDate}T00:00:00Z]`;
      if (args.boardId) ticketConditions += ` AND board/id=${args.boardId}`;

      const [tickets, timeEntries] = await Promise.all([
        safeFetch<any[]>(c, '/service/tickets', {
          conditions: ticketConditions,
          fields: 'id,summary,status,priority,type,subType,board,resources,dateEntered,closedDate,closedFlag,lastUpdated',
          pageSize: 1000,
          orderBy: 'dateEntered desc',
        }),
        safeFetch<any[]>(c, '/time/entries', {
          conditions: `timeStart>=[${cutoffDate}T00:00:00Z]`,
          pageSize: 1000,
          orderBy: 'timeStart desc',
        }),
      ]);

      const ticketArr = tickets.data ?? [];
      const timeArr = timeEntries.data ?? [];

      // Per-member stats from time entries
      const memberStats: Record<string, { name: string; hoursLogged: number; ticketsClosed: number; ticketsAssigned: number; totalResolutionMs: number; closedCount: number }> = {};

      for (const te of timeArr) {
        const name = te.member?.name ?? te.member?.identifier ?? 'Unknown';
        if (!memberStats[name]) memberStats[name] = { name, hoursLogged: 0, ticketsClosed: 0, ticketsAssigned: 0, totalResolutionMs: 0, closedCount: 0 };
        memberStats[name].hoursLogged += te.actualHours ?? 0;
      }

      // Ticket stats
      for (const t of ticketArr) {
        const resources = (t.resources ?? []) as any[];
        for (const r of resources) {
          const name = r.name ?? r.member?.name ?? 'Unknown';
          if (!memberStats[name]) memberStats[name] = { name, hoursLogged: 0, ticketsClosed: 0, ticketsAssigned: 0, totalResolutionMs: 0, closedCount: 0 };
          memberStats[name].ticketsAssigned++;
          if (t.closedFlag) {
            memberStats[name].ticketsClosed++;
            if (t.dateEntered && t.closedDate) {
              memberStats[name].totalResolutionMs += new Date(t.closedDate).getTime() - new Date(t.dateEntered).getTime();
              memberStats[name].closedCount++;
            }
          }
        }
      }

      const teamPerformance = Object.values(memberStats).map(m => ({
        member: m.name,
        hoursLogged: Math.round(m.hoursLogged * 100) / 100,
        ticketsAssigned: m.ticketsAssigned,
        ticketsClosed: m.ticketsClosed,
        avgResolutionHours: m.closedCount > 0 ? Math.round((m.totalResolutionMs / m.closedCount / 3600000) * 100) / 100 : null,
      })).sort((a, b) => b.ticketsClosed - a.ticketsClosed);

      // Top issue types
      const typeCount: Record<string, number> = {};
      for (const t of ticketArr) {
        const typeName = t.type?.name ?? 'Untyped';
        typeCount[typeName] = (typeCount[typeName] ?? 0) + 1;
      }
      const topIssueTypes = Object.entries(typeCount)
        .map(([type, count]) => ({ type, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);

      return {
        periodDays: days,
        totalTickets: ticketArr.length,
        openTickets: ticketArr.filter((t: any) => !t.closedFlag).length,
        closedTickets: ticketArr.filter((t: any) => t.closedFlag).length,
        totalHoursLogged: Math.round(timeArr.reduce((s: number, e: any) => s + (e.actualHours ?? 0), 0) * 100) / 100,
        teamPerformance,
        topIssueTypes,
        _errors: collectErrors([tickets, timeEntries], ['tickets', 'timeEntries']),
      };
    }));

  // ── get_sla_compliance_report ───────────────────────────────────────
  addTool(server, 'get_sla_compliance_report',
    'SLA compliance report: ticket response/resolution times vs SLA targets, grouped by priority.',
    {
      boardId: z.number().int().optional().describe('Board ID to filter (omit for all boards)'),
      days: z.number().int().optional().describe('Number of past days to analyze (default: 30)'),
    },
    (args) => handleToolCall(ctx, async (c) => {
      const days = args.days ?? 30;
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - days);
      const cutoffDate = cutoff.toISOString().split('T')[0];

      let ticketConditions = `closedFlag=true AND closedDate>=[${cutoffDate}T00:00:00Z]`;
      if (args.boardId) ticketConditions += ` AND board/id=${args.boardId}`;

      const [tickets, slas, priorities] = await Promise.all([
        safeFetch<any[]>(c, '/service/tickets', {
          conditions: ticketConditions,
          fields: 'id,summary,priority,board,company,dateEntered,closedDate,respondedDate,sla',
          pageSize: 1000,
          orderBy: 'closedDate desc',
        }),
        safeFetch<any[]>(c, '/service/SLAs', { pageSize: 100 }),
        safeFetch<any[]>(c, '/service/priorities', { pageSize: 100 }),
      ]);

      const ticketArr = tickets.data ?? [];
      const byPriority: Record<string, {
        priority: string; total: number; totalResolutionMs: number;
        totalResponseMs: number; respondedCount: number;
      }> = {};

      for (const t of ticketArr) {
        const pName = t.priority?.name ?? 'Unknown';
        if (!byPriority[pName]) byPriority[pName] = { priority: pName, total: 0, totalResolutionMs: 0, totalResponseMs: 0, respondedCount: 0 };
        byPriority[pName].total++;
        if (t.dateEntered && t.closedDate) {
          byPriority[pName].totalResolutionMs += new Date(t.closedDate).getTime() - new Date(t.dateEntered).getTime();
        }
        if (t.dateEntered && t.respondedDate) {
          byPriority[pName].totalResponseMs += new Date(t.respondedDate).getTime() - new Date(t.dateEntered).getTime();
          byPriority[pName].respondedCount++;
        }
      }

      const complianceByPriority = Object.values(byPriority).map(p => ({
        priority: p.priority,
        ticketCount: p.total,
        avgResolutionHours: p.total > 0 ? Math.round((p.totalResolutionMs / p.total / 3600000) * 100) / 100 : null,
        avgResponseHours: p.respondedCount > 0 ? Math.round((p.totalResponseMs / p.respondedCount / 3600000) * 100) / 100 : null,
      })).sort((a, b) => b.ticketCount - a.ticketCount);

      return {
        periodDays: days,
        totalClosedTickets: ticketArr.length,
        complianceByPriority,
        slaDefinitions: slas.data,
        priorityDefinitions: priorities.data,
        _errors: collectErrors([tickets, slas, priorities], ['tickets', 'slas', 'priorities']),
      };
    }));
}
