import type { MachineEntry } from '../machines.js';
import { PURITY_FACTOR } from '../planner.js';
import type { GameExtractor, RecipeIndex } from '../recipes.js';
import type { ResourceNode } from '../resourceNodes.js';
import type { FactorySnapshot, SnapshotBuilding, SnapshotProduction, SnapshotStation, SnapshotVehicle } from './snapshot.js';
import { IDLE_PRODUCTIVITY } from './storage.js';

/*
 * Factory efficiency, pure: what each machine of a snapshot should make (nominal), makes (actual) and loses, summed
 * per item, per machine class and for the whole factory; the difference between two snapshots; and the vehicle routes
 * with their throughput. Used by the factory page and the factory map.
 *
 * Rates are per minute; fluids in m³ (as `recipes.json` has them).
 * - Manufacturer: recipe product amount × 60 / duration × clock × Somersloop boost (1 + loops / slots).
 * - Extractor: its rate at 100 % × node purity × clock (a resource well extractor at its pressurizer's clock); the
 *   water extractor has no node. Without the node's resource the extractor still counts, with no output.
 * - Generator: power only (MW at 100 % × clock; geothermal: its average × purity), no items.
 * actual = nominal × productivity, lost = nominal − actual. A machine without a measurement (just built, paused
 * since loading) counts as 0 % unless it was producing when saved (then 100 %).
 */

/** Why a machine is below full productivity, in the order a machine's reasons are listed (first = main reason). */
export const REASONS = ['paused', 'noPower', 'noRecipe', 'noFuel', 'starved', 'blocked', 'unknown'] as const;
export type Reason = (typeof REASONS)[number];

/** Productivity bands: standing (< 1 %), throttled (1–90 %), high (90–99 %), full (≥ 99 %). */
export const BANDS = ['idle', 'throttled', 'high', 'full'] as const;
export type Band = (typeof BANDS)[number];

/** Below this productivity a machine counts as inefficient (also above it when it reports an issue). */
export const INEFFICIENT_BELOW = 0.9;
/** At or above this productivity a machine runs fully (the same threshold the extraction uses for issues). */
export const FULL_FROM = 0.99;

export function bandOf(productivity: number): Band {
  if (productivity < IDLE_PRODUCTIVITY) return 'idle';
  if (productivity < INEFFICIENT_BELOW) return 'throttled';
  if (productivity < FULL_FROM) return 'high';
  return 'full';
}

export type MachineKind = 'manufacturer' | 'extractor' | 'generator' | 'other';

export interface ItemRate {
  item: string;
  nominal: number;
  actual: number;
  lost: number;
}

export interface MachineFlow {
  id: string;
  cls: string;
  x: number; y: number; z: number;
  kind: MachineKind;
  recipe?: string;
  clock: number;
  /** 0..1 as measured; see `measured`. */
  productivity: number;
  /** False when the save had no measurement (the value is then 0 or 1, see the module notes). */
  measured: boolean;
  band: Band;
  powerShards: number;
  somersloops: number;
  /** Output multiplier from Somersloops: 1 + loops / slots (2 with every slot filled). */
  boost: number;
  /** Every reason that applies, in `REASONS` order; `unknown` when it is below full without a known reason. */
  reasons: Reason[];
  /** The main reason (first of `reasons`), or null when it runs fully without issues. */
  reason: Reason | null;
  /** Productivity below 90 % or an issue reported. */
  inefficient: boolean;
  /** What it makes, per minute; the main product first. Empty for generators and unknown resources. */
  outputs: ItemRate[];
  /** Total lost output per minute over all outputs (mixed units; for sorting within one item, use `outputs`). */
  lost: number;
  /** Generators: MW at its clock (`nominal`) and as it ran (`actual`). */
  power?: { nominal: number; actual: number };
  /** Resource node it stands on (extractors). */
  node?: string;
}

export interface ItemFlow extends ItemRate {
  /** Machines making it (as main or by-product), most loss first. */
  machines: MachineFlow[];
  /** Loss per main reason of the machines (per minute). */
  lostBy: Partial<Record<Reason, number>>;
  /** The reason behind most of the loss, or null without loss. */
  mainReason: Reason | null;
}

