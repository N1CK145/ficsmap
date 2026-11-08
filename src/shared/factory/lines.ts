/**
 * Production lines ("Produktionsstränge"): the factory's machines grouped by how they are really connected (belts and
 * pipes from `FactorySnapshot.links`), with what flows on each connection and how efficient each part is. One contract
 * for the map (hover a machine → its line lights up) and the line diagram (like the planner's top-down diagram).
 *
 * Implemented by `buildLines` (this file); the UI only reads these types.
 */
import { bandOf, REASONS, type AnalysisData, type Band, type FactoryAnalysis, type MachineFlow, type MachineState, type Reason } from './analysis.js';
import type { FactorySnapshot, SnapshotBuilding, SnapshotLink } from './snapshot.js';

export interface ProductionLine {
  /** Stable within a snapshot: the id of its most downstream machine. */
  id: string;
  /** What the line makes: its final products (items leaving to storage, stations, sinks or nowhere), most first. */
  products: LineRate[];
  /** What comes in from outside the line (extractors are part of the line; this is what arrives by station/storage). */
  inputs: LineRate[];
  /** Every building in the line (machines and logistics nodes). */
  buildings: string[];
  /** Every belt, lift and pipe of the line (spline and lift ids), also those inside a group (a manifold's belts). */
  via?: string[];
  /** The machines among them (with productivity). */
  machines: string[];
  /** Groups of parallel machines doing the same recipe on the same stage, for the diagram ("4× Konstruktor"). */
  groups: LineGroup[];
  /** Connections between groups (and logistics nodes), aggregated from links. */
  edges: LineEdge[];
  /** Mean productivity of its machines, 0..1 (plain mean, like the Fabrik page). */
  productivity: number;
  /** Nominal and actual output of its final products per minute (sum over products, items and m³ kept apart). */
  nominal: number;
  actual: number;
  /** The weakest point: the group or edge that limits the line, with the reason. */
  bottleneck?: LineBottleneck;
}

export interface LineRate { item: string; perMin: number; fluid?: boolean }

/** What a logistics group is (`LineGroup.kind`). */
export type LogisticsKind = 'splitter' | 'merger' | 'junction' | 'pump' | 'valve' | 'storage' | 'tank' | 'station' | 'sink' | 'other';

export interface LineGroup {
  id: string;
  /** Building class of the group (all members share it) or a logistics kind. */
  cls: string;
  recipe?: string;
  /** Member building ids. */
  members: string[];
  /** Stage from the start of the line (0 = extractors / inputs), for the top-down layout. */
  stage: number;
  /** Outputs and inputs per minute for the whole group (actual), and its nominal output. */
  outputs: LineRate[];
  inputs: LineRate[];
  nominal: LineRate[];
  productivity: number;
  state: MachineState;
  band?: Band;
  /** Reasons present in the group, with how many members have each. */
  reasons: { reason: Reason; count: number }[];
  /** Logistics nodes (splitter, merger, storage, station) are groups too, with `logistics: true`. */
  logistics?: boolean;
  /** Logistics groups: what kind of node (a manifold of several splitters is one `splitter` group). */
  kind?: LogisticsKind;
}

export interface LineEdge {
  from: string; // group id
  to: string; // group id
  item?: string;
  /** Mixed belts: every item on the edge with its flow, most first (missing when one item or none is known). */
  items?: LineRate[];
  /** Actual flow per minute (from the producing side's actual rate, split over its outgoing links). */
  perMin?: number;
  /** Capacity per minute of the slowest belt/pipe on the way (summed over parallel links). */
  capacity?: number;
  /** Class of that slowest belt/pipe. */
  slowest?: string;
  /** Number of physical links aggregated. */
  links: number;
  /** All spline/lift ids of the aggregated links (for drawing on the map). */
  via: string[];
  /** Flow is at or near capacity (≥ 95 %). */
  saturated?: boolean;
}

export type LineBottleneck =
  | { kind: 'edge'; edge: number /* index in edges */; why: 'capacity' }
  | { kind: 'group'; group: string; why: Reason | 'demand' };

/** Which line every building belongs to (building id → line id), for the map's hover; belts, lifts and pipes too (`via`). */
export type LineIndex = ReadonlyMap<string, string>;

export interface ProductionLines {
  lines: ProductionLine[];
  /** building id → line id */
  index: LineIndex;
}

