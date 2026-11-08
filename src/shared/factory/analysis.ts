import { footprintRect, type BuildingIndex } from '../buildings.js';
import type { MachineEntry } from '../machines.js';
import { PURITY_FACTOR } from '../planner.js';
import type { GameBelt, GameExtractor, RecipeIndex } from '../recipes.js';
import type { Purity, ResourceNode } from '../resourceNodes.js';
import type { FactorySnapshot, SnapshotBuilding, SnapshotCargo, SnapshotLink, SnapshotProduction, SnapshotStation, SnapshotVehicle } from './snapshot.js';
import { IDLE_PRODUCTIVITY, snapshotFigures } from './storage.js';

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
 *
 * Counting rules, the same on the page and the map: a machine counts once for every reason it has (not only its main
 * one); paused machines are their own state (not a band, not inefficient, their output not counted as loss); an
 * extractor held up only by its output (`surplus`) makes more than is taken off and is not inefficient either.
 */

/**
 * Why a machine is below full productivity, in the order a machine's reasons are listed (first = main reason).
 * `starved`: an input ran empty (shortage); `blocked`: the output was full (it backs up); `surplus`: an extractor whose
 * only problem is a full output (more is mined than taken off; not inefficient); `unknown`: ran only part of the time.
 */
export const REASONS = ['paused', 'noPower', 'noRecipe', 'noFuel', 'starved', 'blocked', 'surplus', 'unknown'] as const;
export type Reason = (typeof REASONS)[number];

/** Productivity bands: standing (< 1 %), part load (1–90 %), high (90–99 %), full (≥ 99 %). */
export const BANDS = ['idle', 'throttled', 'high', 'full'] as const;
export type Band = (typeof BANDS)[number];

/** A machine's state on the page: paused by the player, else its band. */
export const STATES = ['paused', ...BANDS] as const;
export type MachineState = (typeof STATES)[number];

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

/**
 * A hint about an extractor's output (or any machine's overclocking), from the belt at its output and its rates:
 * - `beltLimits`: the belt (or lift) at its output carries less than it should make;
 * - `beltBehind`: what it makes matches a slower belt tier than the one at its output, so one probably sits further on;
 * - `noBelt`: no belt or lift starts at its output;
 * - `overclockUseless`: it makes no more than at 100 %, so its Power Shards do nothing (now).
 * The production lines add hints of their own (`LineHint` in `lines.ts`).
 */
export type MachineHint =
  | { kind: 'beltLimits'; belt: string; rate: number }
  | { kind: 'beltBehind'; belt: string; rate: number }
  | { kind: 'noBelt' }
  | { kind: 'overclockUseless'; shards: number };

/** The belt or lift found at an extractor's output. */
export interface BeltMatch { cls: string; rate: number; /** Distance from the expected output point, game units. */ distance: number }

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
  /** Paused by the player: its own state, not inefficient. */
  paused: boolean;
  /** `paused`, else the band. */
  state: MachineState;
  powerShards: number;
  somersloops: number;
  /** Output multiplier from Somersloops: 1 + loops / slots (2 with every slot filled). */
  boost: number;
  /** Every reason that applies, in `REASONS` order; `unknown` when it is below full without a known reason. */
  reasons: Reason[];
  /** The main reason (first of `reasons`), or null when it runs fully without issues. */
  reason: Reason | null;
  /**
   * Not paused, not only `surplus`, and below 90 % or with an issue reported. The one definition behind every
   * "inefficient" count.
   */
  inefficient: boolean;
  /** What it makes, per minute; the main product first. Empty for generators and unknown resources. */
  outputs: ItemRate[];
  /** Total lost output per minute over all outputs (mixed units; for sorting within one item, use `outputs`). */
  lost: number;
  /** Generators: MW at its clock (`nominal`) and as it ran (`actual`). */
  power?: { nominal: number; actual: number };
  /** Resource node it stands on (extractors). */
  node?: string;
  /** That node's purity, when the world's nodes are known. */
  purity?: Purity;
  /** Solid extractors with belt data: the belt at its output (null: none found). */
  belt?: BeltMatch | null;
  hints: MachineHint[];
  /**
   * Starved machines: the inputs it lacks, when the snapshot's links tell (a recipe with one ingredient: that one;
   * several: those no input belt carries any of). Missing when unknown: then it may lack any of them (`starvesFor`).
   */
  starvedFor?: string[];
}

/**
 * What an item's loss means: `shortage` (mostly starved makers), `jam` (mostly backed up), `surplus` (extractors
 * that make more than is taken off), `other` (power, fuel, recipe, intermittent), `ok` (no loss).
 */
export type ItemStatus = 'shortage' | 'jam' | 'surplus' | 'other' | 'ok';

