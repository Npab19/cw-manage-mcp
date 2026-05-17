import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { cwFetch, cwFetchNextPage, handleToolCall } from '../client.js';
import { CwRequestContext, PaginationParams } from '../types.js';
import { addTool, escapeConditionLiteral, idSchema } from './helper.js';

const MAX_TOTAL_ROWS = 5000;
const FANOUT_PAGE_SIZE = 1000;

type Severity = 'warning' | 'error';

interface ErrorEntry {
  label: string;
  message: string;
  severity: Severity;
}

interface FetchResult<T> {
  data: T | null;
  error?: string;
}

interface PagedFetchResult<T> {
  data: T[];
  error?: string;
  truncated?: boolean;
  retrievedCount?: number;
}

async function safeFetch<T = unknown>(
  ctx: CwRequestContext,
  path: string,
  params: PaginationParams = {},
): Promise<FetchResult<T>> {
  try {
    const result = await cwFetch<T>(ctx, path, params);
    return { data: result.data };
  } catch (err) {
    return { data: null, error: err instanceof Error ? err.message : String(err) };
  }
}

async function safeFetchAll<T>(
  ctx: CwRequestContext,
  path: string,
  params: PaginationParams = {},
): Promise<PagedFetchResult<T>> {
  try {
    const first = await cwFetch<T[]>(ctx, path, { ...params, pageSize: FANOUT_PAGE_SIZE });
    const collected: T[] = Array.isArray(first.data) ? [...first.data] : [];
    let nextPageUrl = first.nextPageUrl;
    let truncated = false;
    while (nextPageUrl) {
      if (collected.length >= MAX_TOTAL_ROWS) {
        truncated = true;
        break;
      }
      const next = await cwFetchNextPage<T[]>(ctx, nextPageUrl);
      if (Array.isArray(next.data)) collected.push(...next.data);
      nextPageUrl = next.nextPageUrl;
    }
    if (collected.length > MAX_TOTAL_ROWS) {
      collected.length = MAX_TOTAL_ROWS;
      truncated = true;
    }
    return { data: collected, truncated, retrievedCount: collected.length };
  } catch (err) {
    return { data: [], error: err instanceof Error ? err.message : String(err) };
  }
}

function collectErrorsWithSeverity(
  entries: Array<{ result: { error?: string }; label: string; severity: Severity }>,
): ErrorEntry[] {
  const errors: ErrorEntry[] = [];
  for (const { result, label, severity } of entries) {
    if (result.error) errors.push({ label, message: result.error, severity });
  }
  return errors;
}

function pagedMeta<T>(p: PagedFetchResult<T>): { truncated?: boolean; retrievedCount?: number } {
  if (p.truncated) return { truncated: true, retrievedCount: p.retrievedCount };
  return {};
}

function computeCutoffDate(days: number, timezone: string): string {
  const now = new Date();
  now.setDate(now.getDate() - days);
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(now);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
    const yyyy = get('year');
    const mm = get('month');
    const dd = get('day');
    if (yyyy && mm && dd) return `${yyyy}-${mm}-${dd}`;
  } catch {
    // Fall through to UTC.
  }
  return now.toISOString().split('T')[0]!;
}

const timezoneSchema = z
  .string()
  .default('UTC')
  .describe('IANA timezone (e.g. "America/New_York"). Determines the cutoff date for "last N days".');