/*
 * How lines are built (`buildLines`), all from the snapshot's links and the analysis's measured rates:
 *
 * Lines. The connected components of the link graph (power is ignored). Stations, sinks, Dimensional Depot uploaders
 * and the Space Elevator are always boundaries: items leave or enter the belt network there, so they never join two
 * lines; a boundary building is part of every line it touches (as an end or a start), and the index maps it to the
 * line that feeds it most (else the one it feeds). A component with more than `SPLIT_ABOVE` machines is cut once more
 * at its storage containers the same way (fluid buffers stay inside: they are inline buffers). Components without a
 * machine are no line.
 *
 * Groups. Chains of splitters linked to each other become one `splitter` group (a manifold), likewise mergers and
 * pipe junctions; every other logistics building is a group of its own. Stages are the longest path (in groups) from
 * a group without inputs, on the graph with loops cut where a depth-first search from the sources meets them. Machines
 * with the same class and recipe (extractors: the same resource) on the same stage form one group.
 *
 * Flows. Producers put out their measured actual rate; consumers take their measured actual input (recipe ingredients
 * × clock × productivity; generators their fuel and water). In topological order each building hands its supply (a
 * machine its outputs, a logistics building what came in) to its outgoing links that can carry the item (belt: solid,
 * pipe: fluid; filtered by what lies on the belt or the pipe's fluid when that is known): first to links leading to
 * consumers that need it, evenly up to their need (water-filling), the rest evenly to links leading to storage,
 * stations or sinks; never more than a belt's capacity; what nobody takes backs up and is dropped, and links that close
 * a loop carry nothing. A building without inputs in the line (storage, an unloading station) delivers what is taken.
 * Splitters, mergers, junctions, pumps and valves only pass things on. Edge capacity is the dataset's belt rate of
 * the slowest class (pipes: unknown, the dataset has no pipe rates), summed over the edge's links; saturated at ≥ 95 %.
 * Products are what flows into storage, stations or sinks plus outputs with no link at all; inputs what comes out of
 * storage or stations.
 *
 * Bottleneck. (1) A saturated edge whose next machines (through logistics) starve while the machines before it back up
 * (`blocked` or `surplus`; else the belt is not what holds them): `{ edge, 'capacity' }`, the one with the most
 * starving loss. (2) Else the machine group losing the most machine-equivalents (Σ 1 − productivity, paused
 * and surplus-only members left out) with its main reason; when that is `blocked` (it backs up), follow its products
 * downstream to the next machine group that loses most: its reason when it is not blocked, else on; where no machine
 * takes the products any more the line backs up at its end: `{ group, 'demand' }`. No bottleneck below 0.05 lost.
 */

/** A connected part with more machines than this is cut at its storage containers too. */
export const SPLIT_ABOVE = 40;
/** An edge carrying at least this share of its capacity is saturated. */
export const SATURATED_FROM = 0.95;
/** Lost machine-equivalents below which a line has no bottleneck. */
const MIN_LOSS = 0.05;

const ALWAYS_BOUNDARY = /^Build_(TruckStation|TrainStation|TrainDockingStation|TrainDockingStationLiquid|DroneStation|ResourceSink|ResourceSinkShop|CentralStorage|SpaceElevator)_C$/;
const STORAGE_BOUNDARY = /^Build_(StorageContainerMk\d|StoragePlayer|StorageIntegrated|StorageBlueprint)_C$/;

/** A logistics building's kind by class. */
export function logisticsKind(cls: string): LogisticsKind {
  if (/^Build_ConveyorAttachmentSplitter/.test(cls)) return 'splitter';
  if (/^Build_ConveyorAttachmentMerger/.test(cls)) return 'merger';
  if (/^Build_PipelineJunction/.test(cls)) return 'junction';
  if (/^Build_PipelinePump/.test(cls)) return 'pump';
  if (/^Build_Valve_C$/.test(cls)) return 'valve';
  if (/^Build_(PipeStorageTank|IndustrialTank)_C$/.test(cls)) return 'tank';
  if (/^Build_(Storage|CentralStorage)/.test(cls)) return 'storage';
  if (/Station/.test(cls)) return 'station';
  if (/^Build_ResourceSink/.test(cls)) return 'sink';
  return 'other';
}
/** Logistics kinds that only pass items on: with no way out they block, with no way in they give nothing. */
const PASS: ReadonlySet<LogisticsKind> = new Set(['splitter', 'merger', 'junction', 'pump', 'valve']);
/** Logistics kinds whose linked buildings merge into one manifold group. */
const MANIFOLD: ReadonlySet<LogisticsKind> = new Set(['splitter', 'merger', 'junction']);

type Rates = Map<string, number>;
/** Demand per item; `ANY` = every item without a need of its own (storage, sinks: unlimited). */
const ANY = '*';

const add = (m: Rates, k: string, v: number) => { if (v !== 0) m.set(k, (m.get(k) ?? 0) + v); };

/**
 * Groups the snapshot's machines into production lines along `links`. Snapshots without `links` (extracted before
 * connections were read) give no lines.
 */