export interface ItemFlow extends ItemRate {
  /** Machines making it (as main or by-product), most loss first; paused ones included, but not in the sums. */
  machines: MachineFlow[];
  /** Loss per main reason of the machines (per minute). */
  lostBy: Partial<Record<Reason, number>>;
  /** The reason behind most of the loss, or null without loss. */
  mainReason: Reason | null;
  /** lost / nominal (0 without a nominal rate): unitless, so solids and fluids rank alike. */
  share: number;
  status: ItemStatus;
  /** Machines in this factory that use it (recipe ingredient, generator fuel or water); see `FactoryAnalysis.consumers`. */
  consumers: number;
  /** Loading stations holding it when saved (vehicles take it away). */
  loadedAt: number;
  /** Makers paused by the player (not counted in the rates). */
  paused: number;
}

export interface ClassStats {
  cls: string;
  kind: MachineKind;
  count: number;
  /** Mean productivity of its machines that report one (like `FactoryTotals.avgProductivity`). */
  avgProductivity: number;
  /** Machines per band, paused ones left out (they are in `paused`). */
  bands: Record<Band, number>;
  paused: number;
  /** Machines per reason; a machine counts for each of its reasons. */
  reasons: Partial<Record<Reason, number>>;
  inefficient: number;
}

export interface FactoryTotals {
  machines: number;
  /**
   * Mean productivity of the machines that report one, null without any: the same figure as the timeline's
   * (`snapshotFigures`), so the page and the timeline never disagree.
   */
  avgProductivity: number | null;
  /** Machines per band, paused ones left out. */
  bands: Record<Band, number>;
  paused: number;
  inefficient: number;
  /** Machines per reason; a machine counts for each of its reasons. */
  reasons: Partial<Record<Reason, number>>;
  /** MW produced by generators (as they ran) and what they would make at their clock; null without generators. */
  power: { produced: number; producible: number } | null;
}

