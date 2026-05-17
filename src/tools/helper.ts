import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ToolResult } from '../types.js';

export type Schema = Record<string, z.ZodTypeAny>;

export function addTool(
  server: McpServer,
  name: string,
  description: string,
  schema: Schema,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: (args: Record<string, any>) => Promise<ToolResult>
): void {
  // Bypasses TS2589 ("type instantiation too deep") that fires when the SDK's
  // tool() type composes large spread zod schemas. Runtime validation is unaffected.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (server as any).tool(name, description, schema, handler);
}

export function escapeConditionLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

export function idSchema(label: string): z.ZodNumber {
  return z.number().int().min(1).describe(label);
}

type EntityHint =
  | 'ticket'
  | 'company'
  | 'contact'
  | 'agreement'
  | 'time-entry'
  | 'member'
  | 'schedule-entry'
  | 'opportunity'
  | 'project';

interface HintExamples {
  conditions: string;
  orderBy: string;
}

const HINT_EXAMPLES: Record<EntityHint, HintExamples> = {
  ticket: { conditions: '"closedFlag=false"', orderBy: '"lastUpdated desc"' },
  company: { conditions: '"status/name=\'Active\'"', orderBy: '"name asc"' },
  contact: { conditions: '"firstName=\'Jane\'"', orderBy: '"lastName asc"' },
  agreement: { conditions: '"agreementStatus=\'Active\'"', orderBy: '"startDate desc"' },
  'time-entry': { conditions: '"member/identifier=\'jsmith\'"', orderBy: '"timeStart desc"' },
  member: { conditions: '"identifier=\'jsmith\'"', orderBy: '"identifier asc"' },
  'schedule-entry': {
    conditions: '"dateStart>[2024-01-01T00:00:00Z]"',
    orderBy: '"dateStart asc"',
  },
  opportunity: { conditions: '"stage/name=\'Open\'"', orderBy: '"expectedCloseDate asc"' },
  project: { conditions: '"status/name=\'Open\'"', orderBy: '"name asc"' },
};

const DEFAULT_HINT: HintExamples = {
  conditions: '"status/name=\'New\'"',
  orderBy: '"lastUpdated desc"',
};

export function buildPaginationSchema(entityHint?: EntityHint): Schema {
  const examples = entityHint ? HINT_EXAMPLES[entityHint] : DEFAULT_HINT;
  return {
    conditions: z
      .string()
      .optional()
      .describe(`Filter expression, e.g. ${examples.conditions}`),
    childConditions: z.string().optional().describe('Filter on child/array fields'),
    customFieldConditions: z.string().optional().describe('Filter on custom fields'),
    orderBy: z.string().optional().describe(`Sort expression, e.g. ${examples.orderBy}`),
    fields: z
      .string()
      .optional()
      .describe('Comma-separated field names to project (keeps responses small)'),
    page: z.number().int().min(1).optional().describe('Page number (starts at 1)'),
    pageSize: z
      .number()
      .int()
      .min(1)
      .max(1000)
      .optional()
      .describe('Records per page (max 1000)'),
    pageId: z
      .number()
      .int()
      .optional()
      .describe('Forward-only paging: start after this record ID'),
  };
}
