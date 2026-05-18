import 'dotenv/config';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express, { Request, Response } from 'express';
import cookieParser from 'cookie-parser';
import { CwRequestContext } from './types.js';

import * as serviceTools from './tools/service.js';
import * as companyTools from './tools/company.js';
import * as financeTools from './tools/finance.js';
import * as timeTools from './tools/time.js';
import * as projectTools from './tools/project.js';
import * as systemTools from './tools/system.js';
import * as scheduleTools from './tools/schedule.js';
import * as salesTools from './tools/sales.js';
import * as reportingTools from './tools/reporting.js';
import * as expenseTools from './tools/expense.js';
import * as procurementTools from './tools/procurement.js';
import * as marketingTools from './tools/marketing.js';
import * as webhookTools from './tools/webhook.js';
import * as describeTool from './tools/describe.js';
import * as contextTool from './tools/context.js';
import * as prompts from './prompts/index.js';

import {
  isOAuthConfigured,
  oauthMiddleware,
  registerOAuthRoutes,
  PROTECTED_RESOURCE_METADATA_PATH,
} from './oauth/index.js';
import { requestContextMiddleware } from './middleware/request-context.js';
import { auditCaptureMiddleware } from './middleware/audit-capture.js';
import { identityResolverMiddleware, type ResolvedIdentity } from './middleware/identity-resolver.js';
import { serviceAccountAuthMiddleware } from './middleware/service-account-auth.js';
import { gateServerWithPolicy } from './middleware/policy-gate.js';
import { runMigrations } from './migrations/runner.js';
import { pingDb } from './db.js';
import { getCwConnection, getOauthProvider } from './config.js';
import { buildAdminRouter, ADMIN_VIEWS_DIR } from './admin/router.js';
import { generateBootstrapCode } from './admin/auth.js';
import { printBootstrapBanner } from './admin/setup.js';
import { getSql } from './db.js';
import { startCron } from './cron.js';
import { registerContextResources } from './resources/context.js';
import { seedGlobalContextIfMissing } from './bootstrap/context-seed.js';
// @ts-expect-error -- express-ejs-layouts ships untyped, but it's a one-liner middleware.
import expressLayouts from 'express-ejs-layouts';

const required = ['CW_CLIENT_ID', 'CW_BASE_URL', 'CW_CODEBASE'] as const;

const SERVER_INSTRUCTIONS = [
  'This MCP server exposes ConnectWise Manage (CW) data — service tickets, companies, agreements, time entries, projects, members, schedule, sales, expense, procurement, marketing, and composite reporting tools.',
  '',
  'Before answering questions about CW data, call the `get_context` tool once to load org-specific context (which boards are active vs deprecated, who is on the team, business rules, integration accounts to ignore in reports, query patterns, common misunderstandings). The context is composed per-caller from global, role-specific, and user-specific layers.',
  '',
  'Hosts that support MCP resources can read the same content from the `context://current` resource (or the layered `context://global`, `context://role/<name>`, `context://user/<email>` URIs).',
].join('\n');

function createServer(ctx: CwRequestContext, identity: ResolvedIdentity | null): McpServer {
  const server = new McpServer(
    {
      name: 'cw-manage-mcp',
      version: '1.0.0',
    },
    {
      instructions: SERVER_INSTRUCTIONS,
    },
  );
  const gated = gateServerWithPolicy(server, identity);

  serviceTools.register(gated, ctx);
  companyTools.register(gated, ctx);
  financeTools.register(gated, ctx);
  timeTools.register(gated, ctx);
  projectTools.register(gated, ctx);
  systemTools.register(gated, ctx);
  scheduleTools.register(gated, ctx);
  salesTools.register(gated, ctx);
  reportingTools.register(gated, ctx);
  expenseTools.register(gated, ctx);
  procurementTools.register(gated, ctx);
  marketingTools.register(gated, ctx);
  webhookTools.register(gated, ctx);
  describeTool.register(gated, ctx);
  prompts.register(server);

  // get_context is universal — every authenticated caller gets their
  // own merged context regardless of the policy allow-list. Workaround
  // for hosts (Claude.ai) that don't yet read the MCP resources surface.
  contextTool.register(server, identity);

  // Context resources are not gated by the tool allow-list; access is
  // enforced per-resource at read time via assertReadAccess().
  registerContextResources(server, identity);

  return server;
}

