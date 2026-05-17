import { promises as fs } from 'fs';
import path from 'path';

const SRC = 'src/migrations';
const DEST = 'dist/migrations';

await fs.mkdir(DEST, { recursive: true });
const entries = await fs.readdir(SRC);
let copied = 0;
for (const name of entries) {
  if (!name.endsWith('.sql')) continue;
  await fs.copyFile(path.join(SRC, name), path.join(DEST, name));
  copied++;
}
console.log(`Copied ${copied} migration file(s) to ${DEST}`);