export function buildLines(
  s: Pick<FactorySnapshot, 'buildings' | 'links'>, analysis: FactoryAnalysis, data: AnalysisData,
): ProductionLines {
  const index = new Map<string, string>();
  if (!s.links?.length) return { lines: [], index };
  const building = new Map(s.buildings.map(b => [b.id, b]));
  const links = s.links.filter(l => l.from !== l.to && building.has(l.from) && building.has(l.to));
  const isMachine = (id: string) => analysis.byId.has(id);

  // --- Components, cut at boundaries ---
  const nodes = [...new Set(links.flatMap(l => [l.from, l.to]))].sort();
  const boundary = new Set(nodes.filter(id => !isMachine(id) && ALWAYS_BOUNDARY.test(building.get(id)!.cls)));
  let parts = components(nodes, links, boundary);
  const big = parts.filter(p => p.filter(isMachine).length > SPLIT_ABOVE);
  if (big.length > 0) {
    for (const p of big) for (const id of p) if (!isMachine(id) && STORAGE_BOUNDARY.test(building.get(id)!.cls)) boundary.add(id);
    parts = components(nodes, links, boundary);
  }

  const out = links.reduce((m, l) => (m.get(l.from)?.push(l) ?? m.set(l.from, [l]), m), new Map<string, SnapshotLink[]>());
  const inn = links.reduce((m, l) => (m.get(l.to)?.push(l) ?? m.set(l.to, [l]), m), new Map<string, SnapshotLink[]>());
  const ctx: Ctx = { building, analysis, data, boundary, out, inn, beltRate: new Map((data.recipes.data.belts ?? []).map(b => [b.id, b.rate])) };

  const lines: ProductionLine[] = [];
  for (const part of parts) {
    if (!part.some(isMachine)) continue;
    const members = new Set(part);
    for (const id of part) {
      for (const l of out.get(id) ?? []) if (boundary.has(l.to)) members.add(l.to);
      for (const l of inn.get(id) ?? []) if (boundary.has(l.from)) members.add(l.from);
    }
    lines.push(buildLine(members, ctx));
  }
  lines.sort((a, b) => b.machines.length - a.machines.length || a.id.localeCompare(b.id));

  // Index: inner buildings to their line; a boundary building to the line that feeds it most, else the one it feeds.
  for (const line of lines) {
    for (const id of line.buildings) if (!boundary.has(id)) index.set(id, line.id);
    for (const id of line.via ?? []) index.set(id, line.id);
  }
  for (const id of boundary) {
    const score = new Map<string, number>();
    for (const l of inn.get(id) ?? []) { const ln = index.get(l.from); if (ln && !boundary.has(l.from)) score.set(ln, (score.get(ln) ?? 0) + 1000); }
    for (const l of out.get(id) ?? []) { const ln = index.get(l.to); if (ln && !boundary.has(l.to)) score.set(ln, (score.get(ln) ?? 0) + 1); }
    let best: string | undefined, bestScore = 0;
    for (const [ln, sc] of score) if (sc > bestScore || (sc === bestScore && best !== undefined && ln < best)) { best = ln; bestScore = sc; }
    if (best) index.set(id, best);
  }
  return { lines, index };
}

interface Ctx {
  building: ReadonlyMap<string, SnapshotBuilding>;
  analysis: FactoryAnalysis;
  data: AnalysisData;
  boundary: ReadonlySet<string>;
  out: ReadonlyMap<string, SnapshotLink[]>;
  inn: ReadonlyMap<string, SnapshotLink[]>;
  beltRate: ReadonlyMap<string, number>;
}

/** Connected components of `nodes` over `links`, boundary nodes left out (they join no component). */
function components(nodes: readonly string[], links: readonly SnapshotLink[], boundary: ReadonlySet<string>): string[][] {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    while (parent.get(x) !== r) { const n = parent.get(x)!; parent.set(x, r); x = n; }
    return r;
  };
  for (const n of nodes) if (!boundary.has(n)) parent.set(n, n);
  for (const l of links) {
    if (boundary.has(l.from) || boundary.has(l.to)) continue;
    const a = find(l.from), b = find(l.to);
    if (a !== b) parent.set(a < b ? b : a, a < b ? a : b);
  }
  const by = new Map<string, string[]>();
  for (const n of parent.keys()) {
    const r = find(n);
    const list = by.get(r);
    if (list) list.push(n); else by.set(r, [n]);
  }
  return [...by.values()];
}

/**
 * Layers a directed graph: depth-first from `starts` (then from any node left, in the given order), edges that close
 * a loop (to a node on the current path) are `back`; `order` is a topological order of the rest and `rank` the longest
 * path from a node without (non-back) inputs.
 */
export function layer(nodes: readonly string[], edges: readonly (readonly [string, string])[], starts: readonly string[]): { order: string[]; back: Set<number>; rank: Map<string, number> } {
  const next = new Map<string, { to: string; e: number }[]>();
  edges.forEach(([a, b], e) => { const l = next.get(a); if (l) l.push({ to: b, e }); else next.set(a, [{ to: b, e }]); });
  const state = new Map<string, 1 | 2>();
  const back = new Set<number>();
  const post: string[] = [];
  const visit = (root: string) => {
    if (state.has(root)) return;
    const stack: { n: string; i: number }[] = [{ n: root, i: 0 }];
    state.set(root, 1);
    while (stack.length > 0) {
      const top = stack[stack.length - 1]!;
      const outs = next.get(top.n) ?? [];
      if (top.i < outs.length) {
        const { to, e } = outs[top.i++]!;
        const st = state.get(to);
        if (st === 1) back.add(e);
        else if (st === undefined) { state.set(to, 1); stack.push({ n: to, i: 0 }); }
      } else {
        state.set(top.n, 2);
        post.push(top.n);
        stack.pop();
      }
    }
  };
  for (const s of starts) visit(s);
  for (const n of nodes) visit(n);
  const order = post.reverse();
  const rank = new Map<string, number>(nodes.map(n => [n, 0]));
  const pos = new Map(order.map((n, i) => [n, i]));
  const sorted = edges.map((e, i) => i).filter(i => !back.has(i)).sort((x, y) => pos.get(edges[x]![0])! - pos.get(edges[y]![0])!);
  for (const i of sorted) {
    const [a, b] = edges[i]!;
    rank.set(b, Math.max(rank.get(b)!, rank.get(a)! + 1));
  }
  return { order, back, rank };
}

