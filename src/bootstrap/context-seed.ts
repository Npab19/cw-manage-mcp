import { promises as fs } from 'fs';
import path from 'path';
import { getSql } from '../db.js';
import { getActiveContext, saveContext } from '../resources/context.js';

const CANDIDATE_FILES = ['context.md', 'mcp-context.md'];

async function setupComplete(): Promise<boolean> {
  if (!process.env.DATABASE_URL) return false;
  const sql = getSql();
  const rows = await sql<{ setup_completed_at: Date | null }[]>`
    SELECT setup_completed_at FROM setup_state WHERE id = 1
  `;
  return rows[0]?.setup_completed_at != null;
}

async function readFirstExisting(candidates: string[], cwd: string): Promise<{ path: string; text: string } | null> {
  for (const rel of candidates) {
    const abs = path.resolve(cwd, rel);
    try {
      const text = await fs.readFile(abs, 'utf8');
      if (text.trim().length > 0) return { path: abs, text };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }
  return null;
}

/**
 * If setup is complete and the global context layer has no active
 * document yet, look for context.md / mcp-context.md in the process
 * working directory and seed the global layer with its contents.
 *
 * Best-effort: any error is logged but never blocks startup. Once the
 * dashboard has a global doc, this seed is a no-op forever — the
 * file on disk is ignored.
 */
export async function seedGlobalContextIfMissing(): Promise<void> {
  try {
    if (!(await setupComplete())) {
      // Pre-setup deployments don't seed yet; the wizard or admin can
      // populate global context after setup completes.
      return;
    }
    const existing = await getActiveContext('global', null);
    if (existing) return;

    const found = await readFirstExisting(CANDIDATE_FILES, process.cwd());
    if (!found) {
      console.log('[context-seed] no context.md or mcp-context.md found — global context layer starts empty');
      return;
    }
    await saveContext('global', null, found.text, 'bootstrap');
    console.log(`[context-seed] seeded global context from ${found.path} (${found.text.length} chars)`);
  } catch (err) {
    console.warn(
      `[context-seed] failed: ${err instanceof Error ? err.message : String(err)} — global context layer left untouched`,
    );
  }
}
