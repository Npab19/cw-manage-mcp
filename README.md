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

55 GET-only tools across 8 ConnectWise modules:

| Module | Tools |
|--------|-------|
| **Service** | `get_service_tickets`, `get_service_ticket_by_id`, `get_service_ticket_notes`, `get_service_ticket_time_entries`, `get_service_ticket_tasks`, `get_service_boards`, `get_service_board_statuses`, `get_service_priorities`, `get_service_slas`, `get_service_impacts` |
| **Company** | `get_companies`, `get_company_by_id`, `get_company_sites`, `get_company_notes`, `get_contacts`, `get_contact_by_id`, `get_contact_communications`, `get_contact_notes`, `get_company_configurations`, `get_company_configuration_by_id` |
| **Finance** | `get_agreements`, `get_agreement_by_id`, `get_agreement_additions`, `get_agreement_adjustments`, `get_agreement_sites`, `get_agreement_recap`, `get_agreement_types` |
| **Time** | `get_time_entries`, `get_time_entry_by_id`, `get_time_sheets`, `get_time_sheet_by_id`, `get_work_roles`, `get_work_types`, `get_charge_codes` |
| **Project** | `get_projects`, `get_project_by_id`, `get_project_phases`, `get_project_tickets`, `get_project_team_members`, `get_project_notes`, `get_project_statuses` |
| **System** | `get_members`, `get_member_by_id`, `get_member_skills`, `get_departments`, `get_audit_trail` |
| **Schedule** | `get_schedule_entries`, `get_schedule_entry_by_id`, `get_schedule_calendars` |
| **Sales** | `get_opportunities`, `get_opportunity_by_id`, `get_opportunity_forecast`, `get_opportunity_notes`, `get_sales_activities` |

All list tools support ConnectWise's full query syntax: `conditions`, `childConditions`, `customFieldConditions`, `orderBy`, `fields`, `page`, `pageSize`, and `pageId`.

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

Credentials are passed as **URL query parameters** — not as tool arguments. Build your connection URL like this:

```
http://localhost:3000/mcp?companyId=mycompany&publicKey=abc123&privateKey=xyz789
```

Or via Cloudflare Tunnel:

```
https://cw-mcp.yourdomain.com/mcp?companyId=mycompany&publicKey=abc123&privateKey=xyz789
```

### Setting Up in Claude.ai

1. Go to **claude.ai** → Profile → **Settings** → **Integrations**
2. Click **Add integration**
3. Paste your full MCP URL (with query parameters):
   ```
   https://cw-mcp.yourdomain.com/mcp?companyId=mycompany&publicKey=abc123&privateKey=xyz789
   ```
4. Save — Claude will discover all 55 tools automatically

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
npx @modelcontextprotocol/inspector "http://localhost:3000/mcp?companyId=mycompany&publicKey=abc123&privateKey=xyz789"
```

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

Per-user credentials (`companyId`, `publicKey`, `privateKey`) are passed as **URL query parameters** on the MCP endpoint. The server extracts them on each HTTP request and constructs the ConnectWise Basic Auth header:

```
Authorization: Basic Base64(companyId+publicKey:privateKey)
```

If any credential query parameter is missing, the server returns HTTP `401` before processing the MCP message.

Credentials are **never** stored in server state, `.env`, or logs. They exist only for the duration of the HTTP request.

**Error responses:**
- `401` / `403` — returns a clear message indicating the credentials lack permission for that endpoint. Check the member's security role in CW Manage.
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
