import cron from 'node-cron';
import { getConfig } from './config.js';
import { runUserImport } from './import/cw-users.js';
import { getSql } from './db.js';

const DEFAULT_USER_IMPORT_CRON = '0 2 * * *';
const AUDIT_PRUNE_CRON = '15 3 * * *'; // 3:15 AM nightly — staggered from user import
const DEFAULT_AUDIT_LOG_RETENTION_DAYS = 90;

let userImportTask: cron.ScheduledTask | null = null;
let auditPruneTask: cron.ScheduledTask | null = null;

async function resolveUserImportSchedule(): Promise<string> {
  const fromDb = await getConfig<string>('sync.user_import_cron', () => DEFAULT_USER_IMPORT_CRON);
  return fromDb ?? DEFAULT_USER_IMPORT_CRON;
}

async function runAuditPrune(): Promise<void> {
  const days = await getConfig<number>(
    'retention.mcp_audit_log_days',
    () => DEFAULT_AUDIT_LOG_RETENTION_DAYS,
  );
  const effectiveDays =
    typeof days === 'number' && days > 0 ? days : DEFAULT_AUDIT_LOG_RETENTION_DAYS;
  const sql = getSql();
  const rows = await sql<{ id: string }[]>`
    DELETE FROM mcp_audit_log
     WHERE ts < now() - (${effectiveDays} * INTERVAL '1 day')
     RETURNING id::text AS id
  `;
  console.log(
    `[cron] audit-log prune: removed ${rows.length} row(s) older than ${effectiveDays} day(s)`,
  );
}

export async function startCron(): Promise<void> {
  const schedule = await resolveUserImportSchedule();
  if (!cron.validate(schedule)) {
    console.warn(
      `[cron] sync.user_import_cron value "${schedule}" is invalid — falling back to "${DEFAULT_USER_IMPORT_CRON}"`,
    );
  }
  const effective = cron.validate(schedule) ? schedule : DEFAULT_USER_IMPORT_CRON;
  userImportTask?.stop();
  userImportTask = cron.schedule(effective, async () => {
    try {
      const result = await runUserImport('cron');
      console.log(
        `[cron] user import done: status=${result.status} added=${result.rowsAdded} updated=${result.rowsUpdated} deactivated=${result.rowsDeactivated} errors=${result.errors.length}`,
      );
    } catch (err) {
      console.warn(`[cron] user import failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  });
  console.log(`[cron] user import scheduled on "${effective}"`);

  auditPruneTask?.stop();
  auditPruneTask = cron.schedule(AUDIT_PRUNE_CRON, () => {
    runAuditPrune().catch((err) => {
      console.warn(
        `[cron] audit-log prune failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
  });
  console.log(`[cron] audit-log prune scheduled on "${AUDIT_PRUNE_CRON}"`);
}

export function stopCron(): void {
  userImportTask?.stop();
  userImportTask = null;
  auditPruneTask?.stop();
  auditPruneTask = null;
}
