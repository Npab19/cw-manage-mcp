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
import { runMigrations } from './migrations/runner.js';
import { pingDb } from './db.js';
import { getCwConnection } from './config.js';
import { buildAdminRouter, ADMIN_VIEWS_DIR } from './admin/router.js';

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

function createServer(ctx: CwRequestContext): McpServer {
  const server = new McpServer({
    name: 'cw-manage-mcp',
    version: '1.0.0',
  });

  serviceTools.register(server, ctx);
  companyTools.register(server, ctx);
  financeTools.register(server, ctx);
  timeTools.register(server, ctx);
  projectTools.register(server, ctx);
  systemTools.register(server, ctx);
  scheduleTools.register(server, ctx);
  salesTools.register(server, ctx);
  reportingTools.register(server, ctx);
  expenseTools.register(server, ctx);
  procurementTools.register(server, ctx);
  marketingTools.register(server, ctx);
  webhookTools.register(server, ctx);
  describeTool.register(server, ctx);
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
  const server = createServer(ctx);
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

app.post('/mcp', oauthMiddleware, async (req, res) => handleMcpRequest(req, res, req.body));
app.get('/mcp', oauthMiddleware, async (req, res) => handleMcpRequest(req, res));
app.delete('/mcp', oauthMiddleware, async (req, res) => handleMcpRequest(req, res));

const port = parseInt(process.env.PORT ?? '3000', 10);

async function start(): Promise<void> {
  if (process.env.DATABASE_URL) {
    await pingDb();
    await runMigrations();
  } else {
    console.warn('DATABASE_URL not set — running without the dashboard DB (legacy mode).');
  }
  app.listen(port, () => {
    console.log(`CW Manage MCP server listening on http://localhost:${port}/mcp`);
    console.log(`Base URL: ${process.env.CW_BASE_URL}/${process.env.CW_CODEBASE}/apis/3.0`);
    if (isOAuthConfigured()) {
      console.log(`OAuth metadata: ${process.env.PUBLIC_BASE_URL}${PROTECTED_RESOURCE_METADATA_PATH}`);
    }
  });
}

start().catch((err) => {
  console.error('Startup failed:', err);
  process.exit(1);
});
