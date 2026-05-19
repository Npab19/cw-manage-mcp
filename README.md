<a id="readme-top"></a>

<!-- PROJECT SHIELDS -->
[![Contributors][contributors-shield]][contributors-url]
[![Forks][forks-shield]][forks-url]
[![Stargazers][stars-shield]][stars-url]
[![Issues][issues-shield]][issues-url]
[![MIT License][license-shield]][license-url]

<!-- PROJECT LOGO -->
<br />
<div align="center">
  <h3 align="center">ConnectWise Manage MCP Server</h3>

  <p align="center">
    A read-only Model Context Protocol (MCP) server for ConnectWise Manage — query tickets, companies, agreements, time entries, projects, and more from any MCP-compatible AI client.
    <br />
    <br />
    <a href="docs/setup.md">First-time setup guide</a>
    &middot;
    <a href="https://github.com/npab19/cw-manage-mcp/issues/new?labels=bug">Report Bug</a>
    &middot;
    <a href="https://github.com/npab19/cw-manage-mcp/issues/new?labels=enhancement">Request Feature</a>
  </p>
</div>

<!-- TABLE OF CONTENTS -->
<details>
  <summary>Table of Contents</summary>
  <ol>
    <li><a href="#about-the-project">About The Project</a></li>
    <li><a href="#available-tools">Available Tools</a></li>
    <li><a href="#available-prompts">Available Prompts</a></li>
    <li><a href="#getting-started">Getting Started</a></li>
    <li><a href="#usage">Usage</a></li>
    <li><a href="#roadmap">Roadmap</a></li>
    <li><a href="#contributing">Contributing</a></li>
    <li><a href="#license">License</a></li>
  </ol>
</details>

---

<!-- ABOUT THE PROJECT -->
## About The Project

