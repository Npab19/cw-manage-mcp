import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

function addPrompt(
  server: McpServer,
  name: string,
  description: string,
  args: Record<string, z.ZodTypeAny>,
  handler: (args: Record<string, string>) => { messages: Array<{ role: 'user'; content: { type: 'text'; text: string } }> }
): void {
  (server as any).prompt(name, description, args, (a: Record<string, string>) => handler(a));
}

function addPromptNoArgs(
  server: McpServer,
  name: string,
  description: string,
  handler: () => { messages: Array<{ role: 'user'; content: { type: 'text'; text: string } }> }
): void {
  (server as any).prompt(name, description, handler);
}

export function register(server: McpServer): void {

  // ── daily_standup ───────────────────────────────────────────────────
  addPromptNoArgs(server, 'daily_standup',
    'Generate a daily standup briefing: open tickets, SLA breaches, and unlogged time.',
    () => ({
      messages: [{
        role: 'user' as const,
        content: {
          type: 'text' as const,
          text: `You are a ConnectWise Manage assistant preparing a daily standup briefing. Perform these steps using the available tools:

1. **Open Tickets Needing Attention**: Call get_service_tickets with conditions "closedFlag=false" and orderBy "priority/id asc, lastUpdated desc" with pageSize 25. Identify tickets with high priority or that have been open the longest.

2. **SLA Breaches**: Call get_service_tickets with conditions "closedFlag=false" and orderBy "dateEntered asc" with pageSize 25. Flag any tickets that appear to be past their expected resolution date based on priority and age.

3. **Today's Time Entries**: Call get_time_entries with conditions filtering for today's date (timeStart >= today at midnight). Summarize how much time has been logged so far.

4. **Board Status**: Call get_service_boards to list active boards, then use get_board_overview on the primary boards to show ticket distribution.

Compile findings into a concise standup format:
- **Immediate Attention**: SLA risks and high-priority tickets
- **Open Ticket Summary**: counts by board and priority
- **Time Logging Status**: hours logged today so far
- **Action Items**: what needs to happen next`
        }
      }]
    }));

  // ── client_review ───────────────────────────────────────────────────
  addPrompt(server, 'client_review',
    'Generate a client health review: open tickets, agreements, and recent activity.',
    { companyIdentifier: z.string().describe('Company name or ID to review') },
    (args) => ({
      messages: [{
        role: 'user' as const,
        content: {
          type: 'text' as const,
          text: `You are a ConnectWise Manage assistant preparing a client health review for: "${args.companyIdentifier}". Perform these steps:

1. **Company Lookup**: Call get_companies with conditions "name contains '${args.companyIdentifier}'" (or "id=${args.companyIdentifier}" if numeric). Note the company ID for subsequent calls.

2. **Open Tickets**: Call get_service_tickets with conditions "company/name contains '${args.companyIdentifier}' AND closedFlag=false" ordered by "priority/id asc". Summarize by priority and status.

3. **Agreements**: Call get_agreements with conditions "company/name contains '${args.companyIdentifier}'". For each active agreement, note the type, billing cycle, and end date. Use get_agreement_profitability for key agreements.

4. **Recent Activity**: Call get_time_entries with conditions "company/name contains '${args.companyIdentifier}'" for the last 30 days. Summarize total hours and common work types.

5. **Contacts**: Call get_contacts with conditions "company/name contains '${args.companyIdentifier}'" to list key contacts.

Compile into a professional client review:
- **Company Overview**: name, key contacts, relationship summary
- **Ticket Health**: open count, priority distribution, any aging/escalated tickets
- **Agreement Status**: active agreements, upcoming renewals, profitability indicators
- **Recent Engagement**: hours logged, trends, common issues
- **Recommendations**: action items for account management`
        }
      }]
    }));

  // ── tech_productivity ───────────────────────────────────────────────
  addPrompt(server, 'tech_productivity',
    'Generate a technician productivity report: utilization, ticket throughput, and resolution time.',
    { memberIdentifier: z.string().describe('Member identifier (e.g. "jsmith")') },
    (args) => ({
      messages: [{
        role: 'user' as const,
        content: {
          type: 'text' as const,
          text: `You are a ConnectWise Manage assistant analyzing technician productivity for member: "${args.memberIdentifier}". Perform these steps:

1. **Member Profile**: Call get_members with conditions "identifier='${args.memberIdentifier}'" to get the member's details and role.

2. **Utilization (Last 30 Days)**: Call get_member_utilization with memberIdentifier="${args.memberIdentifier}", startDate set to 30 days ago (YYYY-MM-DD), and endDate set to today. This gives logged hours vs scheduled hours.

3. **Ticket Throughput**: Call get_service_tickets with childConditions "resources/member/identifier='${args.memberIdentifier}'" and conditions for the last 30 days. Separate into open vs closed to calculate throughput.

4. **Resolution Time**: From closed tickets, analyze dateEntered vs closedDate to estimate average resolution time by priority.

5. **Skills**: Call get_members first to get the member ID, then call get_tech_skills_report with that ID for a comprehensive skills breakdown.

Compile into a manager-ready productivity report:
- **Utilization Rate**: actual vs target (typical MSP target: 75-85%)
- **Ticket Throughput**: tickets closed per week, trend
- **Average Resolution Time**: broken down by priority
- **Skills Coverage**: current skills and potential gaps
- **Recommendations**: areas for improvement or recognition`
        }
      }]
    }));

  // ── escalation_check ────────────────────────────────────────────────
  addPromptNoArgs(server, 'escalation_check',
    'Identify tickets needing escalation: SLA breaches, unassigned high-priority, and aging tickets.',
    () => {
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      const cutoff = sevenDaysAgo.toISOString().split('T')[0];

      return {
        messages: [{
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: `You are a ConnectWise Manage assistant performing an escalation check. Identify tickets needing management attention:

1. **High Priority Open Tickets**: Call get_service_tickets with conditions "closedFlag=false AND priority/id<=3" ordered by "priority/id asc, dateEntered asc" with pageSize 50. These are your Critical/High/Medium priority open tickets.

2. **Aging Tickets (No Update > 7 Days)**: Call get_service_tickets with conditions "closedFlag=false AND lastUpdated<[${cutoff}T00:00:00Z]" ordered by "lastUpdated asc" with pageSize 50. These haven't been touched in over a week.

3. **Stalled Tickets**: Call get_service_tickets with conditions "closedFlag=false" and look for tickets in statuses like "Waiting", "On Hold", or "Pending" that may have been stuck. Order by "lastUpdated asc".

4. **Board Health Check**: Call get_service_boards, then use get_board_overview on the top boards to identify any boards with unusually high open ticket counts.

Compile into a prioritized escalation report:

**CRITICAL** — High-priority tickets open longest (list ticket #, summary, company, age)
**HIGH** — Unassigned or aging tickets with no recent updates
**MEDIUM** — Stalled tickets in waiting statuses
**LOW** — Boards with high ticket counts that may need more resources

For each item, include the ticket ID, summary, company name, priority, age, and a recommended action.`
          }
        }]
      };
    });

  // ── tech_skills_report ──────────────────────────────────────────────
  addPrompt(server, 'tech_skills_report',
    'Generate a comprehensive skills assessment for a technician with training recommendations.',
    { memberIdentifier: z.string().describe('Member identifier (e.g. "jsmith")') },
    (args) => ({
      messages: [{
        role: 'user' as const,
        content: {
          type: 'text' as const,
          text: `You are a ConnectWise Manage assistant generating a skills assessment for member: "${args.memberIdentifier}". Perform these steps:

1. **Member Profile**: Call get_members with conditions "identifier='${args.memberIdentifier}'" to get the member's ID, name, role, and department.

2. **Skills Inventory**: Using the member ID from step 1, call get_tech_skills_report with that ID and recentDays=90 for a 90-day activity window. This returns skills, recent tickets, and time entries.

3. **Ticket Type Analysis**: From the recent tickets in the skills report, categorize tickets by board, type, and subtype to understand what kinds of issues this tech handles most.

4. **Time Distribution**: From the recent time entries, analyze how time is distributed across work types and work roles to understand where the tech spends most of their effort.

5. **Skill Gap Analysis**: Compare the tech's registered skills against the types of tickets they're working on. Identify:
   - Skills that are actively used (tickets match skills)
   - Skills that may be underutilized (registered but few matching tickets)
   - Potential gaps (frequent ticket types with no matching skill)

Compile into a skills assessment report:
- **Technician Overview**: name, role, department, tenure
- **Current Skills**: list of registered skills with proficiency levels
- **Work Profile**: most common ticket types, boards, and work areas (last 90 days)
- **Time Distribution**: hours by work type and role
- **Skill Utilization**: which skills are actively used vs underutilized
- **Skill Gaps**: areas where the tech handles tickets but has no formal skill listed
- **Training Recommendations**: suggested skills to develop based on gap analysis
- **Strengths**: areas where the tech demonstrates deep expertise`
        }
      }]
    }));
}