function buildLine(members: ReadonlySet<string>, ctx: Ctx): ProductionLine {
  const { building, analysis, data, boundary } = ctx;
  const ids = [...members].sort();
  const links = ids.flatMap(id => (ctx.out.get(id) ?? []).filter(l => members.has(l.to) && !(boundary.has(l.from) && boundary.has(l.to))));
  const machineOf = (id: string) => analysis.byId.get(id);
  const outs = new Map<string, SnapshotLink[]>(), ins = new Map<string, SnapshotLink[]>();
  for (const l of links) {
    (outs.get(l.from) ?? outs.set(l.from, []).get(l.from)!).push(l);
    (ins.get(l.to) ?? ins.set(l.to, []).get(l.to)!).push(l);
  }
  const fluid = (item: string) => { const it = data.recipes.items.get(item); return it !== undefined && it.form !== 'solid'; };
  const known = (item: string) => data.recipes.items.has(item);

  // --- Rates per machine: measured actual outputs and inputs ---
  const outputs = new Map<string, Rates>(), inputs = new Map<string, Rates>();
  for (const id of ids) {
    const m = machineOf(id);
    if (!m) continue;
    const o: Rates = new Map();
    for (const r of m.outputs) add(o, r.item, r.actual);
    outputs.set(id, o);
    const seen = new Set<string>();
    for (const l of ins.get(id) ?? []) { for (const item of Object.keys(l.items ?? {})) seen.add(item); if (l.fluid) seen.add(l.fluid); }
    inputs.set(id, machineInputs(m, data, seen));
  }

  // --- Flows: demand backwards, supply forwards (node level) ---
  const starts = ids.filter(id => !(ins.get(id)?.length) || boundary.has(id));
  const nodeLayer = layer(ids, links.map(l => [l.from, l.to] as const), starts);
  const linkIndex = new Map(links.map((l, i) => [l, i]));
  const isBack = (l: SnapshotLink) => nodeLayer.back.has(linkIndex.get(l)!);
  const canCarry = (l: SnapshotLink, item: string) => (known(item) ? fluid(item) === (l.kind === 'pipe') : true);
  const mayCarry = (l: SnapshotLink, item: string) => (l.kind === 'pipe' ? !l.fluid || l.fluid === item : !l.items || item in l.items);
  /**
   * Links of `list` that can carry `item`: by form (belt: solid, pipe: fluid), without those known to carry something
   * else (a pipe's fluid, a belt with items on it but none of this one).
   */
  const carriers = (list: readonly SnapshotLink[], item: string) => list.filter(l => canCarry(l, item) && mayCarry(l, item));
  const demand = new Map<SnapshotLink, Rates>();
  /** A link's need of an item: what its consumers need of it plus what storage, sinks or stations behind it take. */
  const need = (l: SnapshotLink, item: string) => { const d = demand.get(l); return (d?.get(item) ?? 0) + (d?.get(ANY) ?? 0); };
  /** Pass-through logistics (splitters, mergers, junctions, pumps, valves) neither take nor give on their own. */
  const passes = (id: string) => PASS.has(logisticsKind(building.get(id)!.cls));
  const absorbs = (id: string) => boundary.has(id) || (!machineOf(id) && !passes(id) && !(outs.get(id)?.length));
  // Links that close a loop carry nothing back (no need): the loop's overflow is left out of the estimate.
  for (const l of links) if (isBack(l)) demand.set(l, new Map());
  for (const id of [...nodeLayer.order].reverse()) {
    const into = (ins.get(id) ?? []).filter(l => !isBack(l));
    if (into.length === 0) continue;
    if (absorbs(id)) { for (const l of into) demand.set(l, new Map([[ANY, Infinity]])); continue; }
    if (machineOf(id)) {
      for (const l of into) demand.set(l, new Map());
      for (const [item, rate] of inputs.get(id)!) {
        const c = carriers(into, item);
        for (const l of c) demand.get(l)!.set(item, rate / c.length);
      }
      continue;
    }
    const d: Rates = new Map();
    for (const l of outs.get(id) ?? []) {
      if (isBack(l)) continue;
      for (const [item, v] of demand.get(l) ?? []) d.set(item, (d.get(item) ?? 0) + v);
    }
    for (const l of into) demand.set(l, new Map(d));
  }

  const flow = new Map<SnapshotLink, Rates>(links.map(l => [l, new Map()]));
  const capacity = (l: SnapshotLink) => (l.kind === 'belt' && l.slowest ? ctx.beltRate.get(l.slowest) : undefined) ?? Infinity;
  /** What a link can still take: its capacity less what it carries already (all items). */
  const room = (l: SnapshotLink) => { let used = 0; for (const v of flow.get(l)!.values()) used += v; return Math.max(0, capacity(l) - used); };
  const inflow = new Map<string, Rates>();
  const leftover: Rates = new Map(); // machine outputs with no link to leave by ("nowhere")
  for (const id of nodeLayer.order) {
    const from = outs.get(id) ?? [];
    const m = machineOf(id);
    const source = !m && (boundary.has(id) || (!passes(id) && !(ins.get(id)?.length)));
    if (source) {
      // Delivers what is taken: the finite needs of its links (only items seen on them, when known), up to capacity.
      for (const l of from) {
        const f = flow.get(l)!;
        for (const [item, v] of demand.get(l) ?? []) {
          if (item === ANY || !Number.isFinite(v) || !canCarry(l, item) || !mayCarry(l, item)) continue;
          add(f, item, Math.min(v, room(l)));
        }
      }
    } else if (m || from.length > 0) {
      const supply = m ? outputs.get(id)! : inflow.get(id) ?? new Map<string, number>();
      for (const [item, amount] of supply) {
        const c = carriers(from, item);
        if (c.length === 0) { if (m) add(leftover, item, amount); continue; }
        const finite = c.filter(l => Number.isFinite(need(l, item)) && need(l, item) > 0);
        const open = c.filter(l => !Number.isFinite(need(l, item)));
        const rest = waterFill(amount, finite.map(l => Math.min(need(l, item), room(l))), (i, v) => add(flow.get(finite[i]!)!, item, v));
        if (open.length > 0 && rest > 1e-9) waterFill(rest, open.map(room), (i, v) => add(flow.get(open[i]!)!, item, v));
      }
    }
    for (const l of from) {
      if (isBack(l)) continue;
      let r = inflow.get(l.to);
      if (!r) inflow.set(l.to, (r = new Map()));
      for (const [item, v] of flow.get(l)!) add(r, item, v);
    }
  }

  // --- Groups: manifolds, then stages, then machines by class + recipe + stage ---
  const unitOf = new Map<string, string>();
  const kindOf = new Map<string, LogisticsKind>();
  for (const id of ids) if (!machineOf(id)) kindOf.set(id, logisticsKind(building.get(id)!.cls));
  for (const id of ids) unitOf.set(id, id);
  const findUnit = (x: string): string => { while (unitOf.get(x) !== x) x = unitOf.get(x)!; return x; };
  for (const l of links) {
    const ka = kindOf.get(l.from), kb = kindOf.get(l.to);
    if (!ka || ka !== kb || !MANIFOLD.has(ka) || boundary.has(l.from) || boundary.has(l.to)) continue;
    const a = findUnit(l.from), b = findUnit(l.to);
    if (a !== b) unitOf.set(a < b ? b : a, a < b ? a : b);
  }
  const units = [...new Set(ids.map(findUnit))].sort();
  const unitEdges: [string, string][] = [];
  const seenEdge = new Set<string>();
  for (const l of links) {
    const a = findUnit(l.from), b = findUnit(l.to);
    if (a === b || seenEdge.has(`${a}>${b}`)) continue;
    seenEdge.add(`${a}>${b}`);
    unitEdges.push([a, b]);
  }
  const hasIn = new Set(unitEdges.map(e => e[1]));
  const extractor = (u: string) => machineOf(u)?.kind === 'extractor';
  const unitStarts = units.filter(u => !hasIn.has(u)).sort((a, b) => Number(extractor(b)) - Number(extractor(a)) || a.localeCompare(b));
  const stageOf = layer(units, unitEdges, unitStarts).rank;

  const groupKey = (id: string) => {
    const m = machineOf(id);
    if (!m) return `u:${findUnit(id)}`;
    return `m:${m.cls}|${m.recipe ?? m.outputs[0]?.item ?? ''}|${stageOf.get(id)}`;
  };
  const groupMembers = new Map<string, string[]>();
  for (const id of ids) { const k = groupKey(id); (groupMembers.get(k) ?? groupMembers.set(k, []).get(k)!).push(id); }
  const groupOf = new Map<string, string>();
  const groups: LineGroup[] = [];
  for (const list of groupMembers.values()) {
    const gid = list[0]!;
    for (const id of list) groupOf.set(id, gid);
    groups.push(machineOf(gid) ? machineGroup(gid, list, stageOf.get(gid)!, ctx, inputs) : logisticsGroup(gid, list, stageOf.get(findUnit(gid))!, ctx, flow, ins, outs, kindOf));
  }
  groups.sort((a, b) => a.stage - b.stage || Number(a.logistics ?? false) - Number(b.logistics ?? false) || a.cls.localeCompare(b.cls) || a.id.localeCompare(b.id));
  for (const g of groups) for (const r of [g.outputs, g.inputs, g.nominal]) for (const x of r) if (fluid(x.item)) x.fluid = true;

  // --- Edges between groups ---
  const edgeAt = new Map<string, { e: LineEdge; rates: Rates; caps: (number | undefined)[]; slowRate: number }>();
  for (const l of links) {
    const a = groupOf.get(l.from)!, b = groupOf.get(l.to)!;
    if (a === b) continue;
    const key = `${a}>${b}`;
    let x = edgeAt.get(key);
    if (!x) edgeAt.set(key, (x = { e: { from: a, to: b, links: 0, via: [] }, rates: new Map(), caps: [], slowRate: Infinity }));
    x.e.links++;
    x.e.via.push(...l.via);
    for (const [item, v] of flow.get(l)!) add(x.rates, item, v);
    const cap = l.kind === 'belt' && l.slowest ? ctx.beltRate.get(l.slowest) : undefined;
    x.caps.push(cap);
    // The slowest class: the one with the lowest known rate, else the first one named.
    if (l.slowest && (cap !== undefined ? cap < x.slowRate : x.e.slowest === undefined)) {
      x.e.slowest = l.slowest;
      if (cap !== undefined) x.slowRate = cap;
    }
  }
  const edges: LineEdge[] = [];
  for (const { e, rates, caps } of edgeAt.values()) {
    const list = rateList(rates, fluid);
    if (list.length > 0) {
      e.item = list[0]!.item;
      e.perMin = list.reduce((s, r) => s + r.perMin, 0);
      if (list.length > 1) e.items = list;
    } else {
      // No flow: name the item from the belt contents or the pipe's fluid, when known.
      const seen = rateList(new Map(Object.entries(links.find(l => groupOf.get(l.from) === e.from && groupOf.get(l.to) === e.to)?.items ?? {})), fluid);
      const f = links.find(l => groupOf.get(l.from) === e.from && groupOf.get(l.to) === e.to && l.fluid)?.fluid;
      if (seen[0]) e.item = seen[0].item; else if (f) e.item = f;
      e.perMin = 0;
    }
    if (caps.every(c => c !== undefined) && caps.length > 0) {
      e.capacity = caps.reduce<number>((s, c) => s + c!, 0);
      if (e.perMin !== undefined && e.perMin >= e.capacity * SATURATED_FROM) e.saturated = true;
    }
    edges.push(e);
  }
  const stageOfGroup = new Map(groups.map(g => [g.id, g.stage]));
  edges.sort((a, b) => stageOfGroup.get(a.from)! - stageOfGroup.get(b.from)! || a.from.localeCompare(b.from) || a.to.localeCompare(b.to));

  // --- Products and inputs of the line ---
  const products: Rates = new Map(leftover), lineInputs: Rates = new Map();
  for (const l of links) {
    const f = flow.get(l)!;
    if (absorbs(l.to)) for (const [item, v] of f) add(products, item, v);
    if (!machineOf(l.from) && (boundary.has(l.from) || !(ins.get(l.from)?.length))) for (const [item, v] of f) add(lineInputs, item, v);
  }
  const productList = rateList(products, fluid);
  const machines = ids.filter(id => machineOf(id));
  const flows = machines.map(id => machineOf(id)!);
  const measured = flows.filter(m => m.measured);
  const mean = (list: readonly MachineFlow[]) => (list.length > 0 ? list.reduce((s, m) => s + m.productivity, 0) / list.length : 0);

  // Nominal of a product: its makers' nominal (not paused) scaled by the share of their actual output that leaves.
  let nominalSolid = 0, nominalFluid = 0;
  for (const p of productList) {
    let act = 0, nom = 0;
    for (const m of flows) {
      if (m.paused) continue;
      const o = m.outputs.find(r => r.item === p.item);
      if (o) { act += o.actual; nom += o.nominal; }
    }
    const share = act > 0 ? Math.min(1, p.perMin / act) : 1;
    const n = nom > 0 ? nom * share : p.perMin;
    if (p.fluid) nominalFluid += n; else nominalSolid += n;
  }
  const solids = productList.filter(p => !p.fluid);
  const actual = (solids.length > 0 ? solids : productList).reduce((s, p) => s + p.perMin, 0);

  const line: ProductionLine = {
    id: lineId(machines, groups, groupOf, machineOf),
    products: productList,
    inputs: rateList(lineInputs, fluid),
    buildings: ids,
    via: links.flatMap(l => l.via),
    machines,
    groups,
    edges,
    productivity: mean(measured.length > 0 ? measured : flows),
    nominal: solids.length > 0 ? nominalSolid : nominalFluid,
    actual,
  };
  const bottleneck = findBottleneck(groups, edges);
  if (bottleneck) line.bottleneck = bottleneck;
  return line;
}