export interface FactoryAnalysis {
  machines: MachineFlow[];
  byId: ReadonlyMap<string, MachineFlow>;
  /** Items with a nominal rate: shortages first, then by share lost, surplus last (see `compareItems`). */
  items: ItemFlow[];
  /** Per item the machines that use it (recipe ingredient, generator fuel or water). */
  consumers: ReadonlyMap<string, MachineFlow[]>;
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
  /** `buildings.json`: footprints, to find where an extractor's output is. */
  buildings?: BuildingIndex;
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
 * of the measurement window for a cause no longer visible when saved (`unknown`, shown as "runs intermittently"). An
 * extractor whose only reason is `blocked` makes more than is taken off: `surplus`.
 */
export function reasonsOf(prod: SnapshotProduction, productivity: number, kind: MachineKind = 'other'): Reason[] {
  const set = new Set<Reason>(prod.issues ?? []);
  if (prod.paused) set.add('paused');
  if (set.size === 0 && productivity < FULL_FROM) set.add(kind === 'extractor' ? 'blocked' : 'unknown');
  if (kind === 'extractor' && set.size === 1 && set.has('blocked')) return ['surplus'];
  return REASONS.filter(r => set.has(r));
}

/** Whether a machine starves for this item (it is starved and lacks this input, or it is not known which it lacks). */
export function starvesFor(m: Pick<MachineFlow, 'reasons' | 'starvedFor' | 'paused'>, item: string): boolean {
  return !m.paused && m.reasons.includes('starved') && (m.starvedFor === undefined || m.starvedFor.includes(item));
}

/** The one rule behind every "inefficient" count (see `MachineFlow.inefficient`). */
export function isInefficient(productivity: number, reasons: readonly Reason[], issues: number): boolean {
  if (reasons.includes('paused')) return false;
  if (reasons.length > 0 && reasons.every(r => r === 'surplus')) return false;
  return productivity < INEFFICIENT_BELOW || issues > 0;
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

function extractorOutput(b: SnapshotBuilding, ex: GameExtractor, data: AnalysisData, pressurizers: Map<string, number>): { item: string; nominal: number; purity?: Purity } | null {
  const clock = b.prod!.clock;
  if (!ex.onNode) {
    const item = ex.resources.length === 1 ? ex.resources[0]! : undefined;
    return item ? { item, nominal: ex.rate * clock } : null;
  }
  const node = b.node ? data.nodes?.get(b.node) : undefined;
  if (!node || node.purity === null) return null;
  const c = b.cls === WELL_EXTRACTOR ? (node.core !== undefined ? pressurizers.get(node.core) : undefined) ?? 1 : clock;
  return { item: node.resource, nominal: ex.rate * PURITY_FACTOR[node.purity] * c, purity: node.purity };
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
  const paused = reasons.includes('paused');
  const outputs: ItemRate[] = [];
  let purity: Purity | undefined;
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
    purity = out?.purity;
  } else if (kind === 'generator') {
    const mw = generatorPower(b, data);
    if (mw !== undefined) power = { nominal: mw, actual: mw * productivity };
  }
  const flow: MachineFlow = {
    id: b.id, cls: b.cls, x: b.x, y: b.y, z: b.z, kind, clock: prod.clock, productivity, measured, band: bandOf(productivity),
    paused, state: paused ? 'paused' : bandOf(productivity),
    powerShards: prod.powerShards ?? 0, somersloops: prod.somersloops ?? 0, boost,
    reasons, reason: reasons[0] ?? null,
    inefficient: isInefficient(productivity, reasons, prod.issues?.length ?? 0),
    outputs, lost: outputs.reduce((s, o) => s + o.lost, 0),
    hints: [],
  };
  if (prod.recipe) flow.recipe = prod.recipe;
  if (power) flow.power = power;
  if (b.node) flow.node = b.node;
  if (purity) flow.purity = purity;
  const overclock = overclockHint(flow);
  if (overclock) flow.hints.push(overclock);
  return flow;
}

/** Shards do nothing when a machine makes no more than its rate at 100 % (the measured output, not the nominal). */
function overclockHint(m: MachineFlow): MachineHint | null {
  const out = m.outputs[0];
  if (m.paused || m.powerShards === 0 || m.clock <= 1 || !out || !m.measured) return null;
  const at100 = out.nominal / m.clock;
  return out.actual <= at100 * 1.001 ? { kind: 'overclockUseless', shards: m.powerShards } : null;
}

// --- Belts at extractor outputs --------------------------------------------------------------------

/** How far from the expected output point a belt's start or a lift may be (game units, 10 m). */
const BELT_RADIUS = 1000;
/** A measured rate this close to a belt tier's rate (share of it) counts as that tier. */
const TIER_MATCH = 0.02;

interface BeltEnd { cls: string; x: number; y: number; z: number }

/** Where belts start (a spline's first point is its input end) and where lifts stand, by class. */
function beltEnds(s: Partial<Pick<FactorySnapshot, 'splines' | 'buildings'>>, rates: ReadonlyMap<string, number>): BeltEnd[] {
  const out: BeltEnd[] = [];
  for (const sp of s.splines ?? []) {
    if (rates.has(sp.cls) && sp.pts.length >= 3) out.push({ cls: sp.cls, x: sp.pts[0]!, y: sp.pts[1]!, z: sp.pts[2]! });
  }
  for (const b of s.buildings ?? []) if (rates.has(b.cls)) out.push({ cls: b.cls, x: b.x, y: b.y, z: b.z });
  return out;
}

/**
 * The point where an extractor hands over its output: the middle of the footprint's edge that reaches farthest from
 * its centre (a miner's chute, `buildings.json`), turned by its yaw; its centre without a footprint (then the radius
 * is larger by that edge's distance, 8 m).
 */
export function outputPoint(b: Pick<SnapshotBuilding, 'x' | 'y' | 'z' | 'yaw' | 'cls'>, buildings?: BuildingIndex): { x: number; y: number; z: number; slack: number } {
  const rect = buildings ? footprintRect(buildings.get(b.cls) ?? {}) : null;
  if (!rect) return { x: b.x, y: b.y, z: b.z, slack: 800 };
  const sides: [number, number, number][] = [[rect.maxX, 1, 0], [-rect.minX, -1, 0], [rect.maxY, 0, 1], [-rect.minY, 0, -1]];
  const [reach, ux, uy] = sides.reduce((best, s) => (s[0] > best[0] ? s : best));
  const lx = ux * reach + (uy !== 0 ? (rect.minX + rect.maxX) / 2 : 0);
  const ly = uy * reach + (ux !== 0 ? (rect.minY + rect.maxY) / 2 : 0);
  const a = (b.yaw * Math.PI) / 180;
  return { x: b.x + lx * Math.cos(a) - ly * Math.sin(a), y: b.y + lx * Math.sin(a) + ly * Math.cos(a), z: b.z, slack: 0 };
}

/** The belt or lift whose input end is nearest to an extractor's output point, within 10 m; null without one. */
export function beltAt(b: Pick<SnapshotBuilding, 'x' | 'y' | 'z' | 'yaw' | 'cls'>, ends: readonly BeltEnd[], rates: ReadonlyMap<string, number>, buildings?: BuildingIndex): BeltMatch | null {
  const p = outputPoint(b, buildings);
  let best: BeltMatch | null = null;
  for (const e of ends) {
    const d = Math.hypot(e.x - p.x, e.y - p.y, e.z - p.z);
    if (d <= BELT_RADIUS + p.slack && (best === null || d < best.distance)) best = { cls: e.cls, rate: rates.get(e.cls)!, distance: Math.round(d) };
  }
  return best;
}

/** An extractor's belt hints (solid output only; see `MachineHint`). */
export function beltHints(m: MachineFlow, belt: BeltMatch | null, belts: readonly GameBelt[]): MachineHint[] {
  const out = m.outputs[0];
  if (!out || m.paused) return [];
  if (!belt) return [{ kind: 'noBelt' }];
  if (belt.rate < out.nominal * (1 - TIER_MATCH)) return [{ kind: 'beltLimits', belt: belt.cls, rate: belt.rate }];
  if (out.actual >= out.nominal * FULL_FROM || out.actual <= 0) return [];
  const tier = belts.find(t => t.kind === 'belt' && t.rate < belt.rate && Math.abs(out.actual - t.rate) <= t.rate * TIER_MATCH);
  return tier ? [{ kind: 'beltBehind', belt: tier.id, rate: tier.rate }] : [];
}

const emptyBands = (): Record<Band, number> => ({ idle: 0, throttled: 0, high: 0, full: 0 });
const bump = <K extends string>(rec: Partial<Record<K, number>>, k: K, by = 1) => { rec[k] = (rec[k] ?? 0) + by; };

const STATUS_OF: Partial<Record<Reason, ItemStatus>> = { starved: 'shortage', blocked: 'jam', surplus: 'surplus' };
const STATUS_RANK: Record<ItemStatus, number> = { shortage: 0, jam: 1, other: 1, surplus: 2, ok: 3 };

/**
 * The order of "inefficient items": shortages first, surplus last, the rest between; within each by share lost, then by
 * loss (an absolute loss only compares items of one unit, so it never decides between a solid and a fluid first).
 */
export function compareItems(a: ItemFlow, b: ItemFlow): number {
  return STATUS_RANK[a.status] - STATUS_RANK[b.status] || b.share - a.share || b.lost - a.lost || a.item.localeCompare(b.item);
}

/** What a machine uses: its recipe's ingredients, a generator's fuels and their supplement (water). */
function inputsOf(m: MachineFlow, data: AnalysisData): string[] {
  if (m.kind === 'manufacturer') return data.recipes.recipes.get(m.recipe!)?.ingredients.map(i => i.item) ?? [];
  if (m.kind === 'generator') {
    const fuels = data.machines?.get(m.cls)?.stats.fuels ?? [];
    return [...new Set(fuels.flatMap(f => (f.supplement ? [f.item, f.supplement.item] : [f.item])))];
  }
  return [];
}

/**
 * The analysis of one snapshot. With the snapshot's splines and `data.recipes.data.belts` it also finds the belt at
 * each solid extractor's output (`MachineFlow.belt`, `hints`); with its stations, which items wait at loading stations.
 */
export function analyzeFactory(s: Pick<FactorySnapshot, 'buildings'> & Partial<Pick<FactorySnapshot, 'splines' | 'stations' | 'links'>>, data: AnalysisData): FactoryAnalysis {
  const pressurizers = pressurizerClocks(s as FactorySnapshot);
  const machines = s.buildings.filter(b => b.prod).map(b => machineFlow(b, data, pressurizers));
  const byId = new Map(machines.map(m => [m.id, m]));

  const belts = data.recipes.data.belts ?? [];
  if (s.splines && belts.length > 0) {
    const rates = new Map(belts.map(b => [b.id, b.rate]));
    const ends = beltEnds(s, rates);
    const building = new Map(s.buildings.map(b => [b.id, b]));
    for (const m of machines) {
      const ex = data.recipes.extractors.get(m.cls);
      if (m.kind !== 'extractor' || ex?.kind !== 'miner') continue;
      m.belt = beltAt(building.get(m.id)!, ends, rates, data.buildings);
      m.hints.unshift(...beltHints(m, m.belt, belts));
    }
  }

  const consumers = new Map<string, MachineFlow[]>();
  for (const m of machines) for (const item of inputsOf(m, data)) consumers.set(item, [...(consumers.get(item) ?? []), m]);
  if (s.links) {
    const into = new Map<string, SnapshotLink[]>();
    for (const l of s.links) (into.get(l.to) ?? into.set(l.to, []).get(l.to)!).push(l);
    for (const m of machines) {
      const lacks = lackedInputs(m, inputsOf(m, data), into.get(m.id) ?? [], data);
      if (lacks) m.starvedFor = lacks;
    }
  }
  // A slower belt further on is no likely cause when what it makes backs up at its consumers (they take no more).
  for (const m of machines) {
    const out = m.outputs[0];
    if (out && m.hints.some(h => h.kind === 'beltBehind') && (consumers.get(out.item) ?? []).some(backsUp)) {
      m.hints = m.hints.filter(h => h.kind !== 'beltBehind');
    }
  }
  const loadedAt = new Map<string, number>();
  for (const st of s.stations ?? []) {
    if (st.loading === false) continue;
    for (const c of st.cargo ?? []) loadedAt.set(c.item, (loadedAt.get(c.item) ?? 0) + 1);
  }

  const items = new Map<string, ItemFlow>();
  for (const m of machines) {
    for (const o of m.outputs) {
      let it = items.get(o.item);
      if (!it) {
        items.set(o.item, (it = {
          item: o.item, nominal: 0, actual: 0, lost: 0, machines: [], lostBy: {}, mainReason: null, share: 0, status: 'ok',
          consumers: consumers.get(o.item)?.length ?? 0, loadedAt: loadedAt.get(o.item) ?? 0, paused: 0,
        }));
      }
      it.machines.push(m);
      if (m.paused) { it.paused++; continue; }
      it.nominal += o.nominal;
      it.actual += o.actual;
      it.lost += o.lost;
      if (o.lost > 0 && m.reason) bump(it.lostBy, m.reason, o.lost);
    }
  }
  for (const it of items.values()) {
    it.machines.sort((a, b) => Number(a.paused) - Number(b.paused) || lostOf(b, it.item) - lostOf(a, it.item) || a.productivity - b.productivity);
    it.mainReason = mainOf(it.lostBy);
    it.share = it.nominal > 0 ? it.lost / it.nominal : 0;
    it.status = it.mainReason === null ? 'ok' : STATUS_OF[it.mainReason] ?? 'other';
  }

  const classes = new Map<string, ClassStats & { n: number; sum: number }>();
  const totals: FactoryTotals = {
    machines: machines.length, avgProductivity: snapshotFigures(s).avgProductivity, bands: emptyBands(), paused: 0, inefficient: 0, reasons: {}, power: null,
  };
  for (const m of machines) {
    let c = classes.get(m.cls);
    if (!c) classes.set(m.cls, (c = { cls: m.cls, kind: m.kind, count: 0, avgProductivity: 0, bands: emptyBands(), paused: 0, reasons: {}, inefficient: 0, n: 0, sum: 0 }));
    c.count++;
    if (m.measured) { c.n++; c.sum += m.productivity; }
    if (m.paused) { c.paused++; totals.paused++; } else { c.bands[m.band]++; totals.bands[m.band]++; }
    for (const r of m.reasons) { bump(c.reasons, r); bump(totals.reasons, r); }
    if (m.inefficient) { c.inefficient++; totals.inefficient++; }
    if (m.power) {
      totals.power ??= { produced: 0, producible: 0 };
      totals.power.produced += m.power.actual;
      totals.power.producible += m.power.nominal;
    }
  }
  const classList = [...classes.values()].map(({ n, sum, ...c }) => ({ ...c, avgProductivity: n > 0 ? sum / n : 0 }));
  classList.sort((a, b) => b.count - a.count || a.cls.localeCompare(b.cls));

  return {
    machines, byId,
    items: [...items.values()].sort(compareItems),
    consumers,
    classes: classList,
    totals,
  };
}

/**
 * The inputs a starved machine lacks, from what lies on its input belts: one ingredient is that one; with several,
 * those no input belt carries any of (a pipe counts as carrying its fluid). Null when not starved or not known.
 */
function lackedInputs(m: MachineFlow, ingredients: readonly string[], into: readonly SnapshotLink[], data: AnalysisData): string[] | null {
  if (!m.reasons.includes('starved') || ingredients.length === 0) return null;
  if (m.kind === 'generator') return null; // fuels are alternatives, not a recipe
  if (ingredients.length === 1) return [...ingredients];
  if (into.length === 0) return null;
  const seen = new Set<string>();
  for (const l of into) {
    if (l.kind === 'pipe') { if (l.fluid) seen.add(l.fluid); else return null; continue; }
    for (const [item, n] of Object.entries(l.items ?? {})) if (n > 0) seen.add(item);
  }
  const fluid = (item: string) => (data.recipes.items.get(item)?.form ?? 'solid') !== 'solid';
  const lacks = ingredients.filter(i => !seen.has(i) && !(fluid(i) && into.some(l => l.kind === 'pipe' && !l.fluid)));
  return lacks.length > 0 ? lacks : null;
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

/** The machines matching a filter (null fields match everything); `state` is the page's band-or-paused filter. */
export interface MachineFilter { cls?: string | null; item?: string | null; reason?: Reason | null; band?: Band | null; state?: MachineState | null }

export function filterMachines(machines: readonly MachineFlow[], f: MachineFilter): MachineFlow[] {
  return machines.filter(m => (!f.cls || m.cls === f.cls)
    && (!f.item || m.outputs.some(o => o.item === f.item))
    && (!f.reason || m.reasons.includes(f.reason))
    && (!f.band || m.band === f.band)
    && (!f.state || m.state === f.state));
}

// --- Cause across the chain ------------------------------------------------------------------------

/** The users of an item that run one recipe (or, for generators, are one class). */
export interface ConsumerGroup {
  /** The recipe, or the class for generators. */
  key: string;
  cls: string;
  recipe?: string;
  /** What they make (main product), when anything. */
  product?: string;
  ids: string[];
  /** Machines per reason (each of its reasons). */
  reasons: Partial<Record<Reason, number>>;
  /** Machines that run fully without any reason. */
  fine: number;
}

/**
 * Why a jam ends at an item: nothing in the factory uses it (`noConsumer`); its users starve for it while it backs up:
 * the belt or pipe to them is full (`capacity`), carries next to nothing (`connection`: check how it is connected),
 * or neither can be told (`transport`); vehicles take it away from loading stations too slowly (`vehicles`); or its
 * users run and need no more (`demand`).
 */
export type JamEndWhy = 'noConsumer' | 'capacity' | 'connection' | 'transport' | 'vehicles' | 'demand';

/**
 * What the item chain may read from the production lines (`causeContext` in `lines.ts`): the line of a machine, and
 * how the belts and pipes bring an item to some of its users.
 */
export interface CauseContext {
  lineOf?(id: string): string | undefined;
  supply?(item: string, users: readonly string[]): 'capacity' | 'connection' | 'transport' | null;
}
export interface JamEnd { item: string; why: JamEndWhy; /** Items from the start to here. */ path: string[] }

export interface ItemCause {
  item: string;
  /** Users of the item in this factory, most machines first. */
  consumers: ConsumerGroup[];
  /**
   * Its makers back up while users starve for it (in the same production line, when lines are known): the transport
   * in between is the limit.
   */
  transportLimited: boolean;
  /** Why the jam ends at the item itself (its makers back up, none of its users does), or null. */
  why: JamEndWhy | null;
  /**
   * Following the users that back up, from product to product: the items where the jam ends (users that do not back
   * up). Empty when the item's own users do not back up, or its makers do not.
   */
  jamEnds: JamEnd[];
}

const MAX_CHAIN = 40;
const backsUp = (m: MachineFlow) => !m.paused && (m.reasons.includes('blocked') || m.reasons.includes('surplus'));

/** The users of an item grouped by recipe (`consumers` from `analyzeFactory`). */
export function consumerGroups(users: readonly MachineFlow[]): ConsumerGroup[] {
  const groups = new Map<string, ConsumerGroup>();
  for (const m of users) {
    const key = m.recipe ?? m.cls;
    let g = groups.get(key);
    if (!g) {
      groups.set(key, (g = { key, cls: m.cls, ids: [], reasons: {}, fine: 0 }));
      if (m.recipe) g.recipe = m.recipe;
      if (m.outputs[0]) g.product = m.outputs[0].item;
    }
    g.ids.push(m.id);
    for (const r of m.reasons) bump(g.reasons, r);
    if (m.reasons.length === 0) g.fine++;
  }
  return [...groups.values()].sort((a, b) => b.ids.length - a.ids.length || a.key.localeCompare(b.key));
}

/**
 * The cause of an item's loss across the chain (pure): its users with their state; whether its makers back up while
 * its users starve (transport); and, following users that back up to what they make, where the jam ends.
 */
export function itemCause(a: FactoryAnalysis, item: string, ctx: CauseContext = {}): ItemCause {
  const itemsById = new Map(a.items.map(i => [i.item, i]));
  const users = (id: string) => a.consumers.get(id) ?? [];
  /** Users starving for `id` while makers of it back up (in their line, when lines are known). */
  const starving = (id: string, makers: readonly MachineFlow[]) => {
    const jammed = makers.filter(backsUp);
    const lineOf = ctx.lineOf;
    const lines = lineOf ? new Set(jammed.map(m => lineOf(m.id))) : null;
    return users(id).filter(m => starvesFor(m, id) && (!lines || !lineOf || lines.has(lineOf(m.id))));
  };
  const whyAt = (id: string, makers: readonly MachineFlow[]): JamEndWhy => {
    const hungry = starving(id, makers);
    if (hungry.length > 0) return ctx.supply?.(id, hungry.map(m => m.id)) ?? 'transport';
    if ((itemsById.get(id)?.loadedAt ?? 0) > 0) return 'vehicles';
    return users(id).length === 0 ? 'noConsumer' : 'demand';
  };
  const makers = itemsById.get(item)?.machines ?? [];
  const makersBackUp = makers.some(backsUp);
  const consumers = consumerGroups(users(item));
  const transportLimited = makersBackUp && starving(item, makers).length > 0;

  const jamEnds: JamEnd[] = [];
  if (makersBackUp) {
    /** The jammed makers of each item on the way (those the jam came through). */
    const makersOf = new Map<string, MachineFlow[]>();
    const seen = new Set([item]);
    const queue: string[][] = [[item]];
    while (queue.length > 0 && seen.size < MAX_CHAIN) {
      const path = queue.shift()!;
      const here = path[path.length - 1]!;
      const jammed = users(here).filter(backsUp);
      if (jammed.length === 0) {
        if (here !== item) jamEnds.push({ item: here, why: whyAt(here, makersOf.get(here) ?? []), path });
        continue;
      }
      for (const m of jammed) {
        for (const o of m.outputs) {
          makersOf.set(o.item, [...(makersOf.get(o.item) ?? []), m]);
          if (seen.has(o.item)) continue;
          seen.add(o.item);
          queue.push([...path, o.item]);
        }
      }
    }
  }
  const endsHere = makersBackUp && !users(item).some(backsUp);
  return { item, consumers, transportLimited, why: endsHere ? whyAt(item, makers) : null, jamEnds };
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
    /** Change of the generators' capacity (MW at their clock). */
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
      power: ta.power && tb.power ? ta.power.producible - tb.power.producible : null,
    },
  };
}

