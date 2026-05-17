import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { handleToolCall } from '../client.js';
import { CwRequestContext } from '../types.js';
import { addTool } from './helper.js';

interface FieldDef {
  name: string;
  type: string;
  note?: string;
}

interface EntitySchema {
  entity: string;
  endpoint: string;
  description: string;
  fields: FieldDef[];
  exampleConditions: string[];
}

const ENTITY_SCHEMAS: Record<string, EntitySchema> = {
  ticket: {
    entity: 'ticket',
    endpoint: '/service/tickets',
    description: 'Service ticket (incident/request) tracked on a service board.',
    fields: [
      { name: 'id', type: 'number' },
      { name: 'summary', type: 'string', note: 'Short title' },
      { name: 'board', type: '{ id, name }' },
      { name: 'status', type: '{ id, name }' },
      { name: 'priority', type: '{ id, name }' },
      { name: 'company', type: '{ id, name, identifier }' },
      { name: 'site', type: '{ id, name }' },
      { name: 'contact', type: '{ id, name }' },
      { name: 'type', type: '{ id, name }' },
      { name: 'subType', type: '{ id, name }' },
      { name: 'item', type: '{ id, name }' },
      { name: 'severity', type: 'string' },
      { name: 'impact', type: 'string' },
      { name: 'closedFlag', type: 'boolean' },
      { name: 'closedDate', type: 'ISO datetime' },
      { name: 'dateEntered', type: 'ISO datetime' },
      { name: 'lastUpdated', type: 'ISO datetime' },
      { name: 'respondedDate', type: 'ISO datetime' },
      { name: 'resources', type: 'Array<{ id, name, identifier }>', note: 'Assigned members' },
      { name: 'sla', type: '{ id, name }' },
      { name: 'budgetHours', type: 'number' },
      { name: 'actualHours', type: 'number' },
    ],
    exampleConditions: [
      'closedFlag=false',
      'board/id=42',
      'priority/id<=2',
      'lastUpdated>[2025-01-01T00:00:00Z]',
    ],
  },
  company: {
    entity: 'company',
    endpoint: '/company/companies',
    description: 'Customer/vendor/prospect organization.',
    fields: [
      { name: 'id', type: 'number' },
      { name: 'name', type: 'string' },
      { name: 'identifier', type: 'string', note: 'Short code (often the account name)' },
      { name: 'status', type: '{ id, name }' },
      { name: 'types', type: 'Array<{ id, name }>' },
      { name: 'territory', type: '{ id, name }' },
      { name: 'market', type: '{ id, name }' },
      { name: 'phoneNumber', type: 'string' },
      { name: 'website', type: 'string' },
      { name: 'addressLine1', type: 'string' },
      { name: 'city', type: 'string' },
      { name: 'state', type: 'string' },
      { name: 'zip', type: 'string' },
      { name: 'country', type: '{ id, name }' },
      { name: 'dateAcquired', type: 'ISO datetime' },
      { name: 'annualRevenue', type: 'number' },
      { name: 'numberOfEmployees', type: 'number' },
      { name: 'defaultContact', type: '{ id, name }' },
    ],
    exampleConditions: [
      "status/name='Active'",
      "name contains 'Acme'",
      "types/name='Customer'",
    ],
  },
  contact: {
    entity: 'contact',
    endpoint: '/company/contacts',
    description: 'Person associated with a company.',
    fields: [
      { name: 'id', type: 'number' },
      { name: 'firstName', type: 'string' },
      { name: 'lastName', type: 'string' },
      { name: 'company', type: '{ id, name, identifier }' },
      { name: 'site', type: '{ id, name }' },
      { name: 'title', type: 'string' },
      { name: 'inactiveFlag', type: 'boolean' },
      { name: 'communicationItems', type: 'Array<{ type, value, communicationType }>', note: 'Phones/emails' },
      { name: 'defaultPhoneNbr', type: 'string' },
      { name: 'defaultEmail', type: 'string' },
    ],
    exampleConditions: [
      "company/id=123",
      "inactiveFlag=false",
      "lastName='Smith'",
    ],
  },
  member: {
    entity: 'member',
    endpoint: '/system/members',
    description: 'Internal staff member (technician, manager, etc.).',
    fields: [
      { name: 'id', type: 'number' },
      { name: 'identifier', type: 'string', note: 'Login username (e.g. "jsmith")' },
      { name: 'firstName', type: 'string' },
      { name: 'lastName', type: 'string' },
      { name: 'title', type: 'string' },
      { name: 'officeEmail', type: 'string' },
      { name: 'inactiveFlag', type: 'boolean' },
      { name: 'defaultDepartment', type: '{ id, name }' },
      { name: 'defaultLocation', type: '{ id, name }' },
      { name: 'workRole', type: '{ id, name }' },
      { name: 'workType', type: '{ id, name }' },
      { name: 'hireDate', type: 'ISO datetime' },
    ],
    exampleConditions: [
      "identifier='jsmith'",
      "inactiveFlag=false",
      "defaultDepartment/name='Service'",
    ],
  },
  agreement: {
    entity: 'agreement',
    endpoint: '/finance/agreements',
    description: 'Service/managed agreement between a company and the MSP.',
    fields: [
      { name: 'id', type: 'number' },
      { name: 'name', type: 'string' },
      { name: 'company', type: '{ id, name, identifier }' },
      { name: 'type', type: '{ id, name }' },
      { name: 'agreementStatus', type: 'string' },
      { name: 'startDate', type: 'ISO datetime' },
      { name: 'endDate', type: 'ISO datetime' },
      { name: 'billCycle', type: '{ id, name }' },
      { name: 'billAmount', type: 'number' },
      { name: 'cancelledFlag', type: 'boolean' },
    ],
    exampleConditions: [
      "agreementStatus='Active'",
      "company/id=123",
      "endDate>[2025-12-31T00:00:00Z]",
    ],
  },
  timeEntry: {
    entity: 'timeEntry',
    endpoint: '/time/entries',
    description: 'Time logged against a ticket, project, or other charge target.',
    fields: [
      { name: 'id', type: 'number' },
      { name: 'member', type: '{ id, name, identifier }' },
      { name: 'company', type: '{ id, name }' },
      { name: 'chargeToId', type: 'number', note: 'ID of the thing being charged (ticket, project, etc.)' },
      { name: 'chargeToType', type: 'enum', note: 'ServiceTicket | ProjectTicket | ChargeCode | Activity' },
      { name: 'workType', type: '{ id, name }' },
      { name: 'workRole', type: '{ id, name }' },
      { name: 'timeStart', type: 'ISO datetime' },
      { name: 'timeEnd', type: 'ISO datetime' },
      { name: 'actualHours', type: 'number' },
      { name: 'billableOption', type: 'enum', note: 'Billable | DoNotBill | NoCharge | NoDefault' },
      { name: 'notes', type: 'string' },
    ],
    exampleConditions: [
      "member/identifier='jsmith'",
      "timeStart>[2025-01-01T00:00:00Z]",
      "chargeToType='ServiceTicket'",
    ],
  },
  project: {
    entity: 'project',
    endpoint: '/project/projects',
    description: 'Project (multi-ticket engagement).',
    fields: [
      { name: 'id', type: 'number' },
      { name: 'name', type: 'string' },
      { name: 'company', type: '{ id, name, identifier }' },
      { name: 'status', type: '{ id, name }' },
      { name: 'manager', type: '{ id, name, identifier }' },
      { name: 'estimatedStart', type: 'ISO datetime' },
      { name: 'estimatedEnd', type: 'ISO datetime' },
      { name: 'actualStart', type: 'ISO datetime' },
      { name: 'actualEnd', type: 'ISO datetime' },
      { name: 'budgetHours', type: 'number' },
      { name: 'actualHours', type: 'number' },
      { name: 'percentComplete', type: 'number' },
    ],
    exampleConditions: ["status/name='Open'", "company/id=123"],
  },
  scheduleEntry: {
    entity: 'scheduleEntry',
    endpoint: '/schedule/entries',
    description: 'Scheduled time block / dispatch entry for a member.',
    fields: [
      { name: 'id', type: 'number' },
      { name: 'member', type: '{ id, name, identifier }' },
      { name: 'objectId', type: 'number', note: 'ID of the scheduled-against entity (ticket, etc.)' },
      { name: 'type', type: '{ id, name }' },
      { name: 'dateStart', type: 'ISO datetime' },
      { name: 'dateEnd', type: 'ISO datetime' },
      { name: 'hours', type: 'number' },
      { name: 'status', type: '{ id, name }' },
      { name: 'doneFlag', type: 'boolean' },
    ],
    exampleConditions: ["member/identifier='jsmith'", "dateStart>[2025-01-01T00:00:00Z]"],
  },
  opportunity: {
    entity: 'opportunity',
    endpoint: '/sales/opportunities',
    description: 'Sales opportunity / deal.',
    fields: [
      { name: 'id', type: 'number' },
      { name: 'name', type: 'string' },
      { name: 'company', type: '{ id, name, identifier }' },
      { name: 'contact', type: '{ id, name }' },
      { name: 'stage', type: '{ id, name }' },
      { name: 'status', type: '{ id, name }' },
      { name: 'primarySalesRep', type: '{ id, name, identifier }' },
      { name: 'expectedCloseDate', type: 'ISO datetime' },
      { name: 'probability', type: '{ id, probability }' },
      { name: 'rating', type: '{ id, name }' },
    ],
    exampleConditions: ["stage/name='Open'", "expectedCloseDate<[2025-12-31T00:00:00Z]"],
  },
  serviceBoard: {
    entity: 'serviceBoard',
    endpoint: '/service/boards',
    description: 'Service board (queue) holding tickets.',
    fields: [
      { name: 'id', type: 'number' },
      { name: 'name', type: 'string' },
      { name: 'location', type: '{ id, name }' },
      { name: 'department', type: '{ id, name }' },
      { name: 'workRole', type: '{ id, name }' },
      { name: 'workType', type: '{ id, name }' },
      { name: 'inactiveFlag', type: 'boolean' },
      { name: 'projectFlag', type: 'boolean' },
      { name: 'sendToContact', type: 'boolean' },
    ],
    exampleConditions: ["inactiveFlag=false", "projectFlag=false"],
  },
  note: {
    entity: 'note',
    endpoint: '/service/tickets/{id}/notes',
    description: 'Note on a ticket (also similar shapes for project/company/agreement notes).',
    fields: [
      { name: 'id', type: 'number' },
      { name: 'ticketId', type: 'number' },
      { name: 'text', type: 'string' },
      { name: 'detailDescriptionFlag', type: 'boolean', note: 'Visible to customer' },
      { name: 'internalAnalysisFlag', type: 'boolean', note: 'Internal-only' },
      { name: 'resolutionFlag', type: 'boolean' },
      { name: 'member', type: '{ id, name, identifier }' },
      { name: 'contact', type: '{ id, name }' },
      { name: 'dateCreated', type: 'ISO datetime' },
      { name: 'createdBy', type: 'string' },
    ],
    exampleConditions: ["internalAnalysisFlag=false"],
  },
  configuration: {
    entity: 'configuration',
    endpoint: '/company/configurations',
    description: 'Managed device / asset associated with a company.',
    fields: [
      { name: 'id', type: 'number' },
      { name: 'name', type: 'string' },
      { name: 'type', type: '{ id, name }' },
      { name: 'status', type: '{ id, name }' },
      { name: 'company', type: '{ id, name }' },
      { name: 'contact', type: '{ id, name }' },
      { name: 'site', type: '{ id, name }' },
      { name: 'manufacturer', type: '{ id, name }' },
      { name: 'modelNumber', type: 'string' },
      { name: 'serialNumber', type: 'string' },
      { name: 'tagNumber', type: 'string' },
      { name: 'installationDate', type: 'ISO datetime' },
      { name: 'warrantyExpirationDate', type: 'ISO datetime' },
      { name: 'activeFlag', type: 'boolean' },
    ],
    exampleConditions: ["activeFlag=true", "company/id=123", "type/name='Workstation'"],
  },
};

const entityNames = Object.keys(ENTITY_SCHEMAS) as [string, ...string[]];

export function register(server: McpServer, ctx: CwRequestContext): void {
  addTool(
    server,
    'describe_entity',
    `Return the field list, types, and example conditions for a ConnectWise entity. Use this before calling list tools when you're unsure what fields exist or how to filter. Supported entities: ${entityNames.join(', ')}.`,
    { entity: z.enum(entityNames).describe('Entity name (lowercase, see tool description for the list)') },
    (args) =>
      handleToolCall(ctx, async () => {
        const schema = ENTITY_SCHEMAS[args.entity];
        if (!schema) {
          return { error: `Unknown entity: ${args.entity}`, supported: entityNames };
        }
        return schema;
      }),
  );
}
