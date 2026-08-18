import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerAppResource, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';

export const BOARD_OVERVIEW_UI_RESOURCE_URI = 'ui://cw-manage-mcp/board-overview';

const HTML_PATH = path.join(import.meta.dirname, '../apps/board-overview/mcp-app.html');
let cachedHtml: Promise<string> | null = null;

function loadHtml(): Promise<string> {
  cachedHtml ??= readFile(HTML_PATH, 'utf-8');
  return cachedHtml;
}

export function registerBoardOverviewAppResource(server: McpServer): void {
  registerAppResource(
    server,
    'Board Overview',
    BOARD_OVERVIEW_UI_RESOURCE_URI,
    { description: 'Interactive bar chart of open ticket counts by status for a service board.' },
    async () => ({
      contents: [
        {
          uri: BOARD_OVERVIEW_UI_RESOURCE_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: await loadHtml(),
        },
      ],
    }),
  );
}