// --- Routes ----------------------------------------------------------------------------------------

export interface StationVisit {
  vehicle: string;
  /** It docks but moves nothing (an empty leg). */
  empty: boolean;
  /**
   * Items per dock against the hold: itemsPerDock / (stacks × stack size of what it carries), 0..1; null when the
   * hold, the items or their stack sizes are unknown, or it carries fluids.
   */
  fill: number | null;
  /** The stack size behind `fill` is a mean over several items. */
  fillApprox: boolean;
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
  /** Time between two docks of any vehicle: 1 / Σ (1 / interval) (s). */
  combinedInterval: number | null;
  /** What lay in it when saved, most first. */
  cargo: SnapshotCargo[];
  /**
   * How full its vehicles are, the mean over the visits that tell (0 when vehicles dock and move nothing); null when
   * no visit tells. `fillApprox` when a stack size behind it is a mean.
   */
  fill: number | null;
  fillApprox: boolean;
  /** The one station problem rule of the page and the map (`stationProblem`). */
  problem: StationProblem | null;
}

/**
 * What is wrong with a station: no vehicle stops (`noVehicles`), vehicles dock and move nothing (`nothingMoved`), or
 * they move hardly anything (`lowThroughput`: under 1 item per minute, or their holds under 5 % full while they move
 * under 10 per minute; a busy station with big holds is not a problem for being little filled).
 */
