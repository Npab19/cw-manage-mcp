/**
 * Module-to-tool mapping used to seed permission_policies when a CW
 * security role is first imported. Admins are expected to refine
 * these in the Permissions dashboard; the seed is best-effort.
 */

export const ALWAYS_ADMIN_ONLY = new Set<string>(['get_audit_trail', 'get_system_info']);

export const MODULE_TOOLS: Record<string, string[]> = {
  // CW module name -> tool names this module unlocks.
  ServiceTicket: [
    'get_service_tickets',
    'get_service_ticket_by_id',
    'get_service_ticket_notes',
    'get_service_ticket_time_entries',
    'get_service_ticket_tasks',
    'get_service_ticket_count',
    'get_service_ticket_configurations',
    'get_service_ticket_documents',
    'get_service_ticket_products',
    'get_service_ticket_links',
    'get_service_boards',
    'get_service_board_statuses',
    'get_service_board_types',
    'get_service_board_subtypes',
    'get_service_board_teams',
    'get_service_priorities',
    'get_service_slas',
    'get_service_impacts',
    'get_service_sources',
    'get_service_severities',
    'get_service_teams',
    'get_service_surveys',
    'get_service_survey_questions',
    'get_service_survey_results',
    'get_knowledge_base_articles',
    'get_knowledge_base_article_by_id',
    'get_knowledge_base_categories',
    'get_knowledge_base_subcategories',
  ],
  Company: [
    'get_companies',
    'get_company_by_id',
    'get_company_sites',
    'get_company_notes',
    'get_contacts',
    'get_contact_by_id',
    'get_contact_communications',
    'get_contact_notes',
    'get_company_configurations',
    'get_company_configuration_by_id',
  ],
  Finance: [
    'get_agreements',
    'get_agreement_by_id',
    'get_agreement_additions',
    'get_agreement_adjustments',
    'get_agreement_sites',
    'get_agreement_recap',
    'get_agreement_types',
  ],
  TimeEntry: [
    'get_time_entries',
    'get_time_entry_by_id',
    'get_time_sheets',
    'get_time_sheet_by_id',
    'get_work_roles',
    'get_work_types',
    'get_charge_codes',
  ],
  Project: [
    'get_projects',
    'get_project_by_id',
    'get_project_phases',
    'get_project_tickets',
    'get_project_team_members',
    'get_project_notes',
    'get_project_statuses',
  ],
  System: [
    'get_members',
    'get_member_by_id',
    'get_member_skills',
    'get_departments',
    // get_audit_trail + get_system_info are always-admin-only — never auto-granted.
  ],
  Schedule: ['get_schedule_entries', 'get_schedule_entry_by_id', 'get_schedule_calendars'],
  Sales: [
    'get_opportunities',
    'get_opportunity_by_id',
    'get_opportunity_forecast',
    'get_opportunity_notes',
    'get_sales_activities',
  ],
  Expense: ['get_expense_entries', 'get_expense_entry_by_id', 'get_expense_types', 'get_expense_reports'],
  Procurement: [
    'get_products',
    'get_product_by_id',
    'get_catalog_items',
    'get_catalog_item_by_id',
    'get_purchase_orders',
    'get_purchase_order_by_id',
    'get_rma_actions',
    'get_rma_action_by_id',
  ],
  Marketing: ['get_marketing_campaigns', 'get_marketing_groups'],
  // Webhooks live on /system/callbacks — admin-only, omitted from auto-derivation.
  Reference: ['describe_entity'],
};

// Composite reporting tools — granted if ANY underlying module is granted.
// The composite is the trust gate: once granted, it can fan out across CW.
export const COMPOSITE_REQUIREMENTS: Record<string, string[]> = {
  get_ticket_summary: ['ServiceTicket'],
  get_member_utilization: ['TimeEntry', 'Schedule'],
  get_agreement_profitability: ['Finance'],
  get_board_overview: ['ServiceTicket'],
  get_tech_skills_report: ['System', 'ServiceTicket', 'TimeEntry'],
  get_recurring_issues_report: ['ServiceTicket'],
  get_ticket_tone_analysis: ['ServiceTicket'],
  get_common_issues_by_company: ['ServiceTicket'],
  get_helpdesk_team_report: ['ServiceTicket', 'TimeEntry'],
  get_sla_compliance_report: ['ServiceTicket'],
};

/**
 * Maps CW's top-level module names (as returned by
 * /system/securityRoles/{id}/settings.moduleName) to our internal
 * MODULE_TOOLS bucket keys. One CW module can map to multiple buckets.
 *
 * Notable mappings:
 * - "Time & Expense" → TimeEntry + Expense (CW bundles them)
 * - "System" → System + Schedule (CW doesn't expose Schedule as a
 *   top-level module; we conservatively grant it under System read)
 * - Internal bucket keys (ServiceTicket, Company, etc.) are passed
 *   through unchanged so callers can also pass our names directly.
 */
const CW_MODULE_ALIASES: Record<string, string[]> = {
  Companies: ['Company'],
  Finance: ['Finance'],
  Marketing: ['Marketing'],
  Procurement: ['Procurement'],
  Project: ['Project'],
  Sales: ['Sales'],
  'Service Desk': ['ServiceTicket'],
  System: ['System', 'Schedule'],
  'Time & Expense': ['TimeEntry', 'Expense'],
};

const KNOWN_BUCKETS = new Set(Object.keys(MODULE_TOOLS));

function expandToBuckets(raw: string): string[] {
  const alias = CW_MODULE_ALIASES[raw];
  if (alias) return alias;
  // Pass-through for callers that already use our bucket keys
  // (defaultSeedAllowedTools, tests, etc.).
  if (KNOWN_BUCKETS.has(raw)) return [raw];
  return [];
}

/**
 * Given a list of CW module names (e.g. "Companies", "Service Desk",
 * "Time & Expense") or internal bucket keys (e.g. "ServiceTicket"),
 * return the deduped set of allowed tool names.
 *
 * Reference (describe_entity) is always granted — it's a meta tool
 * for AI schema discovery, not gated by CW perms.
 *
 * Tolerant: unknown modules are ignored. Always-admin-only tools are
 * always excluded — admins get them via the isAdmin path, not the policy.
 */
export function deriveAllowedTools(modulePermissions: string[]): string[] {
  const grantedModules = new Set<string>(['Reference']);
  for (const raw of modulePermissions) {
    for (const bucket of expandToBuckets(raw)) grantedModules.add(bucket);
  }

  const tools = new Set<string>();
  for (const mod of grantedModules) {
    for (const t of MODULE_TOOLS[mod] ?? []) tools.add(t);
  }

  // Composite tools: include if any required module is granted.
  for (const [composite, requiredModules] of Object.entries(COMPOSITE_REQUIREMENTS)) {
    if (requiredModules.some((m) => grantedModules.has(m))) {
      tools.add(composite);
    }
  }

  // Strip always-admin-only.
  for (const t of ALWAYS_ADMIN_ONLY) tools.delete(t);

  return [...tools].sort();
}

/**
 * Default seed when we can't fetch CW permissions for a role. Grants a
 * conservative "read service tickets + companies + describe" surface so
 * a freshly-imported role isn't useless until an admin reviews it.
 */
export function defaultSeedAllowedTools(): string[] {
  return deriveAllowedTools(['ServiceTicket', 'Company', 'Reference']);
}
