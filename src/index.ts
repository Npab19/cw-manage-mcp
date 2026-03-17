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

const required = ['CW_CLIENT_ID', 'CW_BASE_URL', 'CW_CODEBASE'] as const;
for (const key of required) {
  if (!process.env[key]) {
    console.error(`Missing required environment variable: ${key}`);
    process.exit(1);
  }
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

const app = express();
app.use(express.json());

app.post('/mcp', async (req: Request, res: Response) => {
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
  await transport.handleRequest(req, res, req.body);
});

app.get('/mcp', async (req: Request, res: Response) => {
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
  await transport.handleRequest(req, res);
});

app.delete('/mcp', async (req: Request, res: Response) => {
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
  await transport.handleRequest(req, res);
});

const port = parseInt(process.env.PORT ?? '3000', 10);
app.listen(port, () => {
  console.log(`CW Manage MCP server listening on http://localhost:${port}/mcp`);
  console.log(`Base URL: ${process.env.CW_BASE_URL}/${process.env.CW_CODEBASE}/apis/3.0`);
});