export type StationProblem = 'noVehicles' | 'nothingMoved' | 'lowThroughput';

/**
 * Below `LOW_THROUGHPUT_PER_MIN` items per minute a station moves "hardly anything"; so it does below `LOW_FILL` of the
 * hold when it also moves under `LOW_FILL_PER_MIN`.
 */
export const LOW_THROUGHPUT_PER_MIN = 1;
export const LOW_FILL = 0.05;
export const LOW_FILL_PER_MIN = 10;

/** The station problem rule, shared by the Fabrik page's table and the map's plates. */
export function stationProblem(st: Pick<StationFlow, 'visits' | 'itemsPerMin' | 'fill'>): StationProblem | null {
  if (st.visits.length === 0) return 'noVehicles';
  if (st.visits.every(v => v.empty) || st.itemsPerMin === 0) return 'nothingMoved';
  const rate = st.itemsPerMin;
  if (rate !== null && rate < LOW_THROUGHPUT_PER_MIN) return 'lowThroughput';
  if (st.fill !== null && st.fill < LOW_FILL && rate !== null && rate < LOW_FILL_PER_MIN) return 'lowThroughput';
  return null;
}

/**
 * A stop of a route. The station tracks each vehicle once however often it stops there, so a station the route
 * visits again carries the figures only at its first stop (`repeat`: the number of that first stop, 1-based).
 */