This MCP server exposes ConnectWise Manage data to AI assistants and automation pipelines through the [Model Context Protocol](https://modelcontextprotocol.io). It is **read-only** and **reporting-focused** — no records are created, modified, or deleted.

Key design decisions:

* **OAuth 2.1 authentication** — users sign in through your IdP (Entra ID, Google, etc.). The MCP server validates a Bearer JWT on every `/mcp` request. CW API credentials live server-side, never in URLs.
* **Admin dashboard at `/admin`** — setup wizard, settings, audit log, users + permissions, layered context docs, board aliases, company exclusions, service-account API keys, health, backups. Postgres-backed.
* **Per-user tool filtering** — each user's tool surface is filtered by their CW security role; admins see everything.
* **Stateless Streamable HTTP transport** — compatible with any MCP client that supports HTTP.
* **Docker + Cloudflare Tunnel** — ship it anywhere without opening inbound firewall ports.

**Built with:** TypeScript, Node.js, Express, Postgres, Docker, Cloudflare Tunnel.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

---

## Available Tools

101 tools — 89 single-endpoint CW tools, 10 composite reporting tools, plus 2 utility tools (`describe_entity`, `get_context`).

### Single-Endpoint Tools

| Module | Tools |
|--------|-------|
| **Service** | `get_service_tickets`, `get_service_ticket_by_id`, `get_service_ticket_notes`, `get_service_ticket_time_entries`, `get_service_ticket_tasks`, `get_service_ticket_count`, `get_service_ticket_configurations`, `get_service_ticket_documents`, `get_service_ticket_products`, `get_service_ticket_links`, `get_service_boards`, `get_service_board_statuses`, `get_service_board_types`, `get_service_board_subtypes`, `get_service_board_teams`, `get_service_priorities`, `get_service_slas`, `get_service_impacts`, `get_service_sources`, `get_service_severities`, `get_service_teams` |
| **Knowledge Base** | `get_knowledge_base_articles`, `get_knowledge_base_article_by_id`, `get_knowledge_base_categories`, `get_knowledge_base_subcategories` |
| **Surveys** | `get_service_surveys`, `get_service_survey_questions`, `get_service_survey_results` |
| **Company** | `get_companies`, `get_company_by_id`, `get_company_sites`, `get_company_notes`, `get_contacts`, `get_contact_by_id`, `get_contact_communications`, `get_contact_notes`, `get_company_configurations`, `get_company_configuration_by_id` |
| **Finance** | `get_agreements`, `get_agreement_by_id`, `get_agreement_additions`, `get_agreement_adjustments`, `get_agreement_sites`, `get_agreement_recap`, `get_agreement_types` |
| **Time** | `get_time_entries`, `get_time_entry_by_id`, `get_time_sheets`, `get_time_sheet_by_id`, `get_work_roles`, `get_work_types`, `get_charge_codes` |
| **Project** | `get_projects`, `get_project_by_id`, `get_project_phases`, `get_project_tickets`, `get_project_team_members`, `get_project_notes`, `get_project_statuses` |
| **System** | `get_members`, `get_member_by_id`, `get_member_skills`, `get_departments`, `get_audit_trail`, `get_system_info` |
| **Schedule** | `get_schedule_entries`, `get_schedule_entry_by_id`, `get_schedule_calendars` |
| **Sales** | `get_opportunities`, `get_opportunity_by_id`, `get_opportunity_forecast`, `get_opportunity_notes`, `get_sales_activities` |
| **Expense** | `get_expense_entries`, `get_expense_entry_by_id`, `get_expense_types`, `get_expense_reports` |
| **Procurement** | `get_products`, `get_product_by_id`, `get_catalog_items`, `get_catalog_item_by_id`, `get_purchase_orders`, `get_purchase_order_by_id`, `get_rma_actions`, `get_rma_action_by_id` |
| **Marketing** | `get_marketing_campaigns`, `get_marketing_groups` |
| **Webhook** | `get_callbacks`, `get_callback_by_id` |

All list tools support ConnectWise's full query syntax: `conditions`, `childConditions`, `customFieldConditions`, `orderBy`, `fields`, `page`, `pageSize`, `pageId`.

### Utility Tools

| Tool | Description |
|------|-------------|
| `describe_entity` | Returns the field list, types, and example conditions for a ConnectWise entity. Call before list tools when unsure what fields exist or how to filter. |
| `get_context` | Returns the merged org-specific context for the calling user — boards, team, business rules, query patterns — composed from the global, role, and user context layers. Call once at the start of a session. |

### Composite Reporting Tools

These combine multiple API calls into a single response for MSP reporting workflows:

| Tool | Description |
|------|-------------|
| `get_ticket_summary` | Complete ticket view — details, notes, time entries, tasks. Includes computed totals. |
| `get_member_utilization` | Tech utilization — logged hours vs scheduled hours for a date range. |
| `get_agreement_profitability` | Agreement financials — additions, adjustments, billing recap. |
| `get_board_overview` | Service board dashboard — details, statuses, open ticket counts per status. |
| `get_tech_skills_report` | Tech skills assessment — profile, skills, recent tickets, time entries. |
| `get_recurring_issues_report` | Recurring issue analysis — grouped by type/subType, ranked by frequency. |
| `get_ticket_tone_analysis` | Tone/sentiment data — ticket + notes with metadata for AI sentiment analysis. |
| `get_common_issues_by_company` | Per-company issue patterns — open vs closed ratios, frequency ranking. |
| `get_helpdesk_team_report` | Team performance — per-member stats plus top issue types. |
| `get_sla_compliance_report` | SLA response/resolution times by priority vs SLA targets. |

Composite tools return partial results with an `_errors` array if any sub-call fails — never crash on a single API error.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

---

## Available Prompts

10 MCP prompts provide pre-built AI workflows for common MSP tasks.

### Operational Prompts

| Prompt | Args | Description |
|--------|------|-------------|
| `daily_standup` | — | Morning briefing: open tickets, SLA risks, time logging, action items. |
| `escalation_check` | — | Escalation checklist: SLA breaches, unassigned high-priority, aging tickets. |
| `helpdesk_manager_weekly` | — | Weekly report: team performance, ticket metrics, SLA compliance, recurring issues. |

### Analysis Prompts

| Prompt | Args | Description |
|--------|------|-------------|
| `recurring_issue_analysis` | `boardName` (optional) | Pattern detection, KB gaps, root cause categorization, prevention recommendations. |
| `ticket_tone_review` | `ticketId` | Sentiment analysis: tone timeline, escalation risk level, recommended actions. |
| `common_issues_by_client` | `companyIdentifier` | Per-client patterns: anomaly detection, one-off vs systemic, prevention. |
| `sla_compliance_review` | — | SLA review: compliance rates, worst breaches, board comparison, improvements. |

### People Prompts

| Prompt | Args | Description |
|--------|------|-------------|
| `client_review` | `companyIdentifier` | Client health: open tickets, agreements, recent engagement, recommendations. |
| `tech_productivity` | `memberIdentifier` | Productivity report: utilization, throughput, resolution time, skills coverage. |
| `tech_skills_report` | `memberIdentifier` | Skills assessment: inventory, work profile, gaps, training recommendations. |

<p align="right">(<a href="#readme-top">back to top</a>)</p>

---

## Getting Started

**See [docs/setup.md](docs/setup.md) for the full first-time setup guide.** It walks through:

1. Prerequisites (Docker, ConnectWise admin access, OAuth IdP, Cloudflare Tunnel)
2. Generating ConnectWise API credentials + Client ID
3. Registering an OAuth app (Microsoft Entra ID walkthrough)
4. Configuring the Cloudflare Tunnel
5. Cloning the repo + filling in `.env`
6. Running `docker compose up`
7. Completing the first-run setup wizard at `/admin/setup`
8. Connecting Claude.ai or another MCP client
9. Troubleshooting common issues

If you already know the moving parts, the short version is:

```sh
git clone https://github.com/npab19/cw-manage-mcp.git
cd cw-manage-mcp
cp .env.example .env
# edit .env — fill in CW credentials, POSTGRES_PASSWORD, ADMIN_EMAILS, OAUTH_*, etc.
docker compose up --build -d
docker compose logs cw-manage-mcp | tail -30   # find the bootstrap URL
# Visit the bootstrap URL printed in the logs to complete setup
```

A pre-built image is published to GitHub Container Registry on every push to `master`:

```sh
docker pull ghcr.io/npab19/cw-manage-mcp:latest
```

<p align="right">(<a href="#readme-top">back to top</a>)</p>

---

## Usage

### Connecting Claude.ai

1. **claude.ai** → Profile → **Settings** → **Integrations** → **Add integration**
2. Paste the MCP URL — no query parameters:
   ```
   https://cw-mcp.yourdomain.com/mcp
   ```
3. Save. Claude walks the OAuth flow against your IdP, then lists the tools your account is granted.

### Example — list open tickets on a specific board

```json
{
  "tool": "get_service_tickets",
  "arguments": {
    "conditions": "board/name=\"Service Desk\" and closedFlag=false",
    "orderBy": "lastUpdated desc",
    "pageSize": 50
  }
}
```

### Example — get a member's time entries this month

```json
{
  "tool": "get_time_entries",
  "arguments": {
    "conditions": "member/identifier=\"jsmith\" and timeStart>[2026-05-01T00:00:00Z]",
    "orderBy": "timeStart desc"
  }
}
```

### Testing with MCP Inspector

```sh
npx @modelcontextprotocol/inspector "https://cw-mcp.yourdomain.com/mcp"
```

The Inspector walks the OAuth flow on first connect.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

---

## Roadmap

- [x] Read-only tools for core CW modules (service, company, finance, time, project, system, schedule, sales)
- [x] Expense, Procurement, Marketing, Webhook tool modules
- [x] Composite reporting tools for MSP workflows
- [x] MCP prompts library
- [x] Docker + Cloudflare Tunnel deployment
- [x] OAuth 2.1 (Resource Server + Authorization Server proxy)
- [x] Admin dashboard with setup wizard, settings, MCP audit log
- [x] Auto-publish Docker image to GHCR
- [x] CW user import + permission mirroring (per-role tool allow-lists)
- [x] Layered context documents (global / per-role / per-user) as MCP resources + `get_context` tool
- [x] Managed content (board aliases, company exclusions)
- [x] Service-account API keys for CI / n8n / custom integrations
- [x] Caching, per-user rate limiting, nightly Postgres backups, admin Health page

See [open issues](https://github.com/npab19/cw-manage-mcp/issues) for proposed features and known issues.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

---

## Contributing

Contributions welcome. Fork, branch, commit, PR:

1. Fork the project
2. `git checkout -b feature/your-feature`
3. `git commit -m 'Add your feature'`
4. `git push origin feature/your-feature`
5. Open a Pull Request

<p align="right">(<a href="#readme-top">back to top</a>)</p>

---

## License

MIT. See `LICENSE`.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

---

## Acknowledgments

* [Model Context Protocol](https://modelcontextprotocol.io)
* [ConnectWise Manage REST API](https://developer.connectwise.com)
* [Best-README-Template](https://github.com/othneildrew/Best-README-Template)
* [Img Shields](https://shields.io)
* [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/)

<p align="right">(<a href="#readme-top">back to top</a>)</p>

---

<!-- MARKDOWN LINKS & IMAGES -->
[contributors-shield]: https://img.shields.io/github/contributors/npab19/cw-manage-mcp.svg?style=for-the-badge
[contributors-url]: https://github.com/npab19/cw-manage-mcp/graphs/contributors
[forks-shield]: https://img.shields.io/github/forks/npab19/cw-manage-mcp.svg?style=for-the-badge
[forks-url]: https://github.com/npab19/cw-manage-mcp/network/members
[stars-shield]: https://img.shields.io/github/stars/npab19/cw-manage-mcp.svg?style=for-the-badge
[stars-url]: https://github.com/npab19/cw-manage-mcp/stargazers
[issues-shield]: https://img.shields.io/github/issues/npab19/cw-manage-mcp.svg?style=for-the-badge
[issues-url]: https://github.com/npab19/cw-manage-mcp/issues
[license-shield]: https://img.shields.io/github/license/npab19/cw-manage-mcp.svg?style=for-the-badge
[license-url]: https://github.com/npab19/cw-manage-mcp/blob/main/LICENSE