export interface ClassStats {
  cls: string;
  kind: MachineKind;
  count: number;
  /** Mean productivity weighted by each machine's nominal output (its clock × Somersloop boost). */
  avgProductivity: number;
  bands: Record<Band, number>;
  /** Machines per main reason. */
  reasons: Partial<Record<Reason, number>>;
  inefficient: number;
}

export interface FactoryTotals {
  machines: number;
  /** Weighted like `ClassStats.avgProductivity`; null without machines. */
  avgProductivity: number | null;
  bands: Record<Band, number>;
  inefficient: number;
  reasons: Partial<Record<Reason, number>>;
  /** MW produced by generators (as they ran) and what they would make at their clock; null without generators. */
  power: { produced: number; producible: number } | null;
}

export interface FactoryAnalysis {
  machines: MachineFlow[];
  byId: ReadonlyMap<string, MachineFlow>;
  /** Items with a nominal rate, most loss first. */
  items: ItemFlow[];
  /** Machine classes, most machines first. */
  classes: ClassStats[];
  totals: FactoryTotals;
}

/** What the analysis reads besides the snapshot. Everything is optional except the recipes. */
export interface AnalysisData {
  recipes: RecipeIndex;
  /** `machines.json` entries by class: generator power, Somersloop slots. */
  machines?: ReadonlyMap<string, MachineEntry>;
  /** The world's resource nodes by name: resource and purity of the node an extractor stands on. */
  nodes?: ReadonlyMap<string, Pick<ResourceNode, 'kind' | 'resource' | 'purity' | 'core'>>;
}

const WELL_EXTRACTOR = 'Build_FrackingExtractor_C';
const PRESSURIZER = 'Build_FrackingSmasher_C';
const GENERATOR = /Generator/;

function kindOf(b: SnapshotBuilding, data: AnalysisData): MachineKind {
  const prod = b.prod!;
  if (prod.recipe && data.recipes.recipes.has(prod.recipe)) return 'manufacturer';
  if (data.recipes.extractors.has(b.cls)) return 'extractor';
  const entry = data.machines?.get(b.cls);
  if (entry?.category === 'power' || GENERATOR.test(b.cls)) return 'generator';
  return 'other';
}

/**
 * A machine's reasons from its issues (see `extract.ts`) and pause state. Below full productivity without a reported
 * issue: an extractor (no inputs) can only have been held up by its output, so `blocked`; anything else ran only part
 * of the measurement window for a cause no longer visible when saved (`unknown`, shown as "runs intermittently").
 */
export function reasonsOf(prod: SnapshotProduction, productivity: number, kind: MachineKind = 'other'): Reason[] {
  const set = new Set<Reason>(prod.issues ?? []);
  if (prod.paused) set.add('paused');
  if (set.size === 0 && productivity < FULL_FROM) set.add(kind === 'extractor' ? 'blocked' : 'unknown');
  return REASONS.filter(r => set.has(r));
}

const sloopBoost = (prod: SnapshotProduction, entry: MachineEntry | undefined) => {
  const slots = entry?.stats.somersloopSlots ?? 0;
  return slots > 0 && prod.somersloops ? 1 + Math.min(prod.somersloops, slots) / slots : 1;
};

/** Pressurizer clock per resource well core (the node name its `node` field holds). */
function pressurizerClocks(s: FactorySnapshot): Map<string, number> {
  const out = new Map<string, number>();
  for (const b of s.buildings) if (b.cls === PRESSURIZER && b.node && b.prod) out.set(b.node, b.prod.clock);
  return out;
}

function extractorOutput(b: SnapshotBuilding, ex: GameExtractor, data: AnalysisData, pressurizers: Map<string, number>): { item: string; nominal: number } | null {
  const clock = b.prod!.clock;
  if (!ex.onNode) {
    const item = ex.resources.length === 1 ? ex.resources[0]! : undefined;
    return item ? { item, nominal: ex.rate * clock } : null;
  }
  const node = b.node ? data.nodes?.get(b.node) : undefined;
  if (!node || node.purity === null) return null;
  const c = b.cls === WELL_EXTRACTOR ? (node.core !== undefined ? pressurizers.get(node.core) : undefined) ?? 1 : clock;
  return { item: node.resource, nominal: ex.rate * PURITY_FACTOR[node.purity] * c };
}

