import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getSql } from '../db.js';

const __filename = fileURLToPath(import.meta.url);
const MIGRATIONS_DIR = path.dirname(__filename);

const MIGRATION_FILE_REGEX = /^(\d{3,})_.+\.sql$/;

export async function runMigrations(): Promise<void> {
  const sql = getSql();

  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const applied = await sql<{ version: string }[]>`SELECT version FROM schema_migrations`;
  const appliedSet = new Set(applied.map((r) => r.version));

  const allFiles = await fs.readdir(MIGRATIONS_DIR);
  const migrationFiles = allFiles
    .filter((f) => MIGRATION_FILE_REGEX.test(f))
    .sort();

  let appliedCount = 0;
  for (const file of migrationFiles) {
    const version = file.replace(/\.sql$/, '');
    if (appliedSet.has(version)) continue;

    const content = await fs.readFile(path.join(MIGRATIONS_DIR, file), 'utf8');
    console.log(`Applying migration ${version}`);
    await sql.begin(async (tx) => {
      await tx.unsafe(content);
      await tx`INSERT INTO schema_migrations (version) VALUES (${version})`;
    });
    appliedCount++;
  }

  if (appliedCount === 0) {
    console.log(`No new migrations to apply (${appliedSet.size} already applied)`);
  } else {
    console.log(`Applied ${appliedCount} migration(s)`);
  }
}
