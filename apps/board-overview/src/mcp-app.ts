import {
  App,
  applyDocumentTheme,
  applyHostFonts,
  applyHostStyleVariables,
  type McpUiHostContext,
} from '@modelcontextprotocol/ext-apps';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import './mcp-app.css';

interface TicketStatusCount {
  statusId: number;
  statusName: string;
  ticketCount: number;
}

interface ReportError {
  label: string;
  message: string;
  severity: 'warning' | 'error';
}

interface BoardOverviewData {
  board?: { name?: string } | null;
  ticketsByStatus?: TicketStatusCount[];
  totalOpenTickets?: number;
  _errors?: ReportError[];
}

const nameEl = document.getElementById('board-name')!;
const totalEl = document.getElementById('board-total')!;
const errorsEl = document.getElementById('errors')!;
const chartEl = document.getElementById('chart')!;

function extractData(result: CallToolResult): BoardOverviewData {
  const block = result.content?.find((b) => b.type === 'text') as { text?: string } | undefined;
  if (!block?.text) return {};
  try {
    return JSON.parse(block.text) as BoardOverviewData;
  } catch {
    return {};
  }
}

function render(data: BoardOverviewData): void {
  nameEl.textContent = data.board?.name ?? 'Board overview';
  totalEl.textContent = `${data.totalOpenTickets ?? 0} open ticket${data.totalOpenTickets === 1 ? '' : 's'}`;

  const errors = data._errors ?? [];
  if (errors.length > 0) {
    errorsEl.hidden = false;
    errorsEl.textContent = errors.map((e) => `${e.label}: ${e.message}`).join(' · ');
  } else {
    errorsEl.hidden = true;
  }

  const rows = [...(data.ticketsByStatus ?? [])].sort((a, b) => b.ticketCount - a.ticketCount);
  chartEl.innerHTML = '';
  if (rows.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = 'No open tickets on this board.';
    chartEl.appendChild(empty);
    return;
  }

  const max = Math.max(...rows.map((r) => r.ticketCount), 1);
  for (const row of rows) {
    const rowEl = document.createElement('div');
    rowEl.className = 'chart-row';

    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = row.statusName;
    label.title = row.statusName;

    const track = document.createElement('div');
    track.className = 'bar-track';
    const fill = document.createElement('div');
    fill.className = 'bar-fill';
    fill.style.width = `${Math.max((row.ticketCount / max) * 100, 2)}%`;
    track.appendChild(fill);

    const count = document.createElement('span');
    count.className = 'count';
    count.textContent = String(row.ticketCount);

    rowEl.append(label, track, count);
    chartEl.appendChild(rowEl);
  }
}

function applyHostContext(ctx: McpUiHostContext): void {
  if (ctx.theme) applyDocumentTheme(ctx.theme);
  if (ctx.styles?.variables) applyHostStyleVariables(ctx.styles.variables);
  if (ctx.styles?.css?.fonts) applyHostFonts(ctx.styles.css.fonts);
}

const app = new App({ name: 'Board Overview', version: '1.0.0' });

app.ontoolresult = (result) => render(extractData(result));
app.ontoolcancelled = () => {
  nameEl.textContent = 'Cancelled';
};
app.onerror = console.error;
app.onhostcontextchanged = applyHostContext;

app.connect().then(() => {
  const ctx = app.getHostContext();
  if (ctx) applyHostContext(ctx);
});