function generatorPower(b: SnapshotBuilding, data: AnalysisData): number | undefined {
  const stats = data.machines?.get(b.cls)?.stats;
  if (!stats) return undefined;
  if (stats.powerProduction !== undefined) return stats.powerProduction * b.prod!.clock;
  if (stats.powerVariable) {
    const node = b.node ? data.nodes?.get(b.node) : undefined;
    return stats.powerVariable.average * (node?.purity ? PURITY_FACTOR[node.purity] : 1);
  }
  return undefined;
}

/** One machine's flow (a building with `prod`). */
export function machineFlow(b: SnapshotBuilding, data: AnalysisData, pressurizers = new Map<string, number>()): MachineFlow {
  const prod = b.prod!;
  const measured = prod.productivity !== undefined;
  const productivity = Math.min(1, Math.max(0, prod.productivity ?? (prod.producing ? 1 : 0)));
  const kind = kindOf(b, data);
  const boost = sloopBoost(prod, data.machines?.get(b.cls));
  const reasons = reasonsOf(prod, productivity, kind);
  const outputs: ItemRate[] = [];
  const add = (item: string, nominal: number) => {
    const actual = nominal * productivity;
    outputs.push({ item, nominal, actual, lost: nominal - actual });
  };
  let power: MachineFlow['power'];
  if (kind === 'manufacturer') {
    const r = data.recipes.recipes.get(prod.recipe!)!;
    const perCycle = (60 / r.duration) * prod.clock * boost;
    for (const p of r.products) add(p.item, p.amount * perCycle);
  } else if (kind === 'extractor') {
    const out = extractorOutput(b, data.recipes.extractors.get(b.cls)!, data, pressurizers);
    if (out) add(out.item, out.nominal);
  } else if (kind === 'generator') {
    const mw = generatorPower(b, data);
    if (mw !== undefined) power = { nominal: mw, actual: mw * productivity };
  }
  const flow: MachineFlow = {
    id: b.id, cls: b.cls, x: b.x, y: b.y, z: b.z, kind, clock: prod.clock, productivity, measured, band: bandOf(productivity),
    powerShards: prod.powerShards ?? 0, somersloops: prod.somersloops ?? 0, boost,
    reasons, reason: reasons[0] ?? null,
    inefficient: productivity < INEFFICIENT_BELOW || (prod.issues?.length ?? 0) > 0 || prod.paused === true,
    outputs, lost: outputs.reduce((s, o) => s + o.lost, 0),
  };
  if (prod.recipe) flow.recipe = prod.recipe;
  if (power) flow.power = power;
  if (b.node) flow.node = b.node;
  return flow;
}

const emptyBands = (): Record<Band, number> => ({ idle: 0, throttled: 0, high: 0, full: 0 });
const bump = <K extends string>(rec: Partial<Record<K, number>>, k: K, by = 1) => { rec[k] = (rec[k] ?? 0) + by; };

/** The weight of a machine in averages: its nominal output relative to one machine at 100 % (clock × boost). */
const weightOf = (m: MachineFlow) => m.clock * m.boost;

