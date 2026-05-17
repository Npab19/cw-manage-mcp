import 'dotenv/config';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express, { Request, Response } from 'express';
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
import * as prompts from './prompts/index.js';

import {
  isOAuthConfigured,
  oauthMiddleware,
  protectedResourceMetadataHandler,
  PROTECTED_RESOURCE_METADATA_PATH,
} from './oauth.js';
import { requestContextMiddleware } from './middleware/request-context.js';

const required = ['CW_CLIENT_ID', 'CW_BASE_URL', 'CW_CODEBASE'] as const;
for (const key of required) {
  if (!process.env[key]) {
    console.error(`Missing required environment variable: ${key}`);
    process.exit(1);
  }
}

if (isOAuthConfigured()) {
  if (!process.env.OAUTH_AUDIENCE) {
    console.error('OAUTH_ISSUER is set but OAUTH_AUDIENCE is missing. Both are required when OAuth is enabled.');
    process.exit(1);
  }
  console.log(`OAuth enabled — issuer: ${process.env.OAUTH_ISSUER}, audience: ${process.env.OAUTH_AUDIENCE}`);
} else {
  console.warn('OAuth NOT configured — /mcp accepts URL-param credentials. Set OAUTH_ISSUER + OAUTH_AUDIENCE to enable bearer-token auth.');
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
  prompts.register(server);

  return server;
}

function extractCredentials(req: Request): CwRequestContext | null {
  const companyId = req.query.companyId as string | undefined;
  const publicKey = req.query.publicKey as string | undefined;
  const privateKey = req.query.privateKey as string | undefined;

  if (!companyId || !publicKey || !privateKey) {
    return null;
  }

  return { companyId, publicKey, privateKey };
}

async function handleMcpRequest(req: Request, res: Response, body?: unknown): Promise<void> {
  const ctx = extractCredentials(req);
  if (!ctx) {
    res.status(401).json({ error: 'Missing required query parameters: companyId, publicKey, privateKey' });
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
app.use(requestContextMiddleware);

app.get(PROTECTED_RESOURCE_METADATA_PATH, protectedResourceMetadataHandler);

app.post('/mcp', oauthMiddleware, async (req, res) => handleMcpRequest(req, res, req.body));
app.get('/mcp', oauthMiddleware, async (req, res) => handleMcpRequest(req, res));
app.delete('/mcp', oauthMiddleware, async (req, res) => handleMcpRequest(req, res));

const port = parseInt(process.env.PORT ?? '3000', 10);
app.listen(port, () => {
  console.log(`CW Manage MCP server listening on http://localhost:${port}/mcp`);
  console.log(`Base URL: ${process.env.CW_BASE_URL}/${process.env.CW_CODEBASE}/apis/3.0`);
  if (isOAuthConfigured()) {
    console.log(`OAuth metadata: http://localhost:${port}${PROTECTED_RESOURCE_METADATA_PATH}`);
  }
});
