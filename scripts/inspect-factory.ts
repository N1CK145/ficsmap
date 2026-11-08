import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { Parser } from '@etothepii/satisfactory-file-parser';
import { extractFactory, type FactorySaveLike } from '../src/shared/factory/extract.js';

/** Summary of a save's factory snapshot: counts per group, productivity, issues, size and timing. */

const file = process.argv[2];
if (!file) {
  console.error('usage: npm run inspect-factory -- <file.sav> [--json out.json]');
  process.exit(1);
}
const ji = process.argv.indexOf('--json');
const jsonOut = ji >= 0 ? process.argv[ji + 1] : undefined;

const buf = readFileSync(file);
let t = performance.now();
const save = Parser.ParseSave('inspect', buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
const parseMs = performance.now() - t;
t = performance.now();
const snap = extractFactory(save as unknown as FactorySaveLike);
const extractMs = performance.now() - t;
const json = JSON.stringify(snap);
const gz = gzipSync(json).length;

const kb = (n: number) => `${(n / 1024).toFixed(0)} kB`;
const sizeOf = (v: unknown) => JSON.stringify(v ?? null).length;

console.log('meta', { ...snap.meta, saveTime: new Date(snap.meta.saveTime).toISOString() });
console.log(`parse ${parseMs.toFixed(0)} ms, extract ${extractMs.toFixed(0)} ms`);
console.log(`size ${kb(json.length)} raw, ${kb(gz)} gzip`);
console.log('groups (count, raw size)');
const groups: [string, number, unknown][] = [
  ['buildings', snap.buildings.length, snap.buildings],
  ['lightweight instances', snap.lightweight.reduce((n, l) => n + l.xyzYaw.length / 4, 0), snap.lightweight],
  ['splines', snap.splines.length, snap.splines],
  ['power lines', snap.powerLines.length / 6, snap.powerLines],
  ['path networks', snap.pathNetworks.length, snap.pathNetworks],
  ['stations', snap.stations.length, snap.stations],
  ['vehicles', snap.vehicles.length, snap.vehicles],
  ['markers', snap.markers.length, snap.markers],
  ['crates', snap.crates.length, snap.crates],
  ['fog (base64 chars)', snap.fog?.length ?? 0, snap.fog],
];
for (const [name, n, v] of groups) console.log(`  ${name.padEnd(22)} ${String(n).padStart(6)}  ${kb(sizeOf(v)).padStart(7)}`);

const splineKinds = new Map<string, [number, number]>();
for (const s of snap.splines) {
  const k = splineKinds.get(s.cls) ?? [0, 0];
  splineKinds.set(s.cls, [k[0] + 1, k[1] + s.pts.length / 3]);
}
console.log('splines per class (count, points)');
for (const [c, [n, p]] of [...splineKinds].sort((a, b) => b[1][0] - a[1][0])) console.log(`  ${c.padEnd(34)} ${String(n).padStart(5)} ${String(p).padStart(6)}`);

const prod = snap.buildings.filter(b => b.prod);
const measured = prod.filter(b => b.prod!.productivity !== undefined);
const avg = measured.reduce((s, b) => s + b.prod!.productivity!, 0) / (measured.length || 1);
const buckets = [0, 0, 0, 0, 0];
for (const b of measured) {
  const p = b.prod!.productivity!;
  buckets[p < 0.01 ? 0 : p < 0.5 ? 1 : p < 0.9 ? 2 : p < 0.99 ? 3 : 4]!++;
}
console.log(`production buildings ${prod.length}, measured ${measured.length}, mean productivity ${(avg * 100).toFixed(1)} %`);
console.log(`  <1 %: ${buckets[0]}  1–50 %: ${buckets[1]}  50–90 %: ${buckets[2]}  90–99 %: ${buckets[3]}  ≥99 %: ${buckets[4]}`);
console.log(`  producing ${prod.filter(b => b.prod!.producing).length}, paused ${prod.filter(b => b.prod!.paused).length}, shards ${prod.reduce((n, b) => n + (b.prod!.powerShards ?? 0), 0)}, somersloops ${prod.reduce((n, b) => n + (b.prod!.somersloops ?? 0), 0)}, on nodes ${snap.buildings.filter(b => b.node).length}`);
const issues = new Map<string, number>();
for (const b of prod) for (const i of b.prod!.issues ?? []) issues.set(i, (issues.get(i) ?? 0) + 1);
console.log('issues', Object.fromEntries(issues));
const perClass = new Map<string, { n: number; sum: number; m: number }>();
for (const b of prod) {
  const e = perClass.get(b.cls) ?? { n: 0, sum: 0, m: 0 };
  e.n++;
  if (b.prod!.productivity !== undefined) { e.sum += b.prod!.productivity; e.m++; }
  perClass.set(b.cls, e);
}
console.log('productivity per class (count, mean)');
for (const [c, e] of [...perClass].sort((a, b) => b[1].n - a[1].n)) console.log(`  ${c.padEnd(34)} ${String(e.n).padStart(4)}  ${e.m ? `${((e.sum / e.m) * 100).toFixed(0)} %` : '-'}`);
console.log('stations');
for (const s of snap.stations) console.log(`  ${s.id} ${s.name ?? '(default name)'} loading=${s.loading} vehicles=${s.traffic.length}`);
console.log('vehicles');
for (const v of snap.vehicles) console.log(`  ${v.id} autopilot=${v.autopilot} fuel=${v.fuel ? `${v.fuel.item}×${v.fuel.amount}` : '-'} route=${v.route.length} stops`);
console.log('path networks', snap.pathNetworks.map(n => `${n.id}: ${n.nodes} nodes, ${n.segments.length} segments`).join('; '));
if (jsonOut) {
  const { writeFileSync } = await import('node:fs');
  writeFileSync(jsonOut, json);
}