/** The analysis of one snapshot. */
export function analyzeFactory(s: Pick<FactorySnapshot, 'buildings'>, data: AnalysisData): FactoryAnalysis {
  const pressurizers = pressurizerClocks(s as FactorySnapshot);
  const machines = s.buildings.filter(b => b.prod).map(b => machineFlow(b, data, pressurizers));
  const byId = new Map(machines.map(m => [m.id, m]));

  const items = new Map<string, ItemFlow>();
  for (const m of machines) {
    for (const o of m.outputs) {
      let it = items.get(o.item);
      if (!it) items.set(o.item, (it = { item: o.item, nominal: 0, actual: 0, lost: 0, machines: [], lostBy: {}, mainReason: null }));
      it.nominal += o.nominal;
      it.actual += o.actual;
      it.lost += o.lost;
      it.machines.push(m);
      if (o.lost > 0 && m.reason) bump(it.lostBy, m.reason, o.lost);
    }
  }
  for (const it of items.values()) {
    it.machines.sort((a, b) => lostOf(b, it.item) - lostOf(a, it.item) || a.productivity - b.productivity);
    it.mainReason = mainOf(it.lostBy);
  }

  const classes = new Map<string, ClassStats & { w: number; wp: number }>();
  const totals: FactoryTotals = { machines: machines.length, avgProductivity: null, bands: emptyBands(), inefficient: 0, reasons: {}, power: null };
  let w = 0, wp = 0;
  for (const m of machines) {
    let c = classes.get(m.cls);
    if (!c) classes.set(m.cls, (c = { cls: m.cls, kind: m.kind, count: 0, avgProductivity: 0, bands: emptyBands(), reasons: {}, inefficient: 0, w: 0, wp: 0 }));
    const weight = weightOf(m);
    c.count++;
    c.w += weight;
    c.wp += weight * m.productivity;
    c.bands[m.band]++;
    totals.bands[m.band]++;
    if (m.reason) { bump(c.reasons, m.reason); bump(totals.reasons, m.reason); }
    if (m.inefficient) { c.inefficient++; totals.inefficient++; }
    w += weight;
    wp += weight * m.productivity;
    if (m.power) {
      totals.power ??= { produced: 0, producible: 0 };
      totals.power.produced += m.power.actual;
      totals.power.producible += m.power.nominal;
    }
  }
  totals.avgProductivity = w > 0 ? wp / w : null;
  const classList = [...classes.values()].map(({ w: cw, wp: cwp, ...c }) => ({ ...c, avgProductivity: cw > 0 ? cwp / cw : 0 }));
  classList.sort((a, b) => b.count - a.count || a.cls.localeCompare(b.cls));

  return {
    machines, byId,
    items: [...items.values()].sort((a, b) => b.lost - a.lost || b.nominal - a.nominal || a.item.localeCompare(b.item)),
    classes: classList,
    totals,
  };
}

/** A machine's lost output of one item per minute. */
export function lostOf(m: MachineFlow, item: string): number {
  return m.outputs.find(o => o.item === item)?.lost ?? 0;
}

function mainOf(by: Partial<Record<Reason, number>>): Reason | null {
  let best: Reason | null = null;
  for (const r of REASONS) if ((by[r] ?? 0) > 1e-9 && (best === null || by[r]! > by[best]!)) best = r;
  return best;
}

/** The machines matching a filter (null fields match everything). */
export interface MachineFilter { cls?: string | null; item?: string | null; reason?: Reason | null; band?: Band | null }

export function filterMachines(machines: readonly MachineFlow[], f: MachineFilter): MachineFlow[] {
  return machines.filter(m => (!f.cls || m.cls === f.cls)
    && (!f.item || m.outputs.some(o => o.item === f.item))
    && (!f.reason || m.reasons.includes(f.reason))
    && (!f.band || m.band === f.band));
}

// --- Difference between two snapshots --------------------------------------------------------------

export interface ClassChange { cls: string; added: number; removed: number }
export interface MachineChange { id: string; cls: string; before: number; after: number; delta: number; machine: MachineFlow }
export interface ItemChange { item: string; lostBefore: number; lostAfter: number; actualBefore: number; actualAfter: number; delta: number }

export interface FactoryDiff {
  /** Ids of buildings only in the newer / only in the older snapshot (same id and class = the same building). */
  added: string[];
  removed: string[];
  /** Built and torn down per class, most changes first. */
  classes: ClassChange[];
  /** Machines in both whose productivity changed by at least `threshold`, worst / best change first. */
  worse: MachineChange[];
  better: MachineChange[];
  /** Items whose loss per minute changed, largest change first. */
  items: ItemChange[];
  totals: {
    buildings: number;
    machines: number;
    avgProductivity: number | null;
    idle: number;
    throttled: number;
    full: number;
    power: number | null;
  };
}

