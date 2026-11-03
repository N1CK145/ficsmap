import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Parser } from '@etothepii/satisfactory-file-parser';
import { indexDataset, type Dataset } from '../src/shared/dataset.js';
import { extractCollected, type SaveLike } from '../src/shared/extract.js';

const args = process.argv.slice(2);
const di = args.indexOf('--dataset');
let dir = di >= 0 ? args.splice(di, 2)[1] : undefined;
const file = args[0];
if (!file) {
  console.error('usage: npm run inspect-save -- <file.sav> [--dataset data/<version>]');
  process.exit(1);
}
if (!dir) {
  const dirs = readdirSync('data', { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name);
  if (dirs.length !== 1) {
    console.error(`pass --dataset: found ${dirs.length} dataset folders in data/`);
    process.exit(1);
  }
  dir = join('data', dirs[0]!);
}

const index = indexDataset(JSON.parse(readFileSync(join(dir, 'collectibles.min.json'), 'utf8')) as Dataset);
const buf = readFileSync(file);
const save = Parser.ParseSave('inspect', buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
const r = extractCollected(save as unknown as SaveLike, index);

console.log('meta', { ...r.meta, saveTime: new Date(r.meta.saveTime).toISOString() });
const counts = new Map<string, number>();
for (const n of r.collected) {
  const t = index.byName.get(n)!.type;
  counts.set(t, (counts.get(t) ?? 0) + 1);
}
console.log('counts per type');
for (const t of [...counts.keys()].sort()) {
  const total = index.items.filter(i => i.type === t).length;
  console.log(`  ${t}: ${counts.get(t)} / ${total}`);
}
console.log(`collected (${r.recognised})`);
for (const n of r.collected) console.log(`  ${n}`);
console.log(`opened, not looted (${r.openedNotLooted.length})`);
for (const n of r.openedNotLooted) console.log(`  ${n}`);