export interface RouteStop { station: string; loading: boolean | null; visit: StationVisit | null; repeat?: number }

export interface VehicleFlow {
  id: string;
  cls: string;
  name?: string;
  x: number; y: number; z: number;
  autopilot: boolean;
  fuel: SnapshotVehicle['fuel'] | null;
  /** What its storage held when saved, most first; `slots` its size (null in older snapshots). */
  cargo: SnapshotCargo[];
  slots: number | null;
  /** Stations where it docks but moves nothing (each once). */
  emptyLegs: string[];
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

/** Stack sizes by item (`recipes.json` items), for how full a vehicle is. */
export type StackSizes = ReadonlyMap<string, { stackSize?: number; form?: string }>;

/**
 * The stack size of a load: the items' stack size, or their mean weighted by count when they differ (then `approx`);
 * null when one of them has none or is a fluid.
 */
export function loadStackSize(cargo: readonly SnapshotCargo[], sizes: StackSizes | undefined): { size: number; approx: boolean } | null {
  if (!sizes || cargo.length === 0) return null;
  let n = 0, sum = 0;
  const distinct = new Set<number>();
  for (const c of cargo) {
    const it = sizes.get(c.item);
    if (!it?.stackSize || (it.form !== undefined && it.form !== 'solid')) return null;
    n += c.count;
    sum += c.count * it.stackSize;
    distinct.add(it.stackSize);
  }
  return n > 0 ? { size: sum / n, approx: distinct.size > 1 } : null;
}

function visitOf(t: SnapshotStation['traffic'][number], load: readonly SnapshotCargo[], sizes: StackSizes | undefined): StationVisit {
  const interval = t.avgSecBetweenDocks !== undefined && t.avgSecBetweenDocks > 0 ? t.avgSecBetweenDocks : null;
  const itemsPerDock = t.avgItemsPerDock ?? null;
  const stack = loadStackSize(load, sizes);
  const capacity = stack && t.capacityStacks ? t.capacityStacks * stack.size : null;
  return {
    vehicle: t.vehicle, itemsPerDock, interval,
    itemsPerMin: interval !== null && itemsPerDock !== null ? (itemsPerDock / interval) * 60 : null,
    capacityStacks: t.capacityStacks ?? null, capacityFluid: t.capacityFluid ?? null,
    empty: itemsPerDock !== null && itemsPerDock <= 0,
    fill: capacity !== null && itemsPerDock !== null ? Math.min(1, itemsPerDock / capacity) : null,
    fillApprox: stack?.approx ?? false,
  };
}

/**
 * Stations with their vehicles' throughput, and vehicles with their route. With stack sizes (`recipes.json` items)
 * each visit also says how full the vehicle is: by what the vehicle holds, else what the station holds.
 */
export function analyzeRoutes(s: Pick<FactorySnapshot, 'stations' | 'vehicles'>, sizes?: StackSizes): RouteAnalysis {
  const cargoOfVehicle = new Map(s.vehicles.map(v => [v.id, v.cargo ?? []]));
  const stations: StationFlow[] = s.stations.map(st => {
    const visits = st.traffic.map(t => {
      const own = cargoOfVehicle.get(t.vehicle) ?? [];
      return visitOf(t, own.length > 0 ? own : st.cargo ?? [], sizes);
    });
    const itemsPerMin = sumOrNull(visits.map(v => v.itemsPerMin));
    const rates = visits.map(v => v.interval).filter((x): x is number => x !== null);
    const fills = visits.filter(v => v.fill !== null);
    const fill = meanOrNull(fills.map(v => v.fill)) ?? (visits.length > 0 && visits.every(v => v.empty) ? 0 : null);
    const flow: StationFlow = {
      id: st.id, cls: st.cls, x: st.x, y: st.y, z: st.z, loading: st.loading ?? null, visits,
      itemsPerMin, interval: meanOrNull(visits.map(v => v.interval)),
      combinedInterval: rates.length > 0 ? 1 / rates.reduce((sum, x) => sum + 1 / x, 0) : null,
      cargo: st.cargo ?? [],
      fill, fillApprox: fills.some(v => v.fillApprox),
      problem: null,
    };
    flow.problem = stationProblem(flow);
    if (st.name) flow.name = st.name;
    return flow;
  });
  const byId = new Map(stations.map(st => [st.id, st]));
  const vehicles: VehicleFlow[] = s.vehicles.map(v => {
    const first = new Map<string, number>();
    const stops: RouteStop[] = v.route.map((id, i) => {
      const st = byId.get(id);
      const stop: RouteStop = { station: id, loading: st?.loading ?? null, visit: st?.visits.find(x => x.vehicle === v.id) ?? null };
      const at = first.get(id);
      if (at !== undefined) stop.repeat = at + 1; else first.set(id, i);
      return stop;
    });
    const unique = [...new Map(stops.map(x => [x.station, x])).values()];
    const count = (id: string) => stops.filter(x => x.station === id).length;
    const flow: VehicleFlow = {
      id: v.id, cls: v.cls, x: v.x, y: v.y, z: v.z, autopilot: v.autopilot, fuel: v.fuel ?? null, stops,
      cargo: v.cargo ?? [], slots: v.slots ?? null,
      emptyLegs: unique.filter(x => x.visit?.empty === true).map(x => x.station),
      loadedPerMin: sumOrNull(unique.filter(x => x.loading === true).map(x => x.visit?.itemsPerMin ?? null)),
      unloadedPerMin: sumOrNull(unique.filter(x => x.loading === false).map(x => x.visit?.itemsPerMin ?? null)),
      roundTrip: meanOrNull(unique.map(x => (x.visit?.interval != null ? x.visit.interval * count(x.station) : null))),
    };
    if (v.name) flow.name = v.name;
    return flow;
  });
  return { stations, vehicles };
}