/**
 * What changed from `before` to `after` (snapshots of the same world; building ids are stable across its saves, a
 * rebuilt building gets a new id). `threshold`: the smallest productivity change listed (default 5 points).
 */
export function diffFactory(
  before: { snapshot: Pick<FactorySnapshot, 'buildings'>; analysis: FactoryAnalysis },
  after: { snapshot: Pick<FactorySnapshot, 'buildings'>; analysis: FactoryAnalysis },
  threshold = 0.05,
): FactoryDiff {
  const key = (b: SnapshotBuilding) => `${b.id}\u0000${b.cls}`;
  const old = new Map(before.snapshot.buildings.map(b => [key(b), b]));
  const now = new Map(after.snapshot.buildings.map(b => [key(b), b]));
  const added: string[] = [];
  const removed: string[] = [];
  const perClass = new Map<string, ClassChange>();
  const cc = (cls: string) => perClass.get(cls) ?? (perClass.set(cls, { cls, added: 0, removed: 0 }), perClass.get(cls)!);
  for (const [k, b] of now) if (!old.has(k)) { added.push(b.id); cc(b.cls).added++; }
  for (const [k, b] of old) if (!now.has(k)) { removed.push(b.id); cc(b.cls).removed++; }

  const worse: MachineChange[] = [];
  const better: MachineChange[] = [];
  for (const m of after.analysis.machines) {
    const prev = before.analysis.byId.get(m.id);
    if (!prev || prev.cls !== m.cls) continue;
    const delta = m.productivity - prev.productivity;
    if (Math.abs(delta) < threshold) continue;
    const change = { id: m.id, cls: m.cls, before: prev.productivity, after: m.productivity, delta, machine: m };
    (delta < 0 ? worse : better).push(change);
  }
  worse.sort((a, b) => a.delta - b.delta);
  better.sort((a, b) => b.delta - a.delta);

  const itemsBefore = new Map(before.analysis.items.map(i => [i.item, i]));
  const itemsAfter = new Map(after.analysis.items.map(i => [i.item, i]));
  const items: ItemChange[] = [];
  for (const id of new Set([...itemsBefore.keys(), ...itemsAfter.keys()])) {
    const a = itemsBefore.get(id), b = itemsAfter.get(id);
    const change = {
      item: id, lostBefore: a?.lost ?? 0, lostAfter: b?.lost ?? 0, actualBefore: a?.actual ?? 0, actualAfter: b?.actual ?? 0, delta: (b?.lost ?? 0) - (a?.lost ?? 0),
    };
    if (Math.abs(change.delta) >= 0.05) items.push(change);
  }
  items.sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta) || x.item.localeCompare(y.item));

  const ta = after.analysis.totals, tb = before.analysis.totals;
  return {
    added, removed,
    classes: [...perClass.values()].sort((a, b) => (b.added + b.removed) - (a.added + a.removed) || a.cls.localeCompare(b.cls)),
    worse, better, items,
    totals: {
      buildings: after.snapshot.buildings.length - before.snapshot.buildings.length,
      machines: ta.machines - tb.machines,
      avgProductivity: ta.avgProductivity !== null && tb.avgProductivity !== null ? ta.avgProductivity - tb.avgProductivity : null,
      idle: ta.bands.idle - tb.bands.idle,
      throttled: ta.bands.throttled - tb.bands.throttled,
      full: ta.bands.full - tb.bands.full,
      power: ta.power && tb.power ? ta.power.produced - tb.power.produced : null,
    },
  };
}

// --- Routes ----------------------------------------------------------------------------------------

export interface StationVisit {
  vehicle: string;
  /** Items moved per dock, on average (as the station tracks it). */
  itemsPerDock: number | null;
  /** Seconds between two docks of this vehicle here. */
  interval: number | null;
  /** itemsPerDock / interval × 60. */
  itemsPerMin: number | null;
  capacityStacks: number | null;
  capacityFluid: number | null;
}

