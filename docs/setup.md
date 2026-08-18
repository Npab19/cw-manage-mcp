# First-time setup guide

This guide walks you through deploying CW Manage MCP from scratch — from gathering credentials to connecting Claude.ai. Plan for **30–60 minutes** of focused work, assuming the prerequisites below are in place.

## What you'll have at the end

- A running MCP server reachable at `https://your-domain.com/mcp` (via Cloudflare Tunnel — no inbound firewall ports opened).
- An admin dashboard at `https://your-domain.com/admin` with Settings, MCP audit log, Users (with OAuth↔CW mapping), Permissions (per-CW-role tool allow-lists), Context (layered global/role/user docs), Aliases, Exclusions, Service Accounts, Health, and Backups.
- Users sign in with their corporate email via your OAuth IdP. The MCP issues its own JWTs to clients; CW API credentials never leave the server.
- Each user's tool surface is filtered by their CW security role — admins see everything, non-admins see only what their CW role allows.
- Claude.ai (or any MCP-compatible client) can connect with the integration URL alone — no API keys to paste.

## Prerequisites

| Need | Details |
|---|---|
| **Docker** | Docker Engine 24+ and Docker Compose v2. [Install Docker](https://docs.docker.com/get-docker/) |
| **ConnectWise Manage admin access** | You need to create an API Member and generate API keys. |
| **ConnectWise Developer Network account** | For the Client ID GUID. [Register](https://developer.connectwise.com/ClientID) (free). |
| **OAuth IdP** | Microsoft Entra ID is the documented path. Google Workspace and Okta also work with minor changes. |
| **Public domain name** | Subdomain dedicated to this server, e.g. `cwmcp.yourcompany.com`. |
| **Cloudflare account** | For the Cloudflare Tunnel sidecar (free tier is fine). |
| **A terminal + git** | For cloning the repo. |

If you're missing any of these, finish that step elsewhere before continuing — the guide below assumes they're ready.

---

## Step 1 — Generate ConnectWise credentials

You'll capture **four** values: a Client ID, a Company ID, a Public Key, and a Private Key.

### 1a. Register a Client ID

1. Sign in to [developer.connectwise.com/ClientID](https://developer.connectwise.com/ClientID).
2. Click **Create** → fill in the form. Name it something recognizable (e.g. `cwmcp-prod`).
3. After save, copy the **GUID** — this is your `CW_CLIENT_ID`.

The Client ID is a free, one-time registration that identifies your integration to ConnectWise. It never expires and is per-organization, not per-deployment.

### 1b. Create a CW API Member

The MCP authenticates to ConnectWise as an API Member — a non-interactive service account, distinct from human technician accounts.

1. In ConnectWise Manage: **System** → **Members** → **API Members** tab.
2. Click **+** to create a new API Member.
3. Fill in:
   - **Member ID**: `mcp-server` (or similar — this isn't shown to users)
   - **Member Name**: `MCP Server`
   - **Role ID**: Pick a security role that grants read access to the modules you need (Service, Company, Finance, Time, Project, System, Schedule, Sales). For the broadest access, **Admin** works; for least-privilege, create a custom role with read-only permissions on those modules.
   - **Location**, **Business Unit**, **Department**: match your tenant.
4. Save.

> The MCP is currently read-only, so an Admin role is functionally equivalent to a least-privilege read-only role. Because per-user permission mirroring is now active, the API Member's role becomes the *ceiling* of what any user can do — pick something permissive here. Per-user filtering happens on top, derived from each user's own CW security role.

### 1c. Generate the API keypair

1. Open the API Member you just created.
2. **API Keys** tab → **+** → enter a description (e.g. `cwmcp-prod-keys`).
3. Save. The dialog shows the **Public Key** and **Private Key** *once*.
4. Copy both. The Private Key cannot be retrieved later — if you lose it, generate a new pair.

### 1d. Capture the Company ID

Your **Company ID** is the short identifier you use to log in to ConnectWise Manage (e.g. `acme` if your portal URL is `https://acme.myconnectwise.net`). Not your full company name.

You now have:

- `CW_CLIENT_ID` — the GUID from 1a
- `CW_COMPANY_ID` — your portal identifier from 1d
- `CW_PUBLIC_KEY` — from 1c
- `CW_PRIVATE_KEY` — from 1c

Set these aside — they go into `.env` later.

---

## Step 2 — Register an OAuth application

This guide walks through **Microsoft Entra ID**. If you're using a different IdP, the principle is the same: register an app, set the redirect URI, and capture the issuer URL, client ID, and client secret.

### 2a. Pick your public URL

Decide on the domain that will host the MCP. Common pattern: a subdomain dedicated to this service, like `cwmcp.yourcompany.com`. You'll use it as `PUBLIC_BASE_URL`. The OAuth callback URL will be `${PUBLIC_BASE_URL}/oauth/callback`.

For this guide we'll use `https://cwmcp.example.com` as the placeholder — substitute your domain.

### 2b. Create an App Registration in Entra ID

1. In the [Azure portal](https://portal.azure.com), search for **Microsoft Entra ID**.
2. **App registrations** → **New registration**.
3. Fill in:
   - **Name**: `CW Manage MCP` (or similar)
   - **Supported account types**: **Accounts in this organizational directory only** (single-tenant)
   - **Redirect URI**: select **Web**, enter `https://cwmcp.example.com/oauth/callback`
4. Click **Register**.

### 2c. Capture the issuer URL and client ID

On the app's **Overview** page:

- Copy **Application (client) ID** → `OAUTH_CLIENT_ID`
- Copy **Directory (tenant) ID** → use it to build the issuer URL:
  ```
  https://login.microsoftonline.com/<tenant-id>/v2.0
  ```
  This is `OAUTH_ISSUER`.

### 2d. Generate a client secret

1. **Certificates & secrets** → **Client secrets** → **+ New client secret**.
2. Description: `cwmcp-prod`. Expiry: 24 months (or your org policy).
3. Click **Add**. **Copy the secret VALUE** (not the ID) immediately — Azure shows it once.
4. That value is `OAUTH_CLIENT_SECRET`.

### 2e. Confirm the redirect URI

Back on **Authentication**, verify that `https://cwmcp.example.com/oauth/callback` is listed under **Web → Redirect URIs**. Add it if missing.

### 2f. Decide on allowed email domains

`OAUTH_ALLOWED_EMAIL_DOMAINS` is a comma-separated list of email domains whose users may authenticate. Typically your own domain:

```
OAUTH_ALLOWED_EMAIL_DOMAINS=yourcompany.com
```

If you have partners or guests with different domains who should also be allowed:

```
OAUTH_ALLOWED_EMAIL_DOMAINS=yourcompany.com,partner.com
```

This is checked against the `email` claim in the IdP token. Users from other domains get a clean 403, not a confusing error.

---

## Step 3 — Set up the Cloudflare Tunnel

The compose stack runs a `cloudflared` sidecar so the MCP is reachable at your public URL without opening any inbound firewall ports on your host.

### 3a. Create a tunnel

1. Sign in to [Cloudflare Zero Trust](https://one.dash.cloudflare.com).
2. **Networks** → **Tunnels** → **Create a tunnel** → choose **Cloudflared**.
3. Name it `cwmcp-prod` (or similar) → **Save tunnel**.
4. On the next screen, copy the **tunnel token** — long base64-looking string. This is `CLOUDFLARE_TUNNEL_TOKEN`.

### 3b. Configure the public hostname

Still on the tunnel page → **Public Hostname** tab → **Add a public hostname**:

- **Subdomain**: `cwmcp`
- **Domain**: select your registered domain
- **Service**: `http://cw-manage-mcp:3000`

> The service URL points at the MCP container by its compose service name (`cw-manage-mcp`), not localhost — cloudflared and the MCP are both inside the compose network and resolve each other by service name.

Save.

### 3c. Verify DNS

Cloudflare automatically creates a CNAME for the subdomain. Verify in your domain's DNS settings that `cwmcp` resolves to `*.cfargotunnel.com`.

---

## Step 4 — Set up your deployment directory

You only need **two files** on disk: `docker-compose.yml` and `.env`. No repo clone, no source code. The MCP itself ships as a prebuilt Docker image from GitHub Container Registry.

### 4a. Create a directory

```sh
mkdir cw-manage-mcp && cd cw-manage-mcp
```

### 4b. Get `docker-compose.yml`

Download it from the repo:

```sh
curl -O https://raw.githubusercontent.com/npab19/cw-manage-mcp/master/docker-compose.yml
```

If `curl` isn't available, open [the file on GitHub](https://github.com/npab19/cw-manage-mcp/blob/master/docker-compose.yml), click **Raw**, and save the content as `docker-compose.yml` in your directory.

### 4c. Create `.env`

You only need **four required values** in `.env`. The setup wizard collects OAuth and CW credentials at first run, so those are optional here — the wizard pre-fills any values you do set, otherwise it asks for them when you visit `/admin/setup`.

Save this minimum template as `.env` in the same directory (next to `docker-compose.yml`):

```bash
# Generate via openssl/PowerShell — see step 4d
POSTGRES_PASSWORD=change-me

# From step 3a
CLOUDFLARE_TUNNEL_TOKEN=your-tunnel-token-here

# Public URL (no trailing slash). Must match the Cloudflare Tunnel hostname.
PUBLIC_BASE_URL=https://cwmcp.example.com

# Permanent admin allow-list (break-glass). Comma-separated.
ADMIN_EMAILS=you@yourcompany.com
```

That's it — go on to step 4d.

**Want to skip the wizard form-filling?** Optionally add OAuth (step 2) and CW credentials (step 1) to `.env` too — the wizard will pre-fill them. See [`.env.example`](https://github.com/npab19/cw-manage-mcp/blob/master/.env.example) in the repo for the full list of pre-fill vars and any advanced overrides.

Alternative — download the full template:

```sh
curl -o .env https://raw.githubusercontent.com/npab19/cw-manage-mcp/master/.env.example
```

### 4d. Generate `POSTGRES_PASSWORD`

Pick anything cryptographically random. Example one-liners:

```sh
# Linux/macOS
openssl rand -base64 32

# PowerShell
[System.Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Maximum 256 }) -as [byte[]])
```

Paste the output as the `POSTGRES_PASSWORD` value in `.env`.

### 4e. Sanity-check `.env`

Common mistakes to avoid:

- ❌ Trailing slash on `PUBLIC_BASE_URL` (or `CW_BASE_URL` if you set it as a pre-fill) — both must have **no trailing slash**.
- ❌ Quotes around values — Docker Compose handles quoting; don't add `"..."`.
- ❌ Wrapping the tenant ID in `{...}` from Microsoft docs — strip the curly braces.
- ❌ Spaces around `=` — `KEY=value`, not `KEY = value`.

Your directory should now contain exactly two files:

```sh
ls -la
# docker-compose.yml
# .env
```

---

## Step 5 — Start the stack

```sh
docker compose up -d
```

First start pulls the MCP image from GitHub Container Registry, plus Postgres and cloudflared, then brings everything up. Takes 1–2 minutes depending on network.

### 5a. Watch for the bootstrap URL

The MCP prints a one-time bootstrap URL to its logs on first start (when no setup has been completed yet):

```sh
docker compose logs cw-manage-mcp | tail -50
```

Look for a block like:

```
======================================================================

  SETUP REQUIRED

  Visit this URL to complete first-time setup:

    https://cwmcp.example.com/admin/setup?code=<32-char-hex>

  This code is valid for one setup attempt and rotates if the
  container restarts before setup completes.

======================================================================
```

Copy the full URL — code included.

> If the bootstrap block is buried, run `docker compose logs cw-manage-mcp | grep -A 12 "SETUP REQUIRED"` to isolate it. The code rotates on every container restart that happens before setup is completed, so don't restart between copying and submitting.

### 5b. Verify the stack is healthy

```sh
docker compose ps
```

You should see all four services up:

- `cw-manage-mcp` — healthy (after ~30s)
- `postgres` — healthy
- `backup` — running (it sleeps between daily backups)
- `cloudflared` — running

If `cw-manage-mcp` is unhealthy, check `docker compose logs cw-manage-mcp` for errors — most often a missing or malformed env var.

---

## Step 6 — Complete the setup wizard

### 6a. Visit the bootstrap URL

Paste the URL from step 5a into your browser. You should see the **Setup** wizard.

### 6b. Walk the wizard

The wizard collects three things (any values you set in `.env` are pre-filled — see step 4c):

1. **OAuth provider** — `OAUTH_ISSUER`, `OAUTH_CLIENT_ID`, `OAUTH_CLIENT_SECRET`, `OAUTH_ALLOWED_EMAIL_DOMAINS` from step 2.
2. **First admin email** — gets added to the dashboard's DB-managed admin list, on top of `ADMIN_EMAILS` from `.env`. Pre-filled from `ADMIN_EMAILS` if set.
3. **CW connection** — `CW_CLIENT_ID`, `CW_BASE_URL`, `CW_CODEBASE`, `CW_COMPANY_ID`, `CW_PUBLIC_KEY`, `CW_PRIVATE_KEY` from step 1.

**Click "Test connection"** before completing — should return a success banner with your CW version + cloud status. If it fails, fix the credentials in the form and retry.

Click **Complete setup**.

### 6c. Bootstrap code rotates

After completing setup, the bootstrap URL is permanently disabled. If you ever need to re-arm it (recovery scenario), see [Troubleshooting → Lost all admins](#lost-all-admins).

### 6d. Sign in as admin

You're redirected to `/admin`. The first sign-in walks the OAuth flow against your IdP. Use the email you set in `ADMIN_EMAILS`.

If you see a 403 page, double-check that:

- Your IdP login uses the same email as `ADMIN_EMAILS` (case-insensitive).
- Your email's domain is in `OAUTH_ALLOWED_EMAIL_DOMAINS`.

---

## Step 7 — Connect Claude.ai

### 7a. Add the integration

1. Sign in to **claude.ai** with your **company email** (same one used for `ADMIN_EMAILS`).
2. **Profile** → **Settings** → **Integrations** → **Add integration**.
3. Paste the MCP URL — **no query parameters, no path beyond `/mcp`**:
   ```
   https://cwmcp.example.com/mcp
   ```
4. Save. Claude.ai discovers the MCP's OAuth metadata automatically (no client ID or secret to paste on the Claude side) and opens a sign-in popup.

### 7b. Sign in

The popup redirects to your IdP. Sign in with the same account. Approve any consent prompts. The popup closes and Claude.ai reports the integration as connected.

### 7c. Try a tool

In a Claude chat, ask something like:

> "Using the ConnectWise tools, list the 10 most recently updated open tickets."

Claude should call `get_service_tickets` with appropriate conditions and return the results. If you see "no tools available" or an empty tool list, check that:

- Your OAuth account is **mapped to a CW member** in `/admin/users`. Auto-mapping by email is the default; if your IdP email doesn't match the CW member's email, link them manually.
- That CW member's **security role** has tools granted in `/admin/permissions`. Role-derived allow-lists are auto-seeded on import; admins can customize per-role.
- Admins always see every tool (no policy needed for admins).
- The integration shows as connected in Claude's Settings → Integrations.

---

## Troubleshooting

### `cw-manage-mcp` won't start / unhealthy

Run `docker compose logs cw-manage-mcp` and look for the error near the bottom:

- **Missing required env var** — the server logs which one. Check `.env` and re-run `docker compose up -d`.
- **Postgres connection refused** — the Postgres sidecar is still starting up. Wait 30 seconds and retry; this resolves once `postgres` reports healthy.
- **OAuth env vars inconsistent** — all five (`OAUTH_ISSUER`, `OAUTH_CLIENT_ID`, `OAUTH_CLIENT_SECRET`, `OAUTH_ALLOWED_EMAIL_DOMAINS`, `PUBLIC_BASE_URL`) must be set together.

### Bootstrap URL keeps changing

The code is in-memory only — it rotates on every container restart that happens before setup is completed. If you restart between copying and submitting, the URL with the old code becomes invalid. Solution: grab the new code from the logs.

### CW "Test connection" fails in the wizard

- Verify `CW_BASE_URL` matches your region (NA / EU / AU / Staging / On-Premise).
- Verify `CW_CODEBASE` is correct for your CW version (default `v2025_1`).
- Verify the API Member is **active** in CW and the keypair hasn't been revoked.
- Verify the API Member's role has read access on at least `/system/info` (which the Test button hits).

### 403 on `/admin` after OAuth sign-in

Your email isn't in the admin allow-list. Either:

- Add your email to `ADMIN_EMAILS` in `.env` and `docker compose restart cw-manage-mcp`, **or**
- Sign in with an account that is in `ADMIN_EMAILS`.

Existing admins can also promote/demote other admins inline from the Users page (`/admin/users`) without touching `.env`. `ADMIN_EMAILS` remains the break-glass recovery list if the DB-managed admins are all lost.

### Claude.ai integration won't connect

- Verify `PUBLIC_BASE_URL` matches the Cloudflare Tunnel hostname (no typos, no trailing slash).
- Open `https://cwmcp.example.com/.well-known/oauth-protected-resource` in a browser — it should return JSON. If you get 404 or a Cloudflare error, the tunnel isn't routing correctly.
- Check the redirect URI in your IdP App Registration is exactly `${PUBLIC_BASE_URL}/oauth/callback` — no extra path segments.

### Cloudflare Tunnel returns 502 / Bad Gateway

- The `cw-manage-mcp` container isn't healthy. Run `docker compose ps` — it should say healthy. If not, `docker compose logs cw-manage-mcp`.
- The tunnel's Public Hostname Service is set to `http://cw-manage-mcp:3000` (not `https`, not `localhost`).

### Lost all admins

If the entire `ADMIN_EMAILS` list is no longer accessible (employee left, typo, etc.), recover by re-arming the setup wizard:

```sh
# 1. Open a shell in the MCP container
docker compose exec cw-manage-mcp sh

# 2. Connect to Postgres
psql $DATABASE_URL

# 3. Reset setup state
UPDATE setup_state SET setup_completed_at = NULL WHERE id = 1;
\q

# 4. Update .env with the new admin email, then restart
docker compose restart cw-manage-mcp

# 5. Grab the new bootstrap URL from logs (see step 5a)
```

This is destructive only to the setup-completed flag; CW connection, OAuth provider, and audit log data remain intact. You'll see the wizard on the next visit to `/admin` — fill in the new admin email and complete.

### Postgres password rotation

```sh
docker compose down
# edit .env — change POSTGRES_PASSWORD to the new value
docker compose up -d
```

The Postgres data volume is preserved, but the password change requires a restart of all three services that connect to it.

### Cloudflare Tunnel token rotation

Cloudflare lets you delete and re-create the tunnel if you suspect token compromise:

1. In Zero Trust → Networks → Tunnels, delete the old tunnel (this also removes the DNS record).
2. Create a new tunnel, copy the new token, configure the public hostname the same way.
3. Update `CLOUDFLARE_TUNNEL_TOKEN` in `.env` and `docker compose restart cloudflared`.

---

## What's next

After completing setup, you have:

- An OAuth-authenticated MCP at `/mcp`
- An admin dashboard at `/admin` with:
  - **Settings** — CW connection, OAuth provider, and operational knobs (cache, rate limits, retention)
  - **MCP audit log** — every tool call recorded with user, tool, duration, status; CSV export
  - **Users** — imported CW members, OAuth identity mapping (auto by email; manual link UI for mismatches), inline admin promote/revoke
  - **Permissions** — per-CW-role tool allow-lists, auto-derived from CW security roles and editable inline
  - **Context** — layered markdown docs (global / per-role / per-user) exposed as MCP resources and via the `get_context` tool; versioned with rollback
  - **Aliases** — board name aliases and deprecated-board markers used by composite/reporting tools
  - **Exclusions** — globally-excluded companies hidden from list tools by default (override per-call with `include_excluded: true`)
  - **Service Accounts** — long-lived API keys for CI / n8n / custom integrations that bypass interactive OAuth
  - **Health** — in-process observability: process stats, cache hit rates, request latency, concurrency, error counts
  - **Backups** — nightly Postgres dumps written by the `backup` sidecar; on-demand run and download from the dashboard

Non-admin users now sign in and get a tool surface filtered to their CW security role's allow-list. Admins always see everything.

Future work tracked on the [roadmap](https://github.com/npab19/cw-manage-mcp#roadmap). Updates land via incremental upgrades — `docker compose pull && docker compose up -d` once a new image ships.

---

## Routine operations

- **Update to latest image:**
  ```sh
  docker compose pull
  docker compose up -d
  ```
- **Pin or roll back to an older image:**

  Every push to `master` publishes immutable tags next to `latest` — `sha-<short-commit>`
  (e.g. `sha-a1b2c3d`) and `build-<run-number>` (e.g. `build-42`). Released versions also
  get semver tags. Browse them at
  [the package page](https://github.com/npab19/cw-manage-mcp/pkgs/container/cw-manage-mcp).

  ```sh
  # in .env
  APP_IMAGE_TAG=build-41

  docker compose up -d      # pulls and restarts on the pinned tag
  ```

  Remove `APP_IMAGE_TAG` (or set it to `latest`) to resume tracking master. Rolling the
  image back does **not** roll back the database — if the version you're leaving applied a
  schema migration, restore a dump from the same era alongside it.

- **View logs:**
  ```sh
  docker compose logs -f cw-manage-mcp
  ```
- **Restart a single service:**
  ```sh
  docker compose restart cw-manage-mcp
  ```
- **Check MCP audit log:** browse to `/admin/audit-log` in the dashboard.

For deeper operational concerns (backup recovery, dashboard configuration, troubleshooting beyond this guide), see future docs (TBD as phases land).