export function register(server: McpServer, ctx: CwRequestContext): void {
  // ── get_ticket_summary ──────────────────────────────────────────────
  addTool(
    server,
    'get_ticket_summary',
    'Complete ticket view: ticket details, notes, time entries, and tasks. Walks pagination on the sub-resources up to 5000 rows each.',
    { id: idSchema('Ticket ID') },
    (args) =>
      handleToolCall(ctx, async (c) => {
        const [ticket, notes, timeEntries, tasks] = await Promise.all([
          safeFetch(c, `/service/tickets/${args.id}`),
          safeFetchAll<unknown>(c, `/service/tickets/${args.id}/notes`),
          safeFetchAll<unknown>(c, `/service/tickets/${args.id}/timeentries`),
          safeFetchAll<unknown>(c, `/service/tickets/${args.id}/tasks`),
        ]);

        const timeArr = timeEntries.data;
        const taskArr = tasks.data;
        const totalTimeHours = timeArr.reduce<number>(
          (sum, e: any) => sum + (e?.actualHours ?? 0),
          0,
        );
        const tasksCompleted = taskArr.filter((t: any) => t?.closedFlag === true).length;

        return {
          ticket: ticket.data,
          notes: notes.data,
          timeEntries: timeEntries.data,
          tasks: tasks.data,
          summary: {
            totalTimeHours: Math.round(totalTimeHours * 100) / 100,
            noteCount: notes.data.length,
            taskCount: taskArr.length,
            tasksCompleted,
          },
          meta: {
            notes: pagedMeta(notes),
            timeEntries: pagedMeta(timeEntries),
            tasks: pagedMeta(tasks),
          },
          _errors: collectErrorsWithSeverity([
            { result: ticket, label: 'ticket', severity: 'error' },
            { result: notes, label: 'notes', severity: 'warning' },
            { result: timeEntries, label: 'timeEntries', severity: 'warning' },
            { result: tasks, label: 'tasks', severity: 'warning' },
          ]),
        };
      }),
  );

  // ── get_member_utilization ──────────────────────────────────────────
  addTool(
    server,
    'get_member_utilization',
    'Calculate a member\'s utilization: logged hours vs scheduled hours for a date range.',
    {
      memberIdentifier: z.string().describe('Member identifier (e.g. "jsmith")'),
      startDate: z.string().describe('Start date (YYYY-MM-DD)'),
      endDate: z.string().describe('End date (YYYY-MM-DD)'),
    },
    (args) =>
      handleToolCall(ctx, async (c) => {
        const memberId = args.memberIdentifier;
        const safeMemberId = escapeConditionLiteral(memberId);
        const timeConditions = `member/identifier='${safeMemberId}' AND timeStart>=[${args.startDate}T00:00:00Z] AND timeEnd<=[${args.endDate}T23:59:59Z]`;
        const schedConditions = `member/identifier='${safeMemberId}' AND dateStart>=[${args.startDate}T00:00:00Z] AND dateEnd<=[${args.endDate}T23:59:59Z]`;

        const [timeEntries, schedEntries, calendars] = await Promise.all([
          safeFetchAll<any>(c, '/time/entries', { conditions: timeConditions }),
          safeFetchAll<any>(c, '/schedule/entries', { conditions: schedConditions }),
          safeFetchAll<any>(c, '/schedule/calendars'),
        ]);

        const timeArr = timeEntries.data;
        const schedArr = schedEntries.data;
        const totalHoursLogged = timeArr.reduce((sum, e: any) => sum + (e?.actualHours ?? 0), 0);
        const scheduledHours = schedArr.reduce((sum, e: any) => sum + (e?.hours ?? 0), 0);
        const utilizationPercentage =
          scheduledHours > 0
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
          meta: {
            timeEntries: pagedMeta(timeEntries),
            scheduleEntries: pagedMeta(schedEntries),
            calendars: pagedMeta(calendars),
          },
          _errors: collectErrorsWithSeverity([
            { result: timeEntries, label: 'timeEntries', severity: 'error' },
            { result: schedEntries, label: 'scheduleEntries', severity: 'error' },
            { result: calendars, label: 'calendars', severity: 'warning' },
          ]),
        };
      }),
  );

  // ── get_agreement_profitability ─────────────────────────────────────
  addTool(
    server,
    'get_agreement_profitability',
    'Agreement details + additions, adjustments, and financial recap for profitability analysis.',
    { id: idSchema('Agreement ID') },
    (args) =>
      handleToolCall(ctx, async (c) => {
        const [agreement, additions, adjustments, recap] = await Promise.all([
          safeFetch(c, `/finance/agreements/${args.id}`),
          safeFetchAll<unknown>(c, `/finance/agreements/${args.id}/additions`),
          safeFetchAll<unknown>(c, `/finance/agreements/${args.id}/adjustments`),
          safeFetchAll<unknown>(c, '/finance/agreementRecap', {
            conditions: `agreementId=${args.id}`,
          }),
        ]);

        return {
          agreement: agreement.data,
          additions: additions.data,
          adjustments: adjustments.data,
          recap: recap.data,
          profitability: {
            totalAdditions: additions.data.length,
            totalAdjustments: adjustments.data.length,
          },
          meta: {
            additions: pagedMeta(additions),
            adjustments: pagedMeta(adjustments),
            recap: pagedMeta(recap),
          },
          _errors: collectErrorsWithSeverity([
            { result: agreement, label: 'agreement', severity: 'error' },
            { result: additions, label: 'additions', severity: 'warning' },
            { result: adjustments, label: 'adjustments', severity: 'warning' },
            { result: recap, label: 'recap', severity: 'warning' },
          ]),
        };
      }),
  );

  // ── get_board_overview ──────────────────────────────────────────────
  addTool(
    server,
    'get_board_overview',
    'Board overview: details, statuses, and ticket counts per status (up to 5000 open tickets sampled).',
    { id: idSchema('Board ID') },
    (args) =>
      handleToolCall(ctx, async (c) => {
        const [board, statuses, tickets] = await Promise.all([
          safeFetch(c, `/service/boards/${args.id}`),
          safeFetchAll<any>(c, `/service/boards/${args.id}/statuses`),
          safeFetchAll<any>(c, '/service/tickets', {
            conditions: `board/id=${args.id} AND closedFlag=false`,
            fields: 'id,status',
          }),
        ]);

        const ticketArr = tickets.data;
        const countsByStatus: Record<
          string,
          { statusId: number; statusName: string; ticketCount: number }
        > = {};
        for (const t of ticketArr) {
          const statusName = t?.status?.name ?? 'Unknown';
          const statusId = t?.status?.id ?? 0;
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
          meta: { tickets: pagedMeta(tickets), statuses: pagedMeta(statuses) },
          _errors: collectErrorsWithSeverity([
            { result: board, label: 'board', severity: 'error' },
            { result: statuses, label: 'statuses', severity: 'warning' },
            { result: tickets, label: 'tickets', severity: 'warning' },
          ]),
        };
      }),
  );

  // ── get_tech_skills_report ──────────────────────────────────────────
  addTool(
    server,
    'get_tech_skills_report',
    'Comprehensive technician skills report: member profile, skills, recent tickets, and recent time entries.',
    {
      id: idSchema('Member ID'),
      recentDays: z.number().int().min(1).optional().describe('Number of past days for recent activity (default: 30)'),
      timezone: timezoneSchema,
    },
    (args) =>
      handleToolCall(ctx, async (c) => {
        const days = args.recentDays ?? 30;
        const cutoffDate = computeCutoffDate(days, args.timezone ?? 'UTC');

        const [member, skills, tickets, timeEntries] = await Promise.all([
          safeFetch(c, `/system/members/${args.id}`),
          safeFetchAll<unknown>(c, `/system/members/${args.id}/skills`),
          safeFetchAll<any>(c, '/service/tickets', {
            childConditions: `resources/member/id=${args.id}`,
            conditions: `lastUpdated>=[${cutoffDate}T00:00:00Z]`,
            orderBy: 'lastUpdated desc',
          }),
          safeFetchAll<any>(c, '/time/entries', {
            conditions: `member/id=${args.id} AND timeStart>=[${cutoffDate}T00:00:00Z]`,
            orderBy: 'timeStart desc',
          }),
        ]);

        const timeArr = timeEntries.data;
        const recentHoursLogged = timeArr.reduce(
          (sum, e: any) => sum + (e?.actualHours ?? 0),
          0,
        );

        return {
          member: member.data,
          skills: skills.data,
          recentTickets: tickets.data,
          recentTimeEntries: timeEntries.data,
          summary: {
            skillCount: skills.data.length,
            recentTicketCount: tickets.data.length,
            recentHoursLogged: Math.round(recentHoursLogged * 100) / 100,
            periodDays: days,
            cutoffDate,
            timezone: args.timezone ?? 'UTC',
          },
          meta: {
            skills: pagedMeta(skills),
            tickets: pagedMeta(tickets),
            timeEntries: pagedMeta(timeEntries),
          },
          _errors: collectErrorsWithSeverity([
            { result: member, label: 'member', severity: 'error' },
            { result: skills, label: 'skills', severity: 'warning' },
            { result: tickets, label: 'tickets', severity: 'warning' },
            { result: timeEntries, label: 'timeEntries', severity: 'warning' },
          ]),
        };
      }),
  );

  // ── get_recurring_issues_report ─────────────────────────────────────
  addTool(
    server,
    'get_recurring_issues_report',
    'Analyze recurring ticket patterns: groups closed tickets by type/subType over a date range and ranks by frequency.',
    {
      boardId: z.number().int().min(1).optional().describe('Board ID to filter (omit for all boards)'),
      days: z.number().int().min(1).optional().describe('Number of past days to analyze (default: 90)'),
      timezone: timezoneSchema,
    },
    (args) =>
      handleToolCall(ctx, async (c) => {
        const days = args.days ?? 90;
        const cutoffDate = computeCutoffDate(days, args.timezone ?? 'UTC');

        let conditions = `closedFlag=true AND closedDate>=[${cutoffDate}T00:00:00Z]`;
        if (args.boardId) conditions += ` AND board/id=${args.boardId}`;

        const tickets = await safeFetchAll<any>(c, '/service/tickets', {
          conditions,
          fields: 'id,summary,type,subType,board,company,dateEntered,closedDate,priority',
          orderBy: 'closedDate desc',
        });

        const ticketArr = tickets.data;
        const groups: Record<
          string,
          {
            type: string;
            subType: string;
            count: number;
            companies: Set<string>;
            totalResolutionMs: number;
          }
        > = {};

        for (const t of ticketArr) {
          const typeName = t?.type?.name ?? 'Untyped';
          const subTypeName = t?.subType?.name ?? 'None';
          const key = `${typeName}||${subTypeName}`;
          if (!groups[key]) {
            groups[key] = {
              type: typeName,
              subType: subTypeName,
              count: 0,
              companies: new Set(),
              totalResolutionMs: 0,
            };
          }
          groups[key].count++;
          if (t?.company?.name) groups[key].companies.add(t.company.name);
          if (t?.dateEntered && t?.closedDate) {
            groups[key].totalResolutionMs +=
              new Date(t.closedDate).getTime() - new Date(t.dateEntered).getTime();
          }
        }

        const ranked = Object.values(groups)
          .map((g) => ({
            type: g.type,
            subType: g.subType,
            count: g.count,
            affectedCompanies: [...g.companies],
            avgResolutionHours:
              g.count > 0 ? Math.round((g.totalResolutionMs / g.count / 3600000) * 100) / 100 : null,
          }))
          .sort((a, b) => b.count - a.count);

        return {
          periodDays: days,
          cutoffDate,
          timezone: args.timezone ?? 'UTC',
          totalClosedTickets: ticketArr.length,
          recurringIssues: ranked,
          meta: { tickets: pagedMeta(tickets) },
          _errors: collectErrorsWithSeverity([
            { result: tickets, label: 'tickets', severity: 'error' },
          ]),
        };
      }),
  );

  // ── get_ticket_tone_analysis ────────────────────────────────────────
  addTool(
    server,
    'get_ticket_tone_analysis',
    'Retrieve ticket details and all notes with metadata for tone/sentiment analysis by the AI.',
    { id: idSchema('Ticket ID') },
    (args) =>
      handleToolCall(ctx, async (c) => {
        const [ticket, notes] = await Promise.all([
          safeFetch<any>(c, `/service/tickets/${args.id}`),
          safeFetchAll<any>(c, `/service/tickets/${args.id}/notes`, {
            orderBy: 'dateCreated asc',
          }),
        ]);

        const noteArr = notes.data.map((n: any, i: number, arr: any[]) => ({
          id: n?.id,
          text: n?.text,
          createdBy: n?.createdBy ?? n?.member?.name ?? 'Unknown',
          dateCreated: n?.dateCreated,
          internalFlag: n?.internalFlag ?? n?.internalAnalysisFlag ?? null,
          externalFlag: n?.externalFlag ?? n?.detailDescriptionFlag ?? null,
          wordCount: typeof n?.text === 'string' ? n.text.split(/\s+/).filter(Boolean).length : 0,
          minutesSincePrevious:
            i > 0 && n?.dateCreated && arr[i - 1]?.dateCreated
              ? Math.round(
                  (new Date(n.dateCreated).getTime() - new Date(arr[i - 1].dateCreated).getTime()) /
                    60000,
                )
              : null,
        }));

        const first = noteArr[0]?.dateCreated;
        const last = noteArr[noteArr.length - 1]?.dateCreated;
        return {
          ticket: ticket.data,
          notes: noteArr,
          summary: {
            noteCount: noteArr.length,
            totalWordCount: noteArr.reduce((s: number, n: any) => s + n.wordCount, 0),
            internalNotes: noteArr.filter((n: any) => n.internalFlag === true).length,
            externalNotes: noteArr.filter((n: any) => n.externalFlag === true).length,
            spanMinutes:
              noteArr.length >= 2 && first && last
                ? Math.round((new Date(last).getTime() - new Date(first).getTime()) / 60000)
                : null,
          },
          meta: { notes: pagedMeta(notes) },
          _errors: collectErrorsWithSeverity([
            { result: ticket, label: 'ticket', severity: 'error' },
            { result: notes, label: 'notes', severity: 'warning' },
          ]),
        };
      }),
  );

  // ── get_common_issues_by_company ────────────────────────────────────
  addTool(
    server,
    'get_common_issues_by_company',
    'Analyze common ticket patterns for a specific company: groups tickets by type/subType with open vs closed ratios.',
    {
      companyIdentifier: z.string().describe('Company name to filter (used in conditions contains)'),
      days: z.number().int().min(1).optional().describe('Number of past days to analyze (default: 90)'),
      timezone: timezoneSchema,
    },
    (args) =>
      handleToolCall(ctx, async (c) => {
        const days = args.days ?? 90;
        const cutoffDate = computeCutoffDate(days, args.timezone ?? 'UTC');

        const safeCompany = escapeConditionLiteral(args.companyIdentifier);
        const tickets = await safeFetchAll<any>(c, '/service/tickets', {
          conditions: `company/name contains '${safeCompany}' AND dateEntered>=[${cutoffDate}T00:00:00Z]`,
          fields:
            'id,summary,type,subType,board,status,priority,dateEntered,closedDate,closedFlag',
          orderBy: 'dateEntered desc',
        });

        const ticketArr = tickets.data;
        const groups: Record<
          string,
          { type: string; subType: string; open: number; closed: number }
        > = {};

        for (const t of ticketArr) {
          const typeName = t?.type?.name ?? 'Untyped';
          const subTypeName = t?.subType?.name ?? 'None';
          const key = `${typeName}||${subTypeName}`;
          if (!groups[key]) {
            groups[key] = { type: typeName, subType: subTypeName, open: 0, closed: 0 };
          }
          if (t?.closedFlag) groups[key].closed++;
          else groups[key].open++;
        }

        const ranked = Object.values(groups)
          .map((g) => ({ ...g, total: g.open + g.closed }))
          .sort((a, b) => b.total - a.total);

        return {
          companyIdentifier: args.companyIdentifier,
          periodDays: days,
          cutoffDate,
          timezone: args.timezone ?? 'UTC',
          totalTickets: ticketArr.length,
          openTickets: ticketArr.filter((t: any) => !t?.closedFlag).length,
          closedTickets: ticketArr.filter((t: any) => t?.closedFlag).length,
          issuesByType: ranked,
          meta: { tickets: pagedMeta(tickets) },
          _errors: collectErrorsWithSeverity([
            { result: tickets, label: 'tickets', severity: 'error' },
          ]),
        };
      }),
  );

  // ── get_helpdesk_team_report ────────────────────────────────────────
  addTool(
    server,
    'get_helpdesk_team_report',
    'Helpdesk team performance: per-member stats (tickets, hours, resolution time) and top issue types. Prefer passing `boardId` — unscoped queries pull every time entry in the date range and can time out at the CW API (HTTP 500); when scoped, time entries are filtered to that board\'s tickets. The partial-failure path still returns ticket data with a warning in `_errors` if time entries fail.',
    {
      boardId: z.number().int().min(1).optional().describe('Board ID to filter (omit for all boards)'),
      days: z.number().int().min(1).optional().describe('Number of past days to analyze (default: 30)'),
      top_n: z
        .number()
        .int()
        .min(1)
        .max(50)
        .default(20)
        .describe('Cap on teamPerformance and topIssueTypes array lengths.'),
      timezone: timezoneSchema,
    },
    (args) =>
      handleToolCall(ctx, async (c) => {
        const days = args.days ?? 30;
        const topN = args.top_n ?? 20;
        const cutoffDate = computeCutoffDate(days, args.timezone ?? 'UTC');

        let ticketConditions = `dateEntered>=[${cutoffDate}T00:00:00Z]`;
        if (args.boardId) ticketConditions += ` AND board/id=${args.boardId}`;

        const tickets = await safeFetchAll<any>(c, '/service/tickets', {
          conditions: ticketConditions,
          fields:
            'id,summary,status,priority,type,subType,board,resources,dateEntered,closedDate,closedFlag,lastUpdated',
          orderBy: 'dateEntered desc',
        });
        const ticketArr = tickets.data;
        const boardTicketIds = new Set<number>(
          args.boardId ? ticketArr.map((t: any) => Number(t?.id)).filter((n) => Number.isFinite(n)) : [],
        );

        const timeEntries = await safeFetchAll<any>(c, '/time/entries', {
          conditions: `timeStart>=[${cutoffDate}T00:00:00Z]`,
          orderBy: 'timeStart desc',
        });
        const allTimeEntries = timeEntries.data;
        const timeArr = args.boardId
          ? allTimeEntries.filter(
              (te: any) =>
                te?.chargeToType === 'ServiceTicket' && boardTicketIds.has(Number(te?.chargeToId)),
            )
          : allTimeEntries;

        const memberStats: Record<
          string,
          {
            name: string;
            hoursLogged: number;
            ticketsClosed: number;
            ticketsAssigned: number;
            totalResolutionMs: number;
            closedCount: number;
          }
        > = {};

        const ensure = (name: string) => {
          if (!memberStats[name]) {
            memberStats[name] = {
              name,
              hoursLogged: 0,
              ticketsClosed: 0,
              ticketsAssigned: 0,
              totalResolutionMs: 0,
              closedCount: 0,
            };
          }
          return memberStats[name];
        };

        for (const te of timeArr) {
          const name = te?.member?.name ?? te?.member?.identifier ?? 'Unknown';
          ensure(name).hoursLogged += te?.actualHours ?? 0;
        }
        for (const t of ticketArr) {
          const resources = (t?.resources ?? []) as any[];
          for (const r of resources) {
            const name = r?.name ?? r?.member?.name ?? 'Unknown';
            const m = ensure(name);
            m.ticketsAssigned++;
            if (t?.closedFlag) {
              m.ticketsClosed++;
              if (t?.dateEntered && t?.closedDate) {
                m.totalResolutionMs +=
                  new Date(t.closedDate).getTime() - new Date(t.dateEntered).getTime();
                m.closedCount++;
              }
            }
          }
        }

        const teamPerformance = Object.values(memberStats)
          .map((m) => ({
            member: m.name,
            hoursLogged: Math.round(m.hoursLogged * 100) / 100,
            ticketsAssigned: m.ticketsAssigned,
            ticketsClosed: m.ticketsClosed,
            avgResolutionHours:
              m.closedCount > 0
                ? Math.round((m.totalResolutionMs / m.closedCount / 3600000) * 100) / 100
                : null,
          }))
          .sort((a, b) => b.ticketsClosed - a.ticketsClosed)
          .slice(0, topN);

        const typeCount: Record<string, number> = {};
        for (const t of ticketArr) {
          const typeName = t?.type?.name ?? 'Untyped';
          typeCount[typeName] = (typeCount[typeName] ?? 0) + 1;
        }
        const topIssueTypes = Object.entries(typeCount)
          .map(([type, count]) => ({ type, count }))
          .sort((a, b) => b.count - a.count)
          .slice(0, topN);

        return {
          periodDays: days,
          cutoffDate,
          timezone: args.timezone ?? 'UTC',
          boardId: args.boardId ?? null,
          totalTickets: ticketArr.length,
          openTickets: ticketArr.filter((t: any) => !t?.closedFlag).length,
          closedTickets: ticketArr.filter((t: any) => t?.closedFlag).length,
          totalHoursLogged:
            Math.round(timeArr.reduce((s: number, e: any) => s + (e?.actualHours ?? 0), 0) * 100) /
            100,
          teamPerformance,
          topIssueTypes,
          meta: { tickets: pagedMeta(tickets), timeEntries: pagedMeta(timeEntries) },
          _errors: collectErrorsWithSeverity([
            { result: tickets, label: 'tickets', severity: 'error' },
            { result: timeEntries, label: 'timeEntries', severity: 'error' },
          ]),
        };
      }),
  );

  // ── get_sla_compliance_report ───────────────────────────────────────
  addTool(
    server,
    'get_sla_compliance_report',
    'SLA compliance report: per-priority ticket counts, slaMet/slaBreached, compliance percentage, and average response/resolution times vs target.',
    {
      boardId: z.number().int().min(1).optional().describe('Board ID to filter (omit for all boards)'),
      days: z.number().int().min(1).optional().describe('Number of past days to analyze (default: 30)'),
      timezone: timezoneSchema,
    },
    (args) =>
      handleToolCall(ctx, async (c) => {
        const days = args.days ?? 30;
        const cutoffDate = computeCutoffDate(days, args.timezone ?? 'UTC');

        let ticketConditions = `closedFlag=true AND closedDate>=[${cutoffDate}T00:00:00Z]`;
        if (args.boardId) ticketConditions += ` AND board/id=${args.boardId}`;

        const [tickets, slas, priorities] = await Promise.all([
          safeFetchAll<any>(c, '/service/tickets', {
            conditions: ticketConditions,
            fields:
              'id,summary,priority,board,company,dateEntered,closedDate,respondedDate,sla',
            orderBy: 'closedDate desc',
          }),
          safeFetchAll<any>(c, '/service/SLAs'),
          safeFetchAll<any>(c, '/service/priorities'),
        ]);

        const slaTargetHours = buildSlaTargetTable(slas.data, args.boardId);
        const ticketArr = tickets.data;
        const byPriority = new Map<
          string,
          {
            priority: string;
            ticketCount: number;
            totalResolutionMs: number;
            totalResponseMs: number;
            respondedCount: number;
            resolutionMet: number;
            resolutionBreached: number;
            responseMet: number;
            responseBreached: number;
            targetResolutionHours: number | null;
            targetResponseHours: number | null;
          }
        >();

        for (const t of ticketArr) {
          const pName = t?.priority?.name ?? 'Unknown';
          if (!byPriority.has(pName)) {
            const target = slaTargetHours.get(pName) ?? { resolutionHours: null, responseHours: null };
            byPriority.set(pName, {
              priority: pName,
              ticketCount: 0,
              totalResolutionMs: 0,
              totalResponseMs: 0,
              respondedCount: 0,
              resolutionMet: 0,
              resolutionBreached: 0,
              responseMet: 0,
              responseBreached: 0,
              targetResolutionHours: target.resolutionHours,
              targetResponseHours: target.responseHours,
            });
          }
          const bucket = byPriority.get(pName)!;
          bucket.ticketCount++;

          if (t?.dateEntered && t?.closedDate) {
            const resMs = new Date(t.closedDate).getTime() - new Date(t.dateEntered).getTime();
            bucket.totalResolutionMs += resMs;
            if (bucket.targetResolutionHours !== null) {
              if (resMs <= bucket.targetResolutionHours * 3600000) bucket.resolutionMet++;
              else bucket.resolutionBreached++;
            }
          }
          if (t?.dateEntered && t?.respondedDate) {
            const respMs = new Date(t.respondedDate).getTime() - new Date(t.dateEntered).getTime();
            bucket.totalResponseMs += respMs;
            bucket.respondedCount++;
            if (bucket.targetResponseHours !== null) {
              if (respMs <= bucket.targetResponseHours * 3600000) bucket.responseMet++;
              else bucket.responseBreached++;
            }
          }
        }

        const complianceByPriority = [...byPriority.values()]
          .map((p) => {
            const resolutionEvaluated = p.resolutionMet + p.resolutionBreached;
            const responseEvaluated = p.responseMet + p.responseBreached;
            return {
              priority: p.priority,
              ticketCount: p.ticketCount,
              targetResolutionHours: p.targetResolutionHours,
              targetResponseHours: p.targetResponseHours,
              avgResolutionHours:
                p.ticketCount > 0
                  ? Math.round((p.totalResolutionMs / p.ticketCount / 3600000) * 100) / 100
                  : null,
              avgResponseHours:
                p.respondedCount > 0
                  ? Math.round((p.totalResponseMs / p.respondedCount / 3600000) * 100) / 100
                  : null,
              resolutionSlaMet: p.resolutionMet,
              resolutionSlaBreached: p.resolutionBreached,
              resolutionCompliancePercentage:
                resolutionEvaluated > 0
                  ? Math.round((p.resolutionMet / resolutionEvaluated) * 10000) / 100
                  : null,
              responseSlaMet: p.responseMet,
              responseSlaBreached: p.responseBreached,
              responseCompliancePercentage:
                responseEvaluated > 0
                  ? Math.round((p.responseMet / responseEvaluated) * 10000) / 100
                  : null,
            };
          })
          .sort((a, b) => b.ticketCount - a.ticketCount);

        return {
          periodDays: days,
          cutoffDate,
          timezone: args.timezone ?? 'UTC',
          boardId: args.boardId ?? null,
          totalClosedTickets: ticketArr.length,
          complianceByPriority,
          slaDefinitions: slas.data,
          priorityDefinitions: priorities.data,
          meta: {
            tickets: pagedMeta(tickets),
            slas: pagedMeta(slas),
            priorities: pagedMeta(priorities),
          },
          _errors: collectErrorsWithSeverity([
            { result: tickets, label: 'tickets', severity: 'error' },
            { result: slas, label: 'slas', severity: 'warning' },
            { result: priorities, label: 'priorities', severity: 'warning' },
          ]),
        };
      }),
  );
}

