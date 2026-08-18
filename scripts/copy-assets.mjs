import { promises as fs } from 'fs';
import path from 'path';

const TARGETS = [
  { src: 'src/migrations', dest: 'dist/migrations', extension: '.sql' },
  { src: 'src/admin/views', dest: 'dist/admin/views', extension: '.ejs' },
  { src: 'src/admin/static', dest: 'dist/admin/static' },
  { src: 'apps/board-overview/dist', dest: 'dist/apps/board-overview', extension: '.html' },
];

async function copyDir(srcDir, destDir, extension) {
  await fs.mkdir(destDir, { recursive: true });
  let entries;
  try {
    entries = await fs.readdir(srcDir, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return 0;
    throw err;
  }
  let count = 0;
  for (const entry of entries) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      count += await copyDir(srcPath, destPath, extension);
    } else if (entry.isFile()) {
      if (extension && !entry.name.endsWith(extension)) continue;
      await fs.copyFile(srcPath, destPath);
      count++;
    }
  }
  return count;
}

let total = 0;
for (const target of TARGETS) {
  const copied = await copyDir(target.src, target.dest, target.extension);
  console.log(`${target.src} -> ${target.dest}: ${copied} file(s)`);
  total += copied;
}
console.log(`Copied ${total} asset(s) total`);
