import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { escapeConditionLiteral } from '../tools/helper.js';

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
    (args) => {
      const safeCompany = escapeConditionLiteral(args.companyIdentifier);
      return ({
      messages: [{
        role: 'user' as const,
        content: {
          type: 'text' as const,
          text: `You are a ConnectWise Manage assistant preparing a client health review for: "${args.companyIdentifier}". Perform these steps:

1. **Company Lookup**: Call get_companies with conditions "name contains '${safeCompany}'" (or "id=${args.companyIdentifier}" if numeric). Note the company ID for subsequent calls.

2. **Open Tickets**: Call get_service_tickets with conditions "company/name contains '${safeCompany}' AND closedFlag=false" ordered by "priority/id asc". Summarize by priority and status.

3. **Agreements**: Call get_agreements with conditions "company/name contains '${safeCompany}'". For each active agreement, note the type, billing cycle, and end date. Use get_agreement_profitability for key agreements.

4. **Recent Activity**: Call get_time_entries with conditions "company/name contains '${safeCompany}'" for the last 30 days. Summarize total hours and common work types.

5. **Contacts**: Call get_contacts with conditions "company/name contains '${safeCompany}'" to list key contacts.

Compile into a professional client review:
- **Company Overview**: name, key contacts, relationship summary
- **Ticket Health**: open count, priority distribution, any aging/escalated tickets
- **Agreement Status**: active agreements, upcoming renewals, profitability indicators
- **Recent Engagement**: hours logged, trends, common issues
- **Recommendations**: action items for account management`
        }
      }]
    });
    });

  // ── tech_productivity ───────────────────────────────────────────────
  addPrompt(server, 'tech_productivity',
    'Generate a technician productivity report: utilization, ticket throughput, and resolution time.',
    { memberIdentifier: z.string().describe('Member identifier (e.g. "jsmith")') },
    (args) => {
      const safeMember = escapeConditionLiteral(args.memberIdentifier);
      return {
      messages: [{
        role: 'user' as const,
        content: {
          type: 'text' as const,
          text: `You are a ConnectWise Manage assistant analyzing technician productivity for member: "${args.memberIdentifier}". Perform these steps:

1. **Member Profile**: Call get_members with conditions "identifier='${safeMember}'" to get the member's details and role.

2. **Utilization (Last 30 Days)**: Call get_member_utilization with memberIdentifier="${args.memberIdentifier}", startDate set to 30 days ago (YYYY-MM-DD), and endDate set to today. This gives logged hours vs scheduled hours.

3. **Ticket Throughput**: Call get_service_tickets with childConditions "resources/member/identifier='${safeMember}'" and conditions for the last 30 days. Separate into open vs closed to calculate throughput.

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
    };
    });

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
    (args) => {
      const safeMember = escapeConditionLiteral(args.memberIdentifier);
      return {
      messages: [{
        role: 'user' as const,
        content: {
          type: 'text' as const,
          text: `You are a ConnectWise Manage assistant generating a skills assessment for member: "${args.memberIdentifier}". Perform these steps:

1. **Member Profile**: Call get_members with conditions "identifier='${safeMember}'" to get the member's ID, name, role, and department.

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
    };
    });

  // ── recurring_issue_analysis ─────────────────────────────────────────
  addPrompt(server, 'recurring_issue_analysis',
    'Analyze recurring ticket patterns and recommend preventive actions.',
    { boardName: z.string().optional().describe('Board name to filter (omit for all boards)') },
    (args) => ({
      messages: [{
        role: 'user' as const,
        content: {
          type: 'text' as const,
          text: `You are a ConnectWise Manage assistant analyzing recurring issues${args.boardName ? ` for the "${args.boardName}" board` : ''}. Perform these steps:

1. **Get Board ID** (if board name provided): Call get_service_boards to find the board ID for "${args.boardName ?? 'all boards'}".

2. **Recurring Issues**: Call get_recurring_issues_report with${args.boardName ? ' the board ID and' : ''} days=90. This returns closed tickets grouped by type/subType ranked by frequency.

3. **Top 10 Deep Dive**: For the top 10 recurring issue types, analyze:
   - How many companies are affected (widespread vs isolated)
   - Average resolution time (quick fixes vs time sinks)
   - Whether the issue count is growing or shrinking

4. **Knowledge Base Check**: Call get_knowledge_base_articles and search for articles related to the top recurring issues. Identify which issues have KB coverage and which don't.

5. **Root Cause Analysis**: For the top 5 issues, consider:
   - Is this a training issue (users need education)?
   - Is this a process issue (something should be automated)?
   - Is this a product issue (underlying system needs fixing)?
   - Is this a documentation gap (KB article needed)?

Compile into a recurring issues report:
- **Top Recurring Issues**: ranked list with frequency, affected companies, avg resolution time
- **Trend Analysis**: which issues are getting worse vs better
- **KB Coverage Gaps**: recurring issues with no knowledge base articles
- **Prevention Recommendations**: specific actions to reduce each top issue (automation, training, KB articles, vendor escalation)
- **Estimated Impact**: hours that could be saved by addressing the top 5 issues`
        }
      }]
    }));

  // ── ticket_tone_review ──────────────────────────────────────────────
  addPrompt(server, 'ticket_tone_review',
    'Analyze the tone and sentiment of a ticket conversation to identify escalation risk.',
    { ticketId: z.string().describe('Ticket ID to analyze') },
    (args) => ({
      messages: [{
        role: 'user' as const,
        content: {
          type: 'text' as const,
          text: `You are a ConnectWise Manage assistant analyzing the tone of ticket #${args.ticketId}. Perform these steps:

1. **Get Ticket Tone Data**: Call get_ticket_tone_analysis with id=${args.ticketId}. This returns the ticket details plus all notes with metadata (word count, timestamps, internal/external flags, time gaps between notes).

2. **Conversation Flow Analysis**: Read through the notes chronologically and assess:
   - **Customer Tone**: Is the customer calm, frustrated, angry, or satisfied? Does tone change over time?
   - **Urgency Signals**: Look for words indicating urgency (ASAP, critical, down, emergency, unacceptable, deadline)
   - **Frustration Indicators**: Repeated issues, escalation requests, mentions of previous tickets, capitalized text, exclamation marks
   - **Satisfaction Signals**: Thank you messages, positive feedback, confirmation of resolution

3. **Response Pattern Analysis**: Using the time gaps between notes:
   - Are responses timely or are there long gaps?
   - Does the customer follow up multiple times before getting a response?
   - Is the conversation getting longer (potential complexity/frustration)?

4. **Escalation Risk Assessment**: Based on the tone analysis, rate the escalation risk:
   - **LOW**: Customer is satisfied, issue is progressing normally
   - **MEDIUM**: Some frustration signals, but being addressed
   - **HIGH**: Clear frustration, repeated follow-ups, or escalation language
   - **CRITICAL**: Customer threatening to leave, executive involvement, or legal language

Compile into a tone analysis report:
- **Ticket Overview**: ticket #, summary, company, priority, current status, age
- **Tone Timeline**: how customer sentiment changes across the conversation
- **Key Quotes**: specific notes that indicate the strongest sentiment (positive or negative)
- **Response Timeliness**: average response time, any notable gaps
- **Escalation Risk Level**: LOW / MEDIUM / HIGH / CRITICAL with justification
- **Recommended Actions**: proactive outreach, manager involvement, priority change, or no action needed`
        }
      }]
    }));

  // ── helpdesk_manager_weekly ─────────────────────────────────────────
  addPromptNoArgs(server, 'helpdesk_manager_weekly',
    'Generate a comprehensive weekly helpdesk manager report with team performance, trends, and action items.',
    () => ({
      messages: [{
        role: 'user' as const,
        content: {
          type: 'text' as const,
          text: `You are a ConnectWise Manage assistant generating a weekly helpdesk manager report. Perform these steps:

1. **Team Performance**: Call get_helpdesk_team_report with days=7. This gives per-member stats (tickets assigned, closed, hours logged, avg resolution time) and top issue types.

2. **Recurring Issues**: Call get_recurring_issues_report with days=7. Compare with a 30-day call (days=30) to see if any issue types are trending up this week.

3. **Escalation Status**: Call get_service_tickets with conditions "closedFlag=false AND priority/id<=2" to find open critical/high priority tickets. Note how many and how old they are.

4. **SLA Compliance**: Call get_sla_compliance_report with days=7 for this week's SLA performance.

5. **Board Health**: Call get_service_boards, then get_board_overview on the primary boards to check backlog levels.

6. **Customer Satisfaction**: Call get_service_surveys to check if survey results are available, then get_service_survey_results for recent feedback.

Compile into a weekly manager report:

**EXECUTIVE SUMMARY** — 2-3 sentence overview of the week

**TEAM PERFORMANCE**
- Individual stats table: tickets closed, hours logged, avg resolution time
- Top performer and any concerning trends

**TICKET METRICS**
- Total new vs closed this week
- Backlog change (growing or shrinking?)
- Top issue types this week

**SLA COMPLIANCE**
- Compliance rate by priority
- Any SLA breaches and root causes

**ESCALATIONS & RISKS**
- Open high-priority tickets
- Aging tickets requiring attention

**RECURRING ISSUES**
- Top recurring issues trending up
- Prevention recommendations

**ACTION ITEMS FOR NEXT WEEK**
- Specific, actionable items with owners`
        }
      }]
    }));

  // ── common_issues_by_client ─────────────────────────────────────────
  addPrompt(server, 'common_issues_by_client',
    'Analyze a client\'s most common ticket patterns and recommend preventive measures.',
    { companyIdentifier: z.string().describe('Company name to analyze') },
    (args) => {
      const safeCompany = escapeConditionLiteral(args.companyIdentifier);
      return {
      messages: [{
        role: 'user' as const,
        content: {
          type: 'text' as const,
          text: `You are a ConnectWise Manage assistant analyzing ticket patterns for client: "${args.companyIdentifier}". Perform these steps:

1. **Company Issues Overview**: Call get_common_issues_by_company with companyIdentifier="${args.companyIdentifier}" and days=90. This returns tickets grouped by type/subType with open vs closed ratios.

2. **Compare Against Baseline**: Call get_recurring_issues_report with days=90 (all boards) to get the overall issue distribution. Compare whether this client has higher-than-average rates for any issue type.

3. **Open Tickets Review**: Call get_service_tickets with conditions "company/name contains '${safeCompany}' AND closedFlag=false" to see what's currently unresolved.

4. **Agreement Context**: Call get_agreements with conditions "company/name contains '${safeCompany}'" to understand the service agreement. Is the ticket volume appropriate for their agreement level?

Compile into a client issue analysis:
- **Client Overview**: company name, agreement type, total tickets in period
- **Top Issue Categories**: ranked by frequency with open/closed breakdown
- **Anomaly Detection**: issues where this client's rate significantly exceeds the baseline
- **One-Off vs Systemic**: which issues are isolated incidents vs recurring problems
- **Ticket-to-Agreement Ratio**: is the client generating an appropriate ticket volume?
- **Prevention Plan**: specific recommendations (proactive maintenance schedules, user training sessions, configuration changes, KB articles to share)
- **Risk Assessment**: is this client at risk of dissatisfaction based on volume and patterns?`
        }
      }]
    };
    });

  // ── sla_compliance_review ───────────────────────────────────────────
  addPromptNoArgs(server, 'sla_compliance_review',
    'Review SLA compliance across all boards with breach analysis and improvement recommendations.',
    () => ({
      messages: [{
        role: 'user' as const,
        content: {
          type: 'text' as const,
          text: `You are a ConnectWise Manage assistant reviewing SLA compliance. Perform these steps:

1. **Overall SLA Performance**: Call get_sla_compliance_report with days=30 for last month's performance. Note average response and resolution times by priority.

2. **SLA Definitions**: From the SLA compliance report, review the slaDefinitions to understand the targets. Compare actual performance against targets.

3. **Worst Performers**: Call get_service_tickets with conditions "closedFlag=true" for the last 30 days, ordered by resolution time (longest first). Identify the tickets that took the longest to resolve.

4. **Board-Level Breakdown**: Call get_service_boards, then call get_sla_compliance_report for each major board to identify which boards have the worst SLA compliance.

5. **Priority Analysis**: For each priority level, assess:
   - Are response times meeting SLA targets?
   - Are resolution times meeting SLA targets?
   - What percentage of tickets breach SLA?

Compile into an SLA compliance review:
- **Overall Compliance Rate**: percentage meeting SLA by priority
- **Response Time Performance**: actual vs target by priority
- **Resolution Time Performance**: actual vs target by priority
- **Worst Breaches**: tickets with the longest resolution times (ticket #, company, priority, time to resolve)
- **Board Comparison**: which boards perform best/worst
- **Root Causes**: common reasons for SLA breaches (staffing gaps, complex issues, customer delays)
- **Improvement Recommendations**: process changes, staffing adjustments, or workflow updates to improve compliance`
        }
      }]
    }));
}