interface SlaTarget {
  resolutionHours: number | null;
  responseHours: number | null;
}

const PRIORITY_FIELD_PREFIXES: Record<string, string[]> = {
  Critical: ['critical', 'priority1'],
  High: ['high', 'priority2'],
  Medium: ['medium', 'priority3'],
  Low: ['low', 'priority4'],
};

function buildSlaTargetTable(
  slaDefinitions: any[] | null | undefined,
  boardId?: number,
): Map<string, SlaTarget> {
  const table = new Map<string, SlaTarget>();
  if (!Array.isArray(slaDefinitions) || slaDefinitions.length === 0) return table;

  const candidate =
    (boardId && slaDefinitions.find((s) => s?.board?.id === boardId)) ||
    slaDefinitions.find((s) => s?.defaultFlag === true) ||
    slaDefinitions[0];
  if (!candidate) return table;

  for (const [priorityName, prefixes] of Object.entries(PRIORITY_FIELD_PREFIXES)) {
    let resolutionHours: number | null = null;
    let responseHours: number | null = null;
    for (const prefix of prefixes) {
      const resp = candidate[`${prefix}RespondHours`] ?? candidate[`${prefix}Respond`];
      const reso =
        candidate[`${prefix}ResolutionHours`] ??
        candidate[`${prefix}Resolution`] ??
        candidate[`${prefix}Hours`];
      if (responseHours === null && typeof resp === 'number') responseHours = resp;
      if (resolutionHours === null && typeof reso === 'number') resolutionHours = reso;
    }
    if (resolutionHours !== null || responseHours !== null) {
      table.set(priorityName, { resolutionHours, responseHours });
    }
  }
  return table;
}
