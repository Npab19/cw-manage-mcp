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
import { gateServerWithPolicy } from './middleware/policy-gate.js';
import { runMigrations } from './migrations/runner.js';
import { pingDb } from './db.js';
import { getCwConnection } from './config.js';
import { buildAdminRouter, ADMIN_VIEWS_DIR } from './admin/router.js';
import { generateBootstrapCode } from './admin/auth.js';
import { printBootstrapBanner } from './admin/setup.js';
import { getSql } from './db.js';
// @ts-expect-error -- express-ejs-layouts ships untyped, but it's a one-liner middleware.
import expressLayouts from 'express-ejs-layouts';

const required = ['CW_CLIENT_ID', 'CW_BASE_URL', 'CW_CODEBASE'] as const;
for (const key of required) {
  if (!process.env[key]) {
    console.error(`Missing required environment variable: ${key}`);
    process.exit(1);
  }
}

if (isOAuthConfigured()) {
  const missingOauth = [
    'OAUTH_CLIENT_ID',
    'OAUTH_CLIENT_SECRET',
    'OAUTH_ALLOWED_EMAIL_DOMAINS',
    'PUBLIC_BASE_URL',
  ].filter((k) => !process.env[k]);
  if (missingOauth.length > 0) {
    console.error(
      `OAUTH_ISSUER is set but the following are missing: ${missingOauth.join(' + ')}. All are required when OAuth is enabled.`,
    );
    process.exit(1);
  }
  const missingCwCreds = ['CW_COMPANY_ID', 'CW_PUBLIC_KEY', 'CW_PRIVATE_KEY'].filter(
    (k) => !process.env[k],
  );
  if (missingCwCreds.length > 0) {
    console.error(
      `OAuth is enabled but server-side CW credentials are missing: ${missingCwCreds.join(' + ')}. All three are required when OAuth is on.`,
    );
    process.exit(1);
  }
  console.log(
    `OAuth enabled — issuer: ${process.env.OAUTH_ISSUER}, public base URL: ${process.env.PUBLIC_BASE_URL}, allowed email domains: ${process.env.OAUTH_ALLOWED_EMAIL_DOMAINS}`,
  );
} else {
  console.warn(
    'OAuth NOT configured — /mcp accepts URL-param credentials. Set OAUTH_ISSUER + OAUTH_CLIENT_ID + OAUTH_CLIENT_SECRET + OAUTH_ALLOWED_EMAIL_DOMAINS + PUBLIC_BASE_URL to enable bearer-token auth.',
  );
}

function createServer(ctx: CwRequestContext, identity: ResolvedIdentity | null): McpServer {
  const server = new McpServer({
    name: 'cw-manage-mcp',
    version: '1.0.0',
  });
  // Register tools through a proxy that drops tool() calls the
  // identity isn't allowed to use. Prompts and other methods pass
  // through unchanged.
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

  return server;
}

function extractCredentialsFromQuery(req: Request): CwRequestContext | null {
  const companyId = req.query.companyId as string | undefined;
  const publicKey = req.query.publicKey as string | undefined;
  const privateKey = req.query.privateKey as string | undefined;
  const baseUrl = process.env.CW_BASE_URL;
  const codebase = process.env.CW_CODEBASE;
  const clientId = process.env.CW_CLIENT_ID;

  if (!companyId || !publicKey || !privateKey || !baseUrl || !codebase || !clientId) {
    return null;
  }

  return { baseUrl, codebase, clientId, companyId, publicKey, privateKey };
}

async function handleMcpRequest(req: Request, res: Response, body?: unknown): Promise<void> {
  let ctx: CwRequestContext | null;
  if (isOAuthConfigured()) {
    const conn = await getCwConnection();
    if (!conn || !conn.companyId || !conn.publicKey || !conn.privateKey) {
      res.status(503).json({ error: 'CW connection is not configured. Complete the setup wizard at /admin/setup.' });
      return;
    }
    ctx = conn;
  } else {
    ctx = extractCredentialsFromQuery(req);
  }
  if (!ctx) {
    res
      .status(401)
      .json({ error: 'Missing required query parameters: companyId, publicKey, privateKey' });
    return;
  }
  const server = createServer(ctx, req.identity ?? null);
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

app.post('/mcp', oauthMiddleware, identityResolverMiddleware, auditCaptureMiddleware, async (req, res) => handleMcpRequest(req, res, req.body));
app.get('/mcp', oauthMiddleware, identityResolverMiddleware, auditCaptureMiddleware, async (req, res) => handleMcpRequest(req, res));
app.delete('/mcp', oauthMiddleware, identityResolverMiddleware, auditCaptureMiddleware, async (req, res) => handleMcpRequest(req, res));

const port = parseInt(process.env.PORT ?? '3000', 10);

interface BootstrapState {
  required: boolean;
  code: string | null;
}

async function start(): Promise<void> {
  let bootstrap: BootstrapState = { required: false, code: null };
  if (process.env.DATABASE_URL) {
    await pingDb();
    await runMigrations();
    bootstrap = await initSetupState();
  } else {
    console.warn('DATABASE_URL not set — running without the dashboard DB (legacy mode).');
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

start().catch((err) => {
  console.error('Startup failed:', err);
  process.exit(1);
});
