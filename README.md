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
    <a href="#usage">View Usage Examples</a>
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
    <li>
      <a href="#about-the-project">About The Project</a>
      <ul>
        <li><a href="#built-with">Built With</a></li>
        <li><a href="#available-tools">Available Tools</a></li>
      </ul>
    </li>
    <li>
      <a href="#getting-started">Getting Started</a>
      <ul>
        <li><a href="#prerequisites">Prerequisites</a></li>
        <li><a href="#installation">Installation</a></li>
        <li><a href="#running-with-docker">Running with Docker</a></li>
        <li><a href="#pre-built-docker-image">Pre-built Docker Image</a></li>
        <li><a href="#cloudflare-tunnel">Cloudflare Tunnel</a></li>
      </ul>
    </li>
    <li><a href="#usage">Usage</a></li>
    <li><a href="#environment-variables">Environment Variables</a></li>
    <li><a href="#authentication">Authentication</a></li>
    <li><a href="#roadmap">Roadmap</a></li>
    <li><a href="#contributing">Contributing</a></li>
    <li><a href="#license">License</a></li>
    <li><a href="#acknowledgments">Acknowledgments</a></li>
  </ol>
</details>

---

<!-- ABOUT THE PROJECT -->
## About The Project

This MCP server exposes ConnectWise Manage data to AI assistants and automation pipelines through the [Model Context Protocol](https://modelcontextprotocol.io). It is **read-only** and **reporting-focused** — no records are created, modified, or deleted.

Key design decisions:

* **Credentials are passed via URL query parameters** — `companyId`, `publicKey`, and `privateKey` are included in the MCP server URL, so tools don't require credential arguments on every call. Multiple users can connect with different credentials by using different URLs.
* **Stateless Streamable HTTP transport** — compatible with any MCP client that supports HTTP.
* **Docker + Cloudflare Tunnel** — ship it anywhere without opening inbound firewall ports.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

### Built With

* [![TypeScript][TypeScript-shield]][TypeScript-url]
* [![Node.js][Node-shield]][Node-url]
* [![Docker][Docker-shield]][Docker-url]
* [![Cloudflare][Cloudflare-shield]][Cloudflare-url]

<p align="right">(<a href="#readme-top">back to top</a>)</p>

### Available Tools

80 tools across 9 modules — 70 single-endpoint tools plus 10 composite reporting tools:

#### Single-Endpoint Tools

| Module | Tools |
|--------|-------|
| **Service** | `get_service_tickets`, `get_service_ticket_by_id`, `get_service_ticket_notes`, `get_service_ticket_time_entries`, `get_service_ticket_tasks`, `get_service_ticket_count`, `get_service_ticket_configurations`, `get_service_ticket_documents`, `get_service_ticket_products`, `get_service_ticket_links`, `get_service_boards`, `get_service_board_statuses`, `get_service_board_types`, `get_service_board_subtypes`, `get_service_board_teams`, `get_service_priorities`, `get_service_slas`, `get_service_impacts`, `get_service_sources`, `get_service_severities`, `get_service_teams` |
| **Knowledge Base** | `get_knowledge_base_articles`, `get_knowledge_base_article_by_id`, `get_knowledge_base_categories`, `get_knowledge_base_subcategories` |
| **Surveys** | `get_service_surveys`, `get_service_survey_questions`, `get_service_survey_results` |
| **Company** | `get_companies`, `get_company_by_id`, `get_company_sites`, `get_company_notes`, `get_contacts`, `get_contact_by_id`, `get_contact_communications`, `get_contact_notes`, `get_company_configurations`, `get_company_configuration_by_id` |
| **Finance** | `get_agreements`, `get_agreement_by_id`, `get_agreement_additions`, `get_agreement_adjustments`, `get_agreement_sites`, `get_agreement_recap`, `get_agreement_types` |
| **Time** | `get_time_entries`, `get_time_entry_by_id`, `get_time_sheets`, `get_time_sheet_by_id`, `get_work_roles`, `get_work_types`, `get_charge_codes` |
| **Project** | `get_projects`, `get_project_by_id`, `get_project_phases`, `get_project_tickets`, `get_project_team_members`, `get_project_notes`, `get_project_statuses` |
| **System** | `get_members`, `get_member_by_id`, `get_member_skills`, `get_departments`, `get_audit_trail` |
| **Schedule** | `get_schedule_entries`, `get_schedule_entry_by_id`, `get_schedule_calendars` |
| **Sales** | `get_opportunities`, `get_opportunity_by_id`, `get_opportunity_forecast`, `get_opportunity_notes`, `get_sales_activities` |

All list tools support ConnectWise's full query syntax: `conditions`, `childConditions`, `customFieldConditions`, `orderBy`, `fields`, `page`, `pageSize`, and `pageId`.

#### Composite Reporting Tools

These tools combine multiple API calls into a single response, designed for MSP reporting workflows:

| Tool | Description |
|------|-------------|
| `get_ticket_summary` | Complete ticket view — ticket details, notes, time entries, and tasks in one call. Includes computed totals (hours logged, tasks completed). |
| `get_member_utilization` | Technician utilization report — logged hours vs scheduled hours for a date range, with utilization percentage. |
| `get_agreement_profitability` | Agreement financial overview — agreement details, additions, adjustments, and billing recap. |
| `get_board_overview` | Service board dashboard — board details, statuses, and open ticket counts per status. |
| `get_tech_skills_report` | Technician skills assessment — member profile, skills inventory, recent tickets, and time entries with computed summaries. |
| `get_recurring_issues_report` | Recurring issue analysis — groups closed tickets by type/subType over a date range, ranked by frequency with affected companies and avg resolution time. |
| `get_ticket_tone_analysis` | Ticket tone/sentiment data — ticket details plus all notes with word counts, timestamps, internal/external flags, and time gaps for AI-driven sentiment analysis. |
| `get_common_issues_by_company` | Per-company issue patterns — tickets grouped by type/subType with open vs closed ratios and frequency ranking. |
| `get_helpdesk_team_report` | Team performance report — per-member stats (tickets assigned/closed, hours logged, avg resolution time) plus top issue types. |
| `get_sla_compliance_report` | SLA compliance analysis — response and resolution times by priority vs SLA targets, with full SLA and priority definitions. |

Composite tools return partial results with an `_errors` array if any sub-call fails, so they never crash on a single API error.

### Available Prompts

10 MCP prompts provide pre-built AI workflows for common MSP tasks. Prompts guide the AI to call the right tools in the right order and compile results into structured reports.

#### Operational Prompts

| Prompt | Args | Description |
|--------|------|-------------|
| `daily_standup` | — | Morning briefing: open tickets by priority, SLA risks, time logging status, and action items. |
| `escalation_check` | — | Escalation checklist: SLA breaches, unassigned high-priority tickets, aging tickets, and stalled items. |
| `helpdesk_manager_weekly` | — | Comprehensive weekly report: team performance, ticket metrics, SLA compliance, recurring issues, and action items. |

#### Analysis Prompts

| Prompt | Args | Description |
|--------|------|-------------|
| `recurring_issue_analysis` | `boardName` (optional) | Pattern detection: top recurring issues, KB gap analysis, root cause categorization, and prevention recommendations. |
| `ticket_tone_review` | `ticketId` | Sentiment analysis: conversation tone timeline, frustration indicators, escalation risk level (LOW/MEDIUM/HIGH/CRITICAL), and recommended actions. |
| `common_issues_by_client` | `companyIdentifier` | Per-client issue patterns: anomaly detection vs baseline, one-off vs systemic classification, and prevention planning. |
| `sla_compliance_review` | — | SLA performance review: compliance rates, worst breaches, board comparison, and improvement recommendations. |

#### People Prompts

| Prompt | Args | Description |
|--------|------|-------------|
| `client_review` | `companyIdentifier` | Client health review: open tickets, agreement status, recent engagement, and account recommendations. |
| `tech_productivity` | `memberIdentifier` | Technician productivity report: utilization rate, ticket throughput, resolution time, and skills coverage. |
| `tech_skills_report` | `memberIdentifier` | Skills assessment: skill inventory, work profile analysis, skill gaps, and training recommendations. |

<p align="right">(<a href="#readme-top">back to top</a>)</p>

---

<!-- GETTING STARTED -->
## Getting Started

### Prerequisites

* [Docker](https://docs.docker.com/get-docker/) and Docker Compose
* A ConnectWise Manage API key pair ([how to create one](https://docs.connectwise.com/ConnectWise_Documentation/090/040/010/040))
* A ConnectWise Client ID ([register here](https://developer.connectwise.com/ClientID))

### Installation

1. Clone the repo
   ```sh
   git clone https://github.com/npab19/cw-manage-mcp.git
   cd cw-manage-mcp
   ```

2. Copy the environment template
   ```sh
   cp .env.example .env
   ```

3. Fill in your values in `.env` (see [Environment Variables](#environment-variables))

<p align="right">(<a href="#readme-top">back to top</a>)</p>

### Running with Docker

```sh
docker compose up --build
```

The server starts at `http://localhost:3000/mcp`.

To run in the background:
```sh
docker compose up --build -d
```

To stop:
```sh
docker compose down
```

> **Note:** When running with the Cloudflare Tunnel, the MCP server port is not published to the host — traffic flows only through the tunnel.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

### Pre-built Docker Image

A pre-built image is published to GitHub Container Registry on every push to `master`:

```sh
docker pull ghcr.io/npab19/cw-manage-mcp:latest
```

To use it in `docker-compose.yml` instead of building locally:

```yaml
services:
  cw-manage-mcp:
    image: ghcr.io/npab19/cw-manage-mcp:latest
    expose:
      - "3000"
    environment:
      - CW_CLIENT_ID=${CW_CLIENT_ID}
      - CW_BASE_URL=${CW_BASE_URL}
      - CW_CODEBASE=${CW_CODEBASE}
      - PORT=3000
    restart: unless-stopped
```

<p align="right">(<a href="#readme-top">back to top</a>)</p>

### Cloudflare Tunnel

The included `docker-compose.yml` runs a [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) sidecar that exposes the MCP server publicly without opening any inbound firewall ports.

1. Log in to [Cloudflare Zero Trust](https://one.dash.cloudflare.com) → **Networks** → **Tunnels** → **Create a tunnel**
2. Copy the tunnel token
3. Add it to `.env`:
   ```
   CLOUDFLARE_TUNNEL_TOKEN=your-tunnel-token-here
   ```
4. In the tunnel's **Public Hostname** settings, set the service to:
   ```
   http://cw-manage-mcp:3000
   ```
5. Start the stack — the tunnel service connects automatically:
   ```sh
   docker compose up --build -d
   ```

Your MCP server will be reachable at your configured Cloudflare hostname (e.g. `https://cw-mcp.yourdomain.com/mcp`).

<p align="right">(<a href="#readme-top">back to top</a>)</p>

---

<!-- USAGE -->
## Usage

### Connecting to the Server

The MCP server uses OAuth 2.1 — no credentials in the URL. Clients sign in through your IdP and the server validates a Bearer JWT on each request.

```
https://cw-mcp.yourdomain.com/mcp
```

CW connection credentials are configured server-side via the setup wizard at `/admin/setup` (first run only) or the Settings page (ongoing). Each MCP user's tool surface is derived from their CW security role's allow-list configured at `/admin/permissions`.

### Setting Up in Claude.ai

1. Go to **claude.ai** → Profile → **Settings** → **Integrations**
2. Click **Add integration**
3. Paste the MCP URL (no query parameters):
   ```
   https://cw-mcp.yourdomain.com/mcp
   ```
4. Save — Claude will run the OAuth flow against your IdP, then list the tools your CW role grants.

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

### Example — get all time entries for a member this month

```json
{
  "tool": "get_time_entries",
  "arguments": {
    "conditions": "member/identifier=\"jsmith\" and timeStart>[2024-03-01T00:00:00Z]",
    "orderBy": "timeStart desc"
  }
}
```

### Testing with MCP Inspector

```sh
npx @modelcontextprotocol/inspector "https://cw-mcp.yourdomain.com/mcp"
```

The Inspector will walk the OAuth flow against your IdP on first connect.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

---

<!-- ENVIRONMENT VARIABLES -->
## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `CW_CLIENT_ID` | Yes | Unique GUID identifying your integration. Register at [developer.connectwise.com](https://developer.connectwise.com/ClientID) |
| `CW_BASE_URL` | Yes | Base URL of your CW instance. Cloud NA: `https://api-na.myconnectwise.net` |
| `CW_CODEBASE` | Yes | API codebase version: `v4_6_release` |
| `PORT` | No | HTTP port (default: `3000`) |
| `CLOUDFLARE_TUNNEL_TOKEN` | No | Token for the Cloudflare Tunnel sidecar |

Cloud base URLs by region:

| Region | URL |
|--------|-----|
| North America | `https://api-na.myconnectwise.net` |
| Europe | `https://api-eu.myconnectwise.net` |
| Australia | `https://api-au.myconnectwise.net` |
| Staging | `https://api-staging.connectwisedev.com` |
| On-Premise | Your custom domain |

<p align="right">(<a href="#readme-top">back to top</a>)</p>

---

<!-- AUTHENTICATION -->
## Authentication

The server runs a full **OAuth 2.1 Authorization Server** to MCP clients and delegates the actual user login to an external IdP (Entra ID, Google, etc). The server mints its own RS256 JWTs that it validates on `/mcp`. **OAuth is required from Phase 3 onward** — the URL-query-parameter credential mode that earlier phases supported has been removed.

CW connection credentials, OAuth provider settings, and the admin allow-list are configured through the admin dashboard's setup wizard (or env vars for an unattended bootstrap).

### OAuth 2.1 (MCP server as Authorization Server)

Goal: **log in with your company email**. Configure the MCP server with your IdP's issuer + an App Registration's client ID/secret, and any user in your IdP whose email matches an allowed domain can authenticate. No per-user provisioning.

#### Why this design

The [MCP authorization spec](https://modelcontextprotocol.io/specification/draft/basic/authorization) requires clients to support Dynamic Client Registration ([RFC 7591](https://datatracker.ietf.org/doc/html/rfc7591)) so they can register themselves with the AS on the fly. Many enterprise IdPs (notably Microsoft Entra ID's Workforce tenants) don't expose DCR. To work around this, the MCP server acts as a proxy AS:

- To **MCP clients** (Claude.ai web, Claude Desktop's native remote connector, MCP Inspector): a full OAuth 2.1 AS with PKCE, DCR, JWKS, and refresh tokens.
- To **the IdP**: a normal confidential OAuth client (just like any web app).
- The MCP server brokers the auth code flow and mints its own RS256 JWTs for `/mcp` calls.

End-user experience is unchanged — they sign in with their company account at the IdP's login page. The MCP server is invisible plumbing.

#### Endpoints exposed when OAuth is on

- `GET /.well-known/oauth-protected-resource` — RFC 9728 metadata advertising this server as the AS.
- `GET /.well-known/oauth-authorization-server` — RFC 8414 metadata with endpoints below.
- `GET /.well-known/jwks.json` — the MCP server's public signing key (RS256).
- `POST /oauth/register` — DCR shim (RFC 7591). Returns a static public client_id for any incoming registration.
- `GET /oauth/authorize` — accepts the client's PKCE auth request, generates a new PKCE pair, and redirects the user to the IdP.
- `GET /oauth/callback` — receives the IdP's auth code, exchanges it for a token, validates the email domain, mints an MCP auth code, and redirects back to the client.
- `POST /oauth/token` — exchanges the MCP auth code (or refresh token) for an MCP-signed RS256 access token.

`/mcp` requests must carry `Authorization: Bearer <mcp-jwt>`. Validation steps:

1. Verify signature against this server's own JWKS.
2. Confirm `iss` and `aud` match `PUBLIC_BASE_URL`.
3. Confirm the `email` claim's domain is in `OAUTH_ALLOWED_EMAIL_DOMAINS`.

Failures return `401` with a `WWW-Authenticate` header pointing at `/.well-known/oauth-protected-resource` per [RFC 9728](https://datatracker.ietf.org/doc/html/rfc9728), or `403` when the token is valid but the email isn't in the allowed domain list.

#### Setup — Microsoft Entra ID

1. **Register an application** in your Azure tenant ([guide](https://learn.microsoft.com/entra/identity-platform/quickstart-register-app)).
2. Under **Authentication** → **Add a platform** → **Web**, add the redirect URI:
   ```
   ${PUBLIC_BASE_URL}/oauth/callback
   ```
   (e.g. `https://cwmcp.example.com/oauth/callback`)
3. Under **Certificates & secrets** → **New client secret**, generate a secret and copy the **Value** (only shown once).
4. Copy the **Application (client) ID** from the app's Overview page.
5. Fill in `.env`:

```bash
# .env
OAUTH_ISSUER=https://login.microsoftonline.com/<your-tenant-id>/v2.0
OAUTH_CLIENT_ID=<application-client-id>
OAUTH_CLIENT_SECRET=<client-secret-value>
OAUTH_ALLOWED_EMAIL_DOMAINS=yourcompany.com
PUBLIC_BASE_URL=https://cwmcp.example.com

# Server-side CW credentials (required when OAuth is enabled)
CW_COMPANY_ID=your-cw-company-id
CW_PUBLIC_KEY=your-cw-public-key
CW_PRIVATE_KEY=your-cw-private-key
```

6. `docker compose up --build -d` — first start generates and persists an RS256 keypair under the `oauth-keys` volume at `/data/oauth-keys.json`. Tokens issued before a key change remain valid until expiry; deleting the volume invalidates all live tokens.

In Claude.ai (or any MCP client), add the integration URL `https://cwmcp.example.com/mcp`. The client will discover the AS automatically, walk the user through Entra sign-in, and start calling tools — no client_id or redirect URI on the user's side.

#### Environment variables

| Var | Required | Description |
|---|---|---|
| `OAUTH_ISSUER` | When enabling OAuth | IdP issuer URL (no trailing slash). Used for OIDC discovery against the IdP. |
| `OAUTH_CLIENT_ID` | When enabling OAuth | Application (client) ID of the App Registration this server uses to authenticate against the IdP. |
| `OAUTH_CLIENT_SECRET` | When enabling OAuth | Client secret of the same App Registration. |
| `OAUTH_ALLOWED_EMAIL_DOMAINS` | When enabling OAuth | Comma-separated list of email domains allowed to authenticate (e.g. `acme.com,partner.com`). Case-insensitive. |
| `PUBLIC_BASE_URL` | When enabling OAuth | Public URL of this MCP server (no trailing slash). Used as the JWT issuer/audience and the basis for the OAuth callback URL. |
| `OAUTH_KEY_FILE` | No (default: `/data/oauth-keys.json`) | Path where the RS256 signing keypair is persisted. |
| `CW_COMPANY_ID` | When enabling OAuth | Server-side ConnectWise company ID. Replaces the URL-param `companyId` in OAuth mode. |
| `CW_PUBLIC_KEY` | When enabling OAuth | Server-side ConnectWise API public key. |
| `CW_PRIVATE_KEY` | When enabling OAuth | Server-side ConnectWise API private key. |

#### Error responses (both modes)

- `401` / `403` — credentials missing, invalid, or lack CW permission. With OAuth enabled, `401` includes a `WWW-Authenticate` header pointing at the discovery document.
- `404` — record not found.
- `429` — rate limit exceeded; the `Retry-After` value is surfaced to the caller.
- Other errors — original CW status code and response body are forwarded for debugging.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

---

<!-- ROADMAP -->
## Roadmap

- [x] Read-only tools for core reporting modules (service, company, finance, time, project, system, schedule, sales)
- [x] Docker + Cloudflare Tunnel deployment
- [x] Full pagination support (`page`, `pageSize`, `pageId`, `Link` header)
- [x] URL query parameter authentication (no per-tool credential arguments)
- [x] Composite reporting tools (ticket summary, utilization, agreement profitability, board overview, tech skills)
- [x] MCP prompts for MSP workflows (standup, client review, productivity, escalation, skills report)
- [x] Auto-publish Docker image to GHCR on push
- [x] Helpdesk manager tools (recurring issues, ticket tone analysis, team performance, SLA compliance)
- [x] Knowledge base, surveys, ticket sources, severities, board types/subtypes
- [x] Advanced prompts (weekly manager report, tone review, client issue analysis, SLA review)
- [ ] Expense module tools
- [ ] Procurement / catalog tools
- [ ] Marketing module tools
- [ ] Webhook/callback registration for real-time data

See the [open issues](https://github.com/npab19/cw-manage-mcp/issues) for a full list of proposed features and known issues.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

---

<!-- CONTRIBUTING -->
## Contributing

Contributions are welcome! If you'd like to add tools for additional CW modules or improve existing ones:

1. Fork the project
2. Create your feature branch (`git checkout -b feature/expense-tools`)
3. Commit your changes (`git commit -m 'Add expense module tools'`)
4. Push to the branch (`git push origin feature/expense-tools`)
5. Open a Pull Request

<p align="right">(<a href="#readme-top">back to top</a>)</p>

---

<!-- LICENSE -->
## License

Distributed under the MIT License. See `LICENSE` for more information.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

---

<!-- ACKNOWLEDGMENTS -->
## Acknowledgments

* [Model Context Protocol](https://modelcontextprotocol.io) — the open protocol that makes this possible
* [ConnectWise Manage REST API](https://developer.connectwise.com) — public API and documentation
* [Best-README-Template](https://github.com/othneildrew/Best-README-Template) — README structure
* [Img Shields](https://shields.io) — badge generation
* [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) — zero-config public exposure

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

[TypeScript-shield]: https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white
[TypeScript-url]: https://www.typescriptlang.org/
[Node-shield]: https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white
[Node-url]: https://nodejs.org/
[Docker-shield]: https://img.shields.io/badge/Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white
[Docker-url]: https://www.docker.com/
[Cloudflare-shield]: https://img.shields.io/badge/Cloudflare-F38020?style=for-the-badge&logo=cloudflare&logoColor=white
[Cloudflare-url]: https://www.cloudflare.com/