/** Splits `amount` over needs evenly, none above its need; calls `give` per index and returns what is left. */
function waterFill(amount: number, needs: readonly number[], give: (i: number, v: number) => void): number {
  const order = needs.map((n, i) => i).sort((a, b) => needs[a]! - needs[b]!);
  let left = amount;
  for (let k = 0; k < order.length; k++) {
    const i = order[k]!;
    const v = Math.min(needs[i]!, left / (order.length - k));
    if (v > 0) give(i, v);
    left -= v;
  }
  return left;
}

/**
 * A machine's measured inputs per minute: recipe ingredients; for a generator the fuel it is fed (the fuels among
 * `seen`, the items on its input belts and pipes; without any, its first fuel) and its supplement (water).
 */
export function machineInputs(m: MachineFlow, data: AnalysisData, seen: ReadonlySet<string> = new Set()): Rates {
  const r: Rates = new Map();
  const k = m.clock * m.productivity;
  if (m.kind === 'manufacturer') {
    const recipe = data.recipes.recipes.get(m.recipe!);
    for (const i of recipe?.ingredients ?? []) add(r, i.item, (i.amount * 60 / recipe!.duration) * k);
  } else if (m.kind === 'generator') {
    const fuels = data.machines?.get(m.cls)?.stats.fuels ?? [];
    const fed = fuels.filter(f => seen.has(f.item));
    for (const f of fed.length > 0 ? fed : fuels.slice(0, 1)) {
      if (f.perMinute !== undefined) r.set(f.item, Math.max(r.get(f.item) ?? 0, f.perMinute * k));
      if (f.supplement) r.set(f.supplement.item, Math.max(r.get(f.supplement.item) ?? 0, f.supplement.amount * k));
    }
  }
  return r;
}

