import type { RequestHandler } from 'express';
import { promises as fs, createReadStream } from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { getConfig } from '../config.js';

const BACKUP_FILENAME = /^dashboard-[\w\-:.]+\.dump$/;

async function backupDir(): Promise<string> {
  return (
    (await getConfig<string>('backup.path', () => process.env.BACKUP_PATH ?? '/backups')) ??
    '/backups'
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export const backupsGetHandler: RequestHandler = async (req, res, next) => {
  try {
    const dir = await backupDir();
    let files: { name: string; size: string; sizeBytes: number; mtime: Date }[] = [];
    let dirError: string | null = null;
    try {
      const entries = await fs.readdir(dir);
      const stats = await Promise.all(
        entries
          .filter((f) => f.endsWith('.dump'))
          .map(async (f) => {
            const full = path.join(dir, f);
            const s = await fs.stat(full);
            return { name: f, size: formatBytes(s.size), sizeBytes: s.size, mtime: s.mtime };
          }),
      );
      files = stats.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
    } catch (err) {
      dirError = err instanceof Error ? err.message : String(err);
    }
    const enabled = await getConfig<boolean>('backup.enabled', () => true);
    const retention = await getConfig<number>('backup.retention_days', () => 30);
    res.render('backups', {
      title: 'Backups',
      admin: req.admin,
      files,
      dir,
      dirError,
      enabled: enabled === true,
      retentionDays: retention ?? 30,
      flash: typeof req.query.flash === 'string' ? req.query.flash : null,
    });
  } catch (err) {
    next(err);
  }
};

export const backupsRunHandler: RequestHandler = async (req, res, next) => {
  try {
    const dir = await backupDir();
    await fs.mkdir(dir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const outPath = path.join(dir, `dashboard-${ts}.dump`);

    const env = {
      ...process.env,
      PGPASSWORD: process.env.POSTGRES_PASSWORD ?? '',
    };
    const args = [
      '--format=custom',
      '-h', process.env.POSTGRES_HOST ?? 'postgres',
      '-U', process.env.POSTGRES_USER ?? 'cw_mcp',
      '-d', process.env.POSTGRES_DB ?? 'cw_mcp_dashboard',
      '-f', outPath,
    ];
    await new Promise<void>((resolve, reject) => {
      const proc = spawn('pg_dump', args, { env });
      let stderr = '';
      proc.stderr?.on('data', (d) => {
        stderr += d.toString();
      });
      proc.on('error', reject);
      proc.on('exit', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`pg_dump exit ${code}: ${stderr.slice(0, 500)}`));
      });
    });
    res.redirect(302, '/admin/backups?flash=run-ok');
  } catch (err) {
    console.warn(`[backups] ad-hoc dump failed: ${err instanceof Error ? err.message : err}`);
    res.redirect(302, '/admin/backups?flash=run-error');
  }
};

export const backupsDownloadHandler: RequestHandler = async (req, res, next) => {
  try {
    const filename = req.params.filename;
    if (typeof filename !== 'string' || !BACKUP_FILENAME.test(filename)) {
      res.status(400).send('Bad filename');
      return;
    }
    const dir = await backupDir();
    const fullPath = path.join(dir, filename);
    const resolved = path.resolve(fullPath);
    if (!resolved.startsWith(path.resolve(dir) + path.sep)) {
      res.status(400).send('Bad filename');
      return;
    }
    await fs.access(resolved);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    createReadStream(resolved).pipe(res);
  } catch (err) {
    next(err);
  }
};