async function handleMcpRequest(req: Request, res: Response, body?: unknown): Promise<void> {
  const conn = await getCwConnection();
  if (!conn || !conn.companyId || !conn.publicKey || !conn.privateKey) {
    res
      .status(503)
      .json({ error: 'CW connection is not configured. Complete the setup wizard at /admin/setup.' });
    return;
  }
  const server = createServer(conn, req.identity ?? null);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  res.on('close', () => {
    transport.close();
    server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, body);
}

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(requestContextMiddleware);

app.set('view engine', 'ejs');
app.set('views', ADMIN_VIEWS_DIR);
app.use(expressLayouts);
app.set('layout', 'layout');

app.use('/admin', buildAdminRouter());

app.get('/healthz', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

app.get('/readyz', async (_req, res) => {
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    res.status(503).json({ status: 'not_ready', missing });
    return;
  }
  const baseUrl = process.env.CW_BASE_URL!.replace(/\/$/, '');
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 5000);
  try {
    const resp = await fetch(baseUrl, { method: 'HEAD', signal: ac.signal });
    res.json({ status: 'ready', cw_reachable: true, cw_status: resp.status });
  } catch (err) {
    res
      .status(503)
      .json({ status: 'not_ready', cw_reachable: false, error: err instanceof Error ? err.message : String(err) });
  } finally {
    clearTimeout(timer);
  }
});

registerOAuthRoutes(app);

app.post('/mcp', serviceAccountAuthMiddleware, oauthMiddleware, identityResolverMiddleware, auditCaptureMiddleware, async (req, res) => handleMcpRequest(req, res, req.body));
app.get('/mcp', serviceAccountAuthMiddleware, oauthMiddleware, identityResolverMiddleware, auditCaptureMiddleware, async (req, res) => handleMcpRequest(req, res));
app.delete('/mcp', serviceAccountAuthMiddleware, oauthMiddleware, identityResolverMiddleware, auditCaptureMiddleware, async (req, res) => handleMcpRequest(req, res));

const port = parseInt(process.env.PORT ?? '3000', 10);

interface BootstrapState {
  required: boolean;
  code: string | null;
}

async function start(): Promise<void> {
  for (const key of required) {
    if (!process.env[key]) {
      console.error(`Missing required environment variable: ${key}`);
      process.exit(1);
    }
  }

  let bootstrap: BootstrapState = { required: false, code: null };
  if (process.env.DATABASE_URL) {
    await pingDb();
    await runMigrations();
    bootstrap = await initSetupState();
    if (!bootstrap.required) {
      await assertOauthConfigured();
      await startCron();
      await seedGlobalContextIfMissing();
    }
  } else {
    console.warn(
      'DATABASE_URL not set — Phase 2+ features (wizard, audit log viewer, users, permissions) are disabled.',
    );
    await assertOauthConfigured();
  }

  app.listen(port, () => {
    console.log(`CW Manage MCP server listening on http://localhost:${port}/mcp`);
    console.log(`Base URL: ${process.env.CW_BASE_URL}/${process.env.CW_CODEBASE}/apis/3.0`);
    if (isOAuthConfigured()) {
      console.log(`OAuth metadata: ${process.env.PUBLIC_BASE_URL}${PROTECTED_RESOURCE_METADATA_PATH}`);
    }
    if (bootstrap.required && bootstrap.code) {
      const host = process.env.PUBLIC_BASE_URL ?? `http://localhost:${port}`;
      printBootstrapBanner(host, bootstrap.code);
    }
  });
}

async function initSetupState(): Promise<BootstrapState> {
  const sql = getSql();
  const rows = await sql<{ setup_completed_at: Date | null }[]>`
    SELECT setup_completed_at FROM setup_state WHERE id = 1
  `;
  if (rows[0]?.setup_completed_at) return { required: false, code: null };
  const code = generateBootstrapCode();
  return { required: true, code };
}

/**
 * OAuth is required from Phase 3 onward. Accepts either env-var
 * configuration or a dashboard_settings.oauth_provider row.
 */
async function assertOauthConfigured(): Promise<void> {
  if (isOAuthConfigured()) return;
  if (process.env.DATABASE_URL) {
    const provider = await getOauthProvider();
    if (provider) return;
  }
  console.error(
    'OAuth is required. Either set OAUTH_ISSUER + OAUTH_CLIENT_ID + OAUTH_CLIENT_SECRET + ' +
      'OAUTH_ALLOWED_EMAIL_DOMAINS + PUBLIC_BASE_URL, or run /admin/setup to configure via the wizard, ' +
      'then restart.',
  );
  process.exit(1);
}

start().catch((err) => {
  console.error('Startup failed:', err);
  process.exit(1);
});
