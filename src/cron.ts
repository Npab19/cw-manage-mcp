import cron from 'node-cron';
import { getConfig } from './config.js';
import { runUserImport } from './import/cw-users.js';

const DEFAULT_USER_IMPORT_CRON = '0 2 * * *';
let userImportTask: cron.ScheduledTask | null = null;

async function resolveUserImportSchedule(): Promise<string> {
  const fromDb = await getConfig<string>('user_import_cron', () => DEFAULT_USER_IMPORT_CRON);
  return fromDb ?? DEFAULT_USER_IMPORT_CRON;
}

export async function startCron(): Promise<void> {
  const schedule = await resolveUserImportSchedule();
  if (!cron.validate(schedule)) {
    console.warn(`[cron] user_import_cron value "${schedule}" is invalid — falling back to "${DEFAULT_USER_IMPORT_CRON}"`);
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
}

export function stopCron(): void {
  userImportTask?.stop();
  userImportTask = null;
}