const rateList = (m: ReadonlyMap<string, number>, fluid: (item: string) => boolean): LineRate[] =>
  [...m].filter(([, v]) => v >= 0.01).map(([item, perMin]) => (fluid(item) ? { item, perMin, fluid: true } : { item, perMin }))
    .sort((a, b) => b.perMin - a.perMin || a.item.localeCompare(b.item));

function reasonCounts(flows: readonly MachineFlow[]): LineGroup['reasons'] {
  const n = new Map<Reason, number>();
  for (const m of flows) for (const r of m.reasons) n.set(r, (n.get(r) ?? 0) + 1);
  return REASONS.filter(r => n.has(r)).map(reason => ({ reason, count: n.get(reason)! })).sort((a, b) => b.count - a.count);
}

function machineGroup(id: string, members: string[], stage: number, ctx: Ctx, inputs: ReadonlyMap<string, Rates>): LineGroup {
  const flows = members.map(m => ctx.analysis.byId.get(m)!);
  const fluid = (item: string) => (ctx.data.recipes.items.get(item)?.form ?? 'solid') !== 'solid';
  const out: Rates = new Map(), nom: Rates = new Map(), inp: Rates = new Map();
  for (const m of flows) {
    for (const o of m.outputs) { add(out, o.item, o.actual); if (!m.paused) add(nom, o.item, o.nominal); }
    for (const [item, v] of inputs.get(m.id) ?? []) add(inp, item, v);
  }
  const measured = flows.filter(m => m.measured);
  const base = measured.length > 0 ? measured : flows;
  const productivity = base.reduce((s, m) => s + m.productivity, 0) / base.length;
  const running = flows.filter(m => !m.paused);
  const runMean = running.length > 0 ? running.reduce((s, m) => s + m.productivity, 0) / running.length : 0;
  const g: LineGroup = {
    id, cls: flows[0]!.cls, members, stage,
    outputs: rateList(out, fluid), inputs: rateList(inp, fluid), nominal: rateList(nom, fluid),
    productivity,
    state: running.length === 0 ? 'paused' : bandOf(runMean),
    reasons: reasonCounts(flows),
  };
  if (running.length > 0) g.band = bandOf(runMean);
  const recipe = flows[0]!.recipe;
  if (recipe) g.recipe = recipe;
  return g;
}