export interface StationFlow {
  id: string;
  cls: string;
  name?: string;
  x: number; y: number; z: number;
  /** true loading, false unloading, null for stations without a mode. */
  loading: boolean | null;
  visits: StationVisit[];
  /** Sum over its vehicles; null when no vehicle has figures. */
  itemsPerMin: number | null;
  /** Mean time between two docks of any one vehicle (s). */
  interval: number | null;
}

export interface RouteStop { station: string; loading: boolean | null; visit: StationVisit | null }

export interface VehicleFlow {
  id: string;
  cls: string;
  name?: string;
  x: number; y: number; z: number;
  autopilot: boolean;
  fuel: SnapshotVehicle['fuel'] | null;
  /** The route's stops in order (a station can appear more than once). */
  stops: RouteStop[];
  /** Items per minute it picks up at loading stations and drops at unloading stations (each station once). */
  loadedPerMin: number | null;
  unloadedPerMin: number | null;
  /**
   * Round trip in seconds, estimated from the stations' time between docks: at a station the route visits n times, a
   * round trip is n × that time; the mean over the route's stations.
   */
  roundTrip: number | null;
}

export interface RouteAnalysis {
  stations: StationFlow[];
  vehicles: VehicleFlow[];
}

const sumOrNull = (xs: (number | null)[]) => (xs.some(x => x !== null) ? xs.reduce<number>((s, x) => s + (x ?? 0), 0) : null);
const meanOrNull = (xs: (number | null)[]) => {
  const v = xs.filter((x): x is number => x !== null);
  return v.length > 0 ? v.reduce((s, x) => s + x, 0) / v.length : null;
};

function visitOf(t: SnapshotStation['traffic'][number]): StationVisit {
  const interval = t.avgSecBetweenDocks !== undefined && t.avgSecBetweenDocks > 0 ? t.avgSecBetweenDocks : null;
  const itemsPerDock = t.avgItemsPerDock ?? null;
  return {
    vehicle: t.vehicle, itemsPerDock, interval,
    itemsPerMin: interval !== null && itemsPerDock !== null ? (itemsPerDock / interval) * 60 : null,
    capacityStacks: t.capacityStacks ?? null, capacityFluid: t.capacityFluid ?? null,
  };
}

/** Stations with their vehicles' throughput, and vehicles with their route. */
export function analyzeRoutes(s: Pick<FactorySnapshot, 'stations' | 'vehicles'>): RouteAnalysis {
  const stations: StationFlow[] = s.stations.map(st => {
    const visits = st.traffic.map(visitOf);
    const flow: StationFlow = {
      id: st.id, cls: st.cls, x: st.x, y: st.y, z: st.z, loading: st.loading ?? null, visits,
      itemsPerMin: sumOrNull(visits.map(v => v.itemsPerMin)), interval: meanOrNull(visits.map(v => v.interval)),
    };
    if (st.name) flow.name = st.name;
    return flow;
  });
  const byId = new Map(stations.map(st => [st.id, st]));
  const vehicles: VehicleFlow[] = s.vehicles.map(v => {
    const stops: RouteStop[] = v.route.map(id => {
      const st = byId.get(id);
      return { station: id, loading: st?.loading ?? null, visit: st?.visits.find(x => x.vehicle === v.id) ?? null };
    });
    const unique = [...new Map(stops.map(x => [x.station, x])).values()];
    const count = (id: string) => stops.filter(x => x.station === id).length;
    const flow: VehicleFlow = {
      id: v.id, cls: v.cls, x: v.x, y: v.y, z: v.z, autopilot: v.autopilot, fuel: v.fuel ?? null, stops,
      loadedPerMin: sumOrNull(unique.filter(x => x.loading === true).map(x => x.visit?.itemsPerMin ?? null)),
      unloadedPerMin: sumOrNull(unique.filter(x => x.loading === false).map(x => x.visit?.itemsPerMin ?? null)),
      roundTrip: meanOrNull(unique.map(x => (x.visit?.interval != null ? x.visit.interval * count(x.station) : null))),
    };
    if (v.name) flow.name = v.name;
    return flow;
  });
  return { stations, vehicles };
}
