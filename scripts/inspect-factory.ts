import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { Parser } from '@etothepii/satisfactory-file-parser';
import { indexBuildings, type BuildingsFile } from '../src/shared/buildings.js';
import { analyzeFactory, type AnalysisData } from '../src/shared/factory/analysis.js';
import { extractFactory, type FactorySaveLike } from '../src/shared/factory/extract.js';
import { buildLines, type ProductionLine } from '../src/shared/factory/lines.js';
import type { MachineData } from '../src/shared/machines.js';
import { indexRecipes, type RecipeData } from '../src/shared/recipes.js';
import { applyOverrides, extractResourceNodes, readResourceNodes, type ResourceNodesFile } from '../src/shared/resourceNodes.js';

/**
 * Summary of a save's factory snapshot: counts per group, productivity, issues, size and timing; with a dataset
 * (`--data data/<version>`, default `data/1.2.5.0` when present) also its production lines.
 * `--json out.json` writes the snapshot, `--lines out.json` the lines (`index` as an object).
 */

const file = process.argv[2];
if (!file) {
  console.error('usage: npm run inspect-factory -- <file.sav> [--json out.json] [--data data/<version>] [--lines lines.json]');
  process.exit(1);
}
const ji = process.argv.indexOf('--json');
const jsonOut = ji >= 0 ? process.argv[ji + 1] : undefined;
const arg = (name: string) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; };
const dataDir = arg('--data') ?? (existsSync('data/1.2.5.0/recipes.json') ? 'data/1.2.5.0' : undefined);
const linesOut = arg('--lines');

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
  ['links', snap.links?.length ?? 0, snap.links],
  ['circuits', snap.circuits?.length ?? 0, snap.circuits],
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
const links = snap.links ?? [];
console.log(`links ${links.length} (belt ${links.filter(l => l.kind === 'belt').length}, pipe ${links.filter(l => l.kind === 'pipe').length}), with items ${links.filter(l => l.items).length}, with fluid ${links.filter(l => l.fluid).length}; circuits ${(snap.circuits ?? []).map(c => `${c.id}: ${c.buildings.length}${c.fuseTriggered ? ' (fuse)' : ''}`).join(', ')}`);

if (dataDir) {
  const read = <T>(f: string): T => JSON.parse(readFileSync(join(dataDir, f), 'utf8')) as T;
  const data: AnalysisData = { recipes: indexRecipes(read<RecipeData>('recipes.json')) };
  if (existsSync(join(dataDir, 'machines.json'))) data.machines = new Map(read<MachineData>('machines.json').machines.map(m => [m.id, m]));
  if (existsSync(join(dataDir, 'buildings.json'))) data.buildings = indexBuildings(read<BuildingsFile>('buildings.json'));
  if (existsSync(join(dataDir, 'resource-nodes.json'))) {
    const nodes = applyOverrides(readResourceNodes(read<ResourceNodesFile>('resource-nodes.json')), extractResourceNodes(save as never).overrides);
    data.nodes = new Map(nodes.map(n => [n.name, n]));
  }
  const analysis = analyzeFactory(snap, data);
  t = performance.now();
  const result = buildLines(snap, analysis, data);
  const linesMs = performance.now() - t;
  const name = (cls: string) => data.machines?.get(cls)?.name.en ?? data.recipes.items.get(cls)?.name.en ?? cls.replace(/^(Build|Desc)_|_C$/g, '');
  const rate = (r: { item: string; perMin: number; fluid?: boolean }) => `${name(r.item)} ${r.perMin.toFixed(1)}${r.fluid ? ' m³' : ''}`;
  const inLines = result.lines.reduce((n, l) => n + l.machines.length, 0);
  console.log(`\nlines ${result.lines.length} (${linesMs.toFixed(0)} ms), machines in lines ${inLines} of ${analysis.machines.length}, indexed ids ${result.index.size}`);
  const describe = (l: ProductionLine) => {
    const g = new Map(l.groups.map(x => [x.id, x]));
    const b = l.bottleneck;
    const where = !b ? '-' : b.kind === 'edge'
      ? `edge ${name(g.get(l.edges[b.edge]!.from)!.cls)} → ${name(g.get(l.edges[b.edge]!.to)!.cls)} (${l.edges[b.edge]!.item ? name(l.edges[b.edge]!.item!) : '?'} ${l.edges[b.edge]!.perMin?.toFixed(1)}/${l.edges[b.edge]!.capacity}) ${b.why}`
      : `${g.get(b.group)!.members.length}× ${name(g.get(b.group)!.cls)} ${g.get(b.group)!.recipe ?? ''} ${b.why}`;
    console.log(`- ${l.id}: ${l.machines.length} machines, ${l.buildings.length} buildings, ${l.groups.length} groups, ${l.edges.length} edges, stages ${Math.max(...l.groups.map(x => x.stage)) + 1}, productivity ${(l.productivity * 100).toFixed(0)} %, actual ${l.actual.toFixed(1)} of ${l.nominal.toFixed(1)}`);
    console.log(`    products: ${l.products.slice(0, 6).map(rate).join(', ') || '-'}`);
    if (l.inputs.length) console.log(`    inputs: ${l.inputs.slice(0, 6).map(rate).join(', ')}`);
    console.log(`    bottleneck: ${where}`);
    const sat = l.edges.filter(e => e.saturated);
    if (sat.length) console.log(`    saturated: ${sat.slice(0, 5).map(e => `${name(g.get(e.from)!.cls)} → ${name(g.get(e.to)!.cls)} ${e.item ? name(e.item) : '?'} ${e.perMin!.toFixed(1)}/${e.capacity}`).join('; ')}${sat.length > 5 ? ` (+${sat.length - 5})` : ''}`);
  };
  console.log('top 10 lines by machines');
  for (const l of result.lines.slice(0, 10)) describe(l);
  const verbose = arg('--line');
  const one = verbose ? result.lines.find(l => l.id === verbose || l.buildings.includes(verbose)) : undefined;
  if (one) {
    console.log(`\nline ${one.id} groups`);
    for (const x of one.groups) console.log(`  [${x.stage}] ${x.id} ${x.members.length}× ${x.logistics ? x.kind : name(x.cls)} ${x.recipe ?? ''} ${x.logistics ? '' : `${(x.productivity * 100).toFixed(0)} % ${x.reasons.map(r => `${r.reason}:${r.count}`).join(' ')}`} out: ${x.outputs.map(rate).join(', ')} in: ${x.inputs.map(rate).join(', ')}`);
    console.log('edges');
    for (const e of one.edges) console.log(`  ${e.from} → ${e.to} ${e.item ? name(e.item) : '?'} ${e.perMin?.toFixed(1)}${e.capacity !== undefined ? `/${e.capacity}` : ''} ×${e.links}${e.saturated ? ' SAT' : ''}`);
  }
  if (linesOut) writeFileSync(linesOut, JSON.stringify({ lines: result.lines, index: Object.fromEntries(result.index) }));
}

if (jsonOut) writeFileSync(jsonOut, json);