/**
 * A logistics group: its members' class when they share one, else the kind; inputs and outputs are what flows in and
 * out of the group from other groups. Logistics buildings have no productivity of their own: 1, state `full`, no band.
 */
function logisticsGroup(
  id: string, members: string[], stage: number, ctx: Ctx, flow: ReadonlyMap<SnapshotLink, Rates>,
  ins: ReadonlyMap<string, SnapshotLink[]>, outs: ReadonlyMap<string, SnapshotLink[]>, kindOf: ReadonlyMap<string, LogisticsKind>,
): LineGroup {
  const set = new Set(members);
  const fluid = (item: string) => (ctx.data.recipes.items.get(item)?.form ?? 'solid') !== 'solid';
  const inp: Rates = new Map(), out: Rates = new Map();
  for (const m of members) {
    for (const l of ins.get(m) ?? []) if (!set.has(l.from)) for (const [item, v] of flow.get(l) ?? []) add(inp, item, v);
    for (const l of outs.get(m) ?? []) if (!set.has(l.to)) for (const [item, v] of flow.get(l) ?? []) add(out, item, v);
  }
  const classes = new Set(members.map(m => ctx.building.get(m)!.cls));
  const kind = kindOf.get(id) ?? 'other';
  return {
    id, cls: classes.size === 1 ? [...classes][0]! : kind, members, stage,
    outputs: rateList(out, fluid), inputs: rateList(inp, fluid), nominal: [],
    productivity: 1, state: 'full', reasons: [], logistics: true, kind,
  };
}

/** The line's id: its most downstream machine (highest stage, then most output, then the smallest id). */
function lineId(machines: readonly string[], groups: readonly LineGroup[], groupOf: ReadonlyMap<string, string>, machineOf: (id: string) => MachineFlow | undefined): string {
  const stage = new Map(groups.map(g => [g.id, g.stage]));
  const out = (id: string) => machineOf(id)!.outputs.reduce((s, o) => s + o.actual, 0);
  return [...machines].sort((a, b) => stage.get(groupOf.get(b)!)! - stage.get(groupOf.get(a)!)! || out(b) - out(a) || a.localeCompare(b))[0]!;
}

function mainReason(g: LineGroup): Reason | null {
  const list = g.reasons.filter(r => r.reason !== 'paused' && r.reason !== 'surplus');
  return list[0]?.reason ?? null;
}

function findBottleneck(groups: readonly LineGroup[], edges: readonly LineEdge[]): LineBottleneck | undefined {
  const byId = new Map(groups.map(g => [g.id, g]));
  const next = new Map<string, LineEdge[]>();
  for (const e of edges) (next.get(e.from) ?? next.set(e.from, []).get(e.from)!).push(e);
  const loss = new Map(groups.map(g => [g.id, groupLoss(g)]));
  const prev = new Map<string, LineEdge[]>();
  for (const e of edges) (prev.get(e.to) ?? prev.set(e.to, []).get(e.to)!).push(e);
  /** The machine groups reached from `id` (downstream, or upstream with `back`) through logistics groups only. */
  const machinesNear = (id: string, back = false): LineGroup[] => {
    const outList: LineGroup[] = [];
    const seen = new Set<string>([id]);
    const queue = [id];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      for (const e of (back ? prev : next).get(cur) ?? []) {
        const other = back ? e.from : e.to;
        if (seen.has(other)) continue;
        seen.add(other);
        const g = byId.get(other)!;
        if (g.logistics) queue.push(g.id); else outList.push(g);
      }
    }
    return outList;
  };
  const machinesAfter = (id: string) => machinesNear(id);
  const backsUp = (g: LineGroup) => g.reasons.some(r => r.reason === 'blocked' || r.reason === 'surplus');

  // (1) A saturated edge whose next machines starve while the machines before it back up.
  let bestEdge = -1, bestStarve = 0;
  edges.forEach((e, i) => {
    if (!e.saturated) return;
    const from = byId.get(e.from)!, to = byId.get(e.to)!;
    if (!(from.logistics ? machinesNear(from.id, true) : [from]).some(backsUp)) return;
    const after = to.logistics ? machinesAfter(to.id) : [to];
    const starve = after.filter(g => g.reasons.some(r => r.reason === 'starved')).reduce((s, g) => s + loss.get(g.id)!, 0);
    if (starve > bestStarve + 1e-9) { bestStarve = starve; bestEdge = i; }
  });
  if (bestEdge >= 0) return { kind: 'edge', edge: bestEdge, why: 'capacity' };

  // (2) The machine group losing most, followed downstream while it backs up.
  let worst: LineGroup | undefined;
  for (const g of groups) if (!g.logistics && loss.get(g.id)! > (worst ? loss.get(worst.id)! : MIN_LOSS)) worst = g;
  if (!worst) return undefined;
  let cur = worst;
  const visited = new Set<string>();
  for (;;) {
    visited.add(cur.id);
    const why = mainReason(cur);
    if (why !== 'blocked') return { kind: 'group', group: cur.id, why: why ?? cur.reasons[0]?.reason ?? 'unknown' };
    const after = machinesAfter(cur.id).filter(g => !visited.has(g.id));
    if (after.length === 0) return { kind: 'group', group: cur.id, why: 'demand' };
    const nxt = after.reduce((a, b) => (loss.get(b.id)! > loss.get(a.id)! ? b : a));
    if (loss.get(nxt.id)! <= MIN_LOSS) return { kind: 'group', group: cur.id, why: 'demand' };
    cur = nxt;
  }
}

/** A group's lost machine-equivalents from its own figures: members × (1 − productivity), surplus-only groups none. */
function groupLoss(g: LineGroup): number {
  if (g.logistics || g.state === 'paused') return 0;
  if (g.reasons.length > 0 && g.reasons.every(r => r.reason === 'surplus' || r.reason === 'paused')) return 0;
  return g.members.length * (1 - g.productivity);
}
