import type { Band } from './factory/analysis.js';
import { perMinute, type ClockData, type GameExtractor, type GameRecipe, type RecipeIndex } from './recipes.js';

/**
 * The production planner's core: from target items and rates per minute down to the extractors.
 * Pure; all numbers come from the recipe data (`recipes.ts`) and the settings.
 *
 * Every item in the plan gets one step: a recipe (machines), an extractor, or "supplied from outside".
 * The steps form a graph (a step consumes the items of other steps). Machine counts follow from one
 * balance per item: what its step makes = what the targets ask for + what the other steps consume.
 * That is a linear system, solved exactly, so loops (e.g. Recycled Rubber and Recycled Plastic feeding
 * each other) need no recursion: a loop that makes more than it consumes gets a finite answer, one
 * that does not is reported as an error.
 *
 * By-products count against demand: a step's by-products enter the balance of their item like its main
 * product, so the item's own step needs fewer buildings. Where by-products alone cover an item, its step
 * gets no buildings (the balance becomes "at least the demand") and the rest is listed as surplus. Two steps
 * running the same recipe are not coupled (see below), so such a plan can use more buildings than needed.
 *
 * Clock speed per step (see `clockLimits`, 1 % to 250 %): output and inputs scale linearly, power with the
 * building's power exponent. Extractors on a resource node also scale with the node's purity. A resource
 * well's clock speed is set at its pressurizer and applies to all its extractors (they cannot be
 * overclocked themselves): a well step's clock speed is the pressurizer's, its Power Shards go into the
 * pressurizer, and the pressurizer's power scales with it; the extractors need no power.
 */

/** How an item is obtained. */
export type Choice =
  | { kind: 'recipe'; recipe: string }
  /** `extractor` left out (solid resources only): the miner from the settings. */
  | { kind: 'extract'; extractor?: string }
  /** Not made in this plan: brought in, or nothing in the data makes it (Leaves, Uranium Waste, …). */
  | { kind: 'external' };

/** A resource node's purity. */
export type Purity = 'impure' | 'normal' | 'pure';

/**
 * Extraction rate factor per purity. Not in the game's Docs files; from the Satisfactory wiki
 * (Resource node, "Purity": building multiplier × 0.5 / × 1.0 / × 2.0, the same for oil nodes and
 * resource well satellites).
 */
export const PURITY_FACTOR: Readonly<Record<Purity, number>> = { impure: 0.5, normal: 1, pure: 2 };

/**
 * Power Shard slots per building. Not in the game's Docs files (`mPotentialShardSlots` is 0 there; the
 * slots come with research); from the Satisfactory wiki (Clock speed): up to 3 shards, i.e. 250 % with
 * +50 % per shard.
 */
export const MAX_SHARDS = 3;

/** Clock speed range and what one Power Shard adds, 1 = 100 %. */
export interface ClockLimits { min: number; max: number; perShard: number }

/**
 * The clock speed limits for the recipe data: the minimum (`mMinPotential`, 1 %) and the step per Power
 * Shard (`mExtraPotential`, +50 %) come from the Docs; the maximum is 100 % plus `MAX_SHARDS` shards.
 */
export function clockLimits(clock: ClockData): ClockLimits {
  return { min: clock.min, max: 1 + MAX_SHARDS * clock.perShard, perShard: clock.perShard };
}

/** Power Shards one building (for a resource well: its pressurizer) needs for a clock speed. */
export function shardsFor(clock: number, perShard: number): number {
  return clock <= 1 + 1e-9 ? 0 : Math.ceil((clock - 1) / perShard - 1e-9);
}

export interface PlanSettings {
  /** The miner for solid resources (extractor id). */
  miner: string;
  /** Default clock speed of extractors, 1 = 100 %. Production buildings default to 100 %. */
  clock: number;
  /** Default purity of the nodes extractors are built on (not water extractors). */
  purity: Purity;
}

/** Per step, overriding the defaults. */
export interface StepSettings {
  /** Clock speed, 1 = 100 %. */
  clock?: number;
  /** Purity of the node (extractors on a node only). */
  purity?: Purity;
}

export interface Flow { item: string; rate: number }

export interface PlanInput {
  targets: readonly Flow[];
  /** Per item; items without an entry (or with one that does not fit the item) get `defaultChoice`. */
  choices?: Readonly<Record<string, Choice>>;
  /** Per item: clock speed and purity of its step. */
  steps?: Readonly<Record<string, StepSettings>>;
  settings: PlanSettings;
}

export interface PlanStep {
  item: string;
  choice: Choice;
  recipe?: GameRecipe;
  extractor?: GameExtractor;
  /** The building: a machine id (recipe) or an extractor id; undefined for an external item. */
  building?: string;
  /** Units per minute of `item` this step makes. */
  rate: number;
  /** Of that, what the targets ask for (the rest goes into other steps). */
  targetRate: number;
  /** Buildings needed, exact (fractional) and rounded up. 0 for an external item. */
  machines: number;
  machinesCeil: number;
  /** Per minute, for all buildings of the step together. */
  inputs: Flow[];
  /** All products, `item` first. */
  outputs: Flow[];
  /** Products other than `item`. */
  byproducts: Flow[];
  /** Clock speed of the step's buildings, 1 = 100 % (1 for an external item); for a resource well step the pressurizer's. */
  clock: number;
  /** Power Shards per building for that clock speed; for a resource well step per pressurizer (none in the extractors). */
  shards: number;
  /**
   * Resource well steps: the pressurizer each well needs (`building`), with its MW at the step's clock speed.
   * How many wells the step needs depends on their sub-nodes, so this power is not in `power` nor in the totals.
   */
  pressurizer?: { building: string; power: number };
  /** The node purity, for extractors on a node. */
  purity?: Purity;
  /** Units per minute of `item` that by-products of other steps supply. */
  fromByproducts: number;
  /**
   * Why the choice is not the user's or the default: `loop` = supplied from outside automatically, because
   * the default recipe would loop back into the step that asked for it (Packaged Fuel for Unpackage Fuel).
   */
  auto?: 'loop';
  /** MW for the exact machine count; min < max only for variable-power buildings. */
  power: { min: number; max: number };
  /** Part of a loop in the recipe graph. */
  cycle: boolean;
  /** Distance from the targets (0) along the longest path; extraction comes last. */
  depth: number;
}

export interface MachineTotal { building: string; machines: number; machinesCeil: number }

export interface PlanTotals {
  /** Extracted resources (per resource and extractor). */
  raw: (Flow & { extractor: string; machines: number; machinesCeil: number })[];
  /** Items supplied from outside. */
  external: Flow[];
  /** What the plan makes beyond its needs: by-products nobody uses, and items by-products oversupply. */
  byproducts: Flow[];
  /** Per building (machines and extractors). */
  machines: MachineTotal[];
  power: { min: number; max: number };
  /**
   * Power Shards in all buildings: per step its shards per building × its buildings (rounded up). Not the pressurizers
   * of resource wells: how many wells a step needs depends on their sub-nodes (see `pressurizers`).
   */
  shards: number;
  /** Per resource well step: the pressurizer each of its wells needs (not counted in `power`). */
  pressurizers: { item: string; building: string; clock: number; shards: number; power: number }[];
}

export type PlanResult =
  | { ok: true; steps: PlanStep[]; totals: PlanTotals }
  | { ok: false; error: 'no-targets' }
  | { ok: false; error: 'unknown-item'; item: string }
  /** Default clock speed outside `clockLimits` (1 %–250 %), or an unknown purity. */
  | { ok: false; error: 'invalid-settings' }
  /** A step's clock speed outside `clockLimits`. */
  | { ok: false; error: 'invalid-clock'; item: string }
  /** A loop that consumes at least as much as it makes: no finite plan. */
  | { ok: false; error: 'cycle'; items: string[] };

/** Below this, a value counts as zero (float noise). */
const EPS = 1e-9;

export function ceilMachines(n: number): number {
  // Math.max: ceil of a tiny negative is -0.
  return Math.max(0, Math.ceil(n - 1e-6));
}

/** What the planner uses for an item when the user chose nothing: extract a resource, else the default recipe, else external. */
export function defaultChoice(index: RecipeIndex, item: string): Choice {
  const extractors = index.extractorsFor.get(item);
  if (extractors?.length) {
    // Solids follow the miner setting; fluids name their extractor (pumps come before wells).
    return extractors.some(e => e.kind === 'miner') ? { kind: 'extract' } : { kind: 'extract', extractor: extractors[0]!.id };
  }
  const recipe = index.producers.get(item)?.[0];
  return recipe ? { kind: 'recipe', recipe: recipe.id } : { kind: 'external' };
}

/**
 * The options for an item, in the order offered: its extractors (miners by tier, then pumps and wells), each one an
 * option of its own, then its recipes (default first), then external. The default of a solid resource, "the miner of
 * the settings" (`{ kind: 'extract' }`), is not an option itself: `offeredChoice` names its miner.
 */
export function choiceOptions(index: RecipeIndex, item: string): Choice[] {
  const out: Choice[] = [];
  for (const e of index.extractorsFor.get(item) ?? []) out.push({ kind: 'extract', extractor: e.id });
  for (const r of index.producers.get(item) ?? []) out.push({ kind: 'recipe', recipe: r.id });
  out.push({ kind: 'external' });
  return out;
}

/** A choice as `choiceOptions` offers it: an extract choice that follows the miner setting names that miner. */
export function offeredChoice(index: RecipeIndex, item: string, choice: Choice, settings: Pick<PlanSettings, 'miner'>): Choice {
  if (choice.kind !== 'extract' || choice.extractor) return choice;
  const extractor = resolveExtractor(index, item, choice, settings);
  return extractor ? { kind: 'extract', extractor: extractor.id } : choice;
}

/**
 * The same output from whole buildings: the step's rounded-up count running at a lower clock speed (1 = 100 %, rounded
 * up to 0.01 %, so that clock speed never needs another building). Undefined when the count is whole already, for an
 * external step, or when the clock speed would fall below the minimum.
 */
export function evenClock(step: Pick<PlanStep, 'machines' | 'machinesCeil' | 'clock'>, limits: ClockLimits): number | undefined {
  if (step.machinesCeil < 1 || Math.abs(step.machines - step.machinesCeil) < 1e-6) return undefined;
  const clock = Math.ceil(((step.clock * step.machines) / step.machinesCeil) * 1e4 - 1e-6) / 1e4;
  return clock >= limits.min - 1e-9 ? clock : undefined;
}

/**
 * How fully a step's buildings are used: the exact count over the built (rounded-up) count at its clock speed, 1 when
 * the count is whole (within the rounding of `ceilMachines`), e.g. 52.5 of 53 → 0.991. Undefined for a step without
 * buildings (supplied from outside, covered by by-products).
 */
export function stepUtilisation(step: Pick<PlanStep, 'machines' | 'machinesCeil'>): number | undefined {
  if (step.machinesCeil < 1 || step.machines < 1e-9) return undefined;
  return Math.abs(step.machines - step.machinesCeil) < 1e-6 ? 1 : step.machines / step.machinesCeil;
}

/**
 * The factory's productivity bands for a step's use, with a stricter top: `full` only at exactly 100 %, `high` from
 * 90 %, below that `throttled` (part load).
 */
export function utilisationBand(use: number): Extract<Band, 'full' | 'high' | 'throttled'> {
  if (use >= 1 - 1e-9) return 'full';
  return use >= 0.9 ? 'high' : 'throttled';
}

/** A stable string for a choice (select values, comparisons). */
export function choiceKey(c: Choice): string {
  if (c.kind === 'recipe') return `recipe:${c.recipe}`;
  if (c.kind === 'extract') return c.extractor ? `extract:${c.extractor}` : 'extract';
  return 'external';
}

export function parseChoiceKey(key: string): Choice | undefined {
  if (key === 'external') return { kind: 'external' };
  if (key === 'extract') return { kind: 'extract' };
  if (key.startsWith('extract:')) return { kind: 'extract', extractor: key.slice(8) };
  if (key.startsWith('recipe:')) return { kind: 'recipe', recipe: key.slice(7) };
  return undefined;
}

/** The extractor an extract choice uses, or undefined if none fits the item. */
export function resolveExtractor(index: RecipeIndex, item: string, choice: { extractor?: string }, settings: Pick<PlanSettings, 'miner'>): GameExtractor | undefined {
  const fits = index.extractorsFor.get(item) ?? [];
  if (choice.extractor) return fits.find(e => e.id === choice.extractor);
  const miner = fits.find(e => e.id === settings.miner);
  if (miner) return miner;
  return fits.find(e => e.kind !== 'miner') ?? fits[0];
}

/** The user's choice if it fits the item, else the default. */
function effectiveChoice(index: RecipeIndex, item: string, choice: Choice | undefined, settings: PlanSettings): Choice {
  if (choice?.kind === 'external') return choice;
  if (choice?.kind === 'recipe') {
    const r = index.recipes.get(choice.recipe);
    if (r?.products.some(p => p.item === item)) return choice;
  }
  if (choice?.kind === 'extract') {
    const fits = index.extractorsFor.get(item) ?? [];
    // Without an extractor only for solids (the miner setting); a fluid's choice names its extractor.
    if (choice.extractor ? fits.some(e => e.id === choice.extractor) : fits.some(e => e.kind === 'miner')) return choice;
  }
  return defaultChoice(index, item);
}

interface Spec {
  item: string; choice: Choice; recipe?: GameRecipe; extractor?: GameExtractor;
  clock: number; purity?: Purity; auto?: 'loop';
  /** Per building per minute: output of `item`, inputs, by-products. External: out 1, i.e. "machines" = rate. */
  out: number; inputs: Flow[]; byproducts: Flow[];
}

function specFor(index: RecipeIndex, item: string, choice: Choice, s: PlanSettings, st: StepSettings | undefined): Spec {
  if (choice.kind === 'recipe') {
    const recipe = index.recipes.get(choice.recipe)!;
    const clock = st?.clock ?? 1;
    const amount = recipe.products.filter(p => p.item === item).reduce((sum, p) => sum + p.amount, 0);
    const others = new Map<string, number>();
    for (const p of recipe.products) if (p.item !== item) others.set(p.item, (others.get(p.item) ?? 0) + p.amount);
    return {
      item, choice, recipe, clock, out: perMinute(recipe, amount) * clock,
      inputs: recipe.ingredients.map(g => ({ item: g.item, rate: perMinute(recipe, g.amount) * clock })),
      byproducts: [...others].map(([b, a]) => ({ item: b, rate: perMinute(recipe, a) * clock })),
    };
  }
  if (choice.kind === 'extract') {
    const extractor = resolveExtractor(index, item, choice, s)!;
    const clock = st?.clock ?? s.clock;
    const purity = extractor.onNode ? st?.purity ?? s.purity : undefined;
    return { item, choice, extractor, clock, purity, out: extractor.rate * clock * (purity ? PURITY_FACTOR[purity] : 1), inputs: [], byproducts: [] };
  }
  return { item, choice, clock: 1, out: 1, inputs: [], byproducts: [] };
}

const validClock = (c: number, lim: ClockLimits) => Number.isFinite(c) && c >= lim.min - 1e-9 && c <= lim.max + 1e-9;

/** Solves `a x = b` (Gaussian elimination, partial pivoting). Undefined if singular. */
export function solveLinear(a: number[][], b: number[]): number[] | undefined {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]!]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(m[r]![col]!) > Math.abs(m[pivot]![col]!)) pivot = r;
    if (Math.abs(m[pivot]![col]!) < 1e-12) return undefined;
    [m[col], m[pivot]] = [m[pivot]!, m[col]!];
    const p = m[col]!;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const row = m[r]!;
      const f = row[col]! / p[col]!;
      if (f === 0) continue;
      for (let c = col; c <= n; c++) row[c]! -= f * p[c]!;
    }
  }
  return m.map((row, i) => row[n]! / row[i]!);
}

/** Strongly connected components (Tarjan), in reverse topological order (sinks first). */
export function stronglyConnected(n: number, edges: readonly (readonly number[])[]): number[][] {
  const index = new Array<number>(n).fill(-1);
  const low = new Array<number>(n).fill(0);
  const onStack = new Array<boolean>(n).fill(false);
  const stack: number[] = [];
  const out: number[][] = [];
  let next = 0;
  // Iterative, so deep chains cannot overflow the call stack.
  for (let root = 0; root < n; root++) {
    if (index[root] !== -1) continue;
    const work: [node: number, edge: number][] = [[root, 0]];
    index[root] = low[root] = next++;
    stack.push(root); onStack[root] = true;
    while (work.length > 0) {
      const top = work[work.length - 1]!;
      const [v, e] = top;
      const targets = edges[v]!;
      if (e < targets.length) {
        top[1]++;
        const w = targets[e]!;
        if (index[w] === -1) {
          index[w] = low[w] = next++;
          stack.push(w); onStack[w] = true;
          work.push([w, 0]);
        } else if (onStack[w]) {
          low[v] = Math.min(low[v]!, index[w]!);
        }
        continue;
      }
      work.pop();
      if (work.length > 0) {
        const parent = work[work.length - 1]![0];
        low[parent] = Math.min(low[parent]!, low[v]!);
      }
      if (low[v] === index[v]) {
        const comp: number[] = [];
        let w: number;
        do { w = stack.pop()!; onStack[w] = false; comp.push(w); } while (w !== v);
        out.push(comp);
      }
    }
  }
  return out;
}

export function plan(index: RecipeIndex, input: PlanInput): PlanResult {
  const demand = new Map<string, number>();
  for (const t of input.targets) {
    if (!index.items.has(t.item)) return { ok: false, error: 'unknown-item', item: t.item };
    if (Number.isFinite(t.rate) && t.rate > 0) demand.set(t.item, (demand.get(t.item) ?? 0) + t.rate);
  }
  if (demand.size === 0) return { ok: false, error: 'no-targets' };
  const s = input.settings;
  const limits = clockLimits(index.data.clock);
  if (!validClock(s.clock, limits) || !Object.hasOwn(PURITY_FACTOR, s.purity)) return { ok: false, error: 'invalid-settings' };

  // Every item reachable from the targets through the chosen recipes, breadth first.
  const specs: Spec[] = [];
  const at = new Map<string, number>();
  /** Items whose recipe the user picked (and that fits). */
  const picked = new Set<string>();
  const queue: { item: string; from?: string }[] = [...demand.keys()].map(item => ({ item }));
  while (queue.length > 0) {
    const { item, from } = queue.shift()!;
    if (at.has(item)) continue;
    const st = input.steps?.[item];
    if (st?.clock !== undefined && !validClock(st.clock, limits)) return { ok: false, error: 'invalid-clock', item };
    const own = input.choices?.[item];
    let choice = effectiveChoice(index, item, own, s);
    let auto: Spec['auto'];
    if (own && choiceKey(own) === choiceKey(choice) && choice.kind === 'recipe') picked.add(item);
    // A picked recipe whose ingredient's default recipe needs the picked item back (Unpackage Fuel needs
    // Packaged Fuel, made from Fuel) would loop: the ingredient is supplied from outside instead.
    else if (!own && from !== undefined && picked.has(from) && choice.kind === 'recipe'
      && index.recipes.get(choice.recipe)?.ingredients.some(g => g.item === from)) {
      choice = { kind: 'external' };
      auto = 'loop';
    }
    const spec: Spec = { ...specFor(index, item, choice, s, st), ...(auto ? { auto } : {}) };
    at.set(item, specs.length);
    specs.push(spec);
    for (const g of spec.inputs) if (!at.has(g.item)) queue.push({ item: g.item, from: item });
  }
  const n = specs.length;

  // Balance per item i: (out_i * x_i + by-products of i from other steps) - inputs of i into other steps = demand_i,
  // with x = buildings per step.
  const a = specs.map(() => new Array<number>(n).fill(0));
  const fed = new Array<boolean>(n).fill(false);
  specs.forEach((sp, k) => {
    a[k]![k]! += sp.out;
    for (const g of sp.inputs) a[at.get(g.item)!]![k]! -= g.rate;
    for (const bp of sp.byproducts) {
      const r = at.get(bp.item);
      // Two steps with the same recipe (an item picked from a recipe that makes it as a by-product, which
      // another step already runs) are planned as separate buildings: coupling them would leave no exact solution.
      if (r === undefined || (sp.recipe && specs[r]!.recipe?.id === sp.recipe.id)) continue;
      a[r]![k]! += bp.rate;
      fed[r] = true;
    }
  });
  const b = specs.map(sp => demand.get(sp.item) ?? 0);

  const edges = specs.map(sp => [...new Set(sp.inputs.map(g => at.get(g.item)!))]);
  const comps = stronglyConnected(n, edges);
  const inCycle = new Array<boolean>(n).fill(false);
  for (const c of comps) {
    if (c.length > 1 || edges[c[0]!]!.includes(c[0]!)) for (const v of c) inCycle[v] = true;
  }
  const cycleError = (): PlanResult => ({ ok: false, error: 'cycle', items: specs.filter((_, i) => inCycle[i]).map(sp => sp.item) });

  // Solve; a step that by-products oversupply would get negative buildings: it gets none, and its item's
  // balance becomes "at least the demand" (dropped from the system). Repeat until no such step is left.
  const active = new Array<boolean>(n).fill(true);
  let x: number[] | undefined;
  for (;;) {
    const idx = specs.flatMap((_, i) => (active[i] ? [i] : []));
    const sol = solveLinear(idx.map(i => idx.map(j => a[i]![j]!)), idx.map(i => b[i]!));
    if (!sol) { x = undefined; break; }
    x = new Array<number>(n).fill(0);
    idx.forEach((i, j) => { x![i] = sol[j]!; });
    const over = idx.filter(i => x![i]! < -EPS && fed[i]);
    if (over.length === 0) break;
    for (const i of over) active[i] = false;
  }
  if (!x || x.some(v => !Number.isFinite(v) || v < -EPS)) return cycleError();
  const xs = x.map(v => Math.max(0, v));
  // The dropped balances must still hold.
  for (let i = 0; i < n; i++) {
    if (active[i]) continue;
    const net = specs.reduce((sum, _, k) => sum + a[i]![k]! * xs[k]!, 0);
    if (net < b[i]! - 1e-6) return cycleError();
  }

  // Depth: longest path from the targets over the components (Tarjan's order reversed = sources first).
  const compOf = new Array<number>(n);
  comps.forEach((c, ci) => { for (const v of c) compOf[v] = ci; });
  const compDepth = new Array<number>(comps.length).fill(-1);
  for (let ci = comps.length - 1; ci >= 0; ci--) {
    const c = comps[ci]!;
    if (compDepth[ci] === -1) compDepth[ci] = 0;
    for (const v of c) {
      for (const w of edges[v]!) {
        const cw = compOf[w]!;
        if (cw !== ci) compDepth[cw] = Math.max(compDepth[cw]!, compDepth[ci]! + 1);
      }
    }
  }

  // Per item: what the steps consume, and what by-products supply.
  const consumed = new Map<string, number>();
  const byproductSupply = new Map<string, number>();
  specs.forEach((sp, k) => {
    for (const g of sp.inputs) consumed.set(g.item, (consumed.get(g.item) ?? 0) + g.rate * xs[k]!);
    for (const bp of sp.byproducts) byproductSupply.set(bp.item, (byproductSupply.get(bp.item) ?? 0) + bp.rate * xs[k]!);
  });

  const steps: PlanStep[] = [];
  specs.forEach((sp, i) => {
    const machines = xs[i]!;
    const fromByproducts = byproductSupply.get(sp.item) ?? 0;
    // Left over from the search: an ingredient of a step that by-products made unnecessary.
    if (machines < EPS && fromByproducts < EPS && (consumed.get(sp.item) ?? 0) < EPS && !demand.has(sp.item)) return;
    const rate = machines * sp.out;
    const external = sp.choice.kind === 'external';
    const step: PlanStep = {
      item: sp.item, choice: sp.choice, rate, targetRate: demand.get(sp.item) ?? 0,
      machines: external ? 0 : machines,
      machinesCeil: external ? 0 : ceilMachines(machines),
      inputs: sp.inputs.map(g => ({ item: g.item, rate: g.rate * machines })),
      outputs: [{ item: sp.item, rate }, ...sp.byproducts.map(bp => ({ item: bp.item, rate: bp.rate * machines }))],
      byproducts: sp.byproducts.map(bp => ({ item: bp.item, rate: bp.rate * machines })),
      clock: sp.clock, shards: external ? 0 : shardsFor(sp.clock, limits.perShard),
      ...(sp.purity ? { purity: sp.purity } : {}),
      fromByproducts,
      ...(sp.auto ? { auto: sp.auto } : {}),
      power: { min: 0, max: 0 }, cycle: inCycle[i]!, depth: compDepth[compOf[i]!]!,
    };
    if (sp.recipe) {
      const r = sp.recipe;
      const m = index.machines.get(r.machine);
      step.recipe = r;
      step.building = r.machine;
      const per = r.power ?? { min: m?.power ?? 0, max: m?.power ?? 0 };
      const f = sp.clock ** (m?.powerExponent ?? 1) * machines;
      step.power = { min: per.min * f, max: per.max * f };
    } else if (sp.extractor) {
      const e = sp.extractor;
      step.extractor = e;
      step.building = e.id;
      // A resource well's extractors run at 100 %; the clock speed is the pressurizer's.
      const pressurizer = e.kind === 'well' ? index.data.wellPressurizer : undefined;
      const p = e.power * (e.kind === 'well' ? 1 : sp.clock ** e.powerExponent) * machines;
      step.power = { min: p, max: p };
      if (pressurizer) step.pressurizer = { building: pressurizer.id, power: pressurizer.power * sp.clock ** pressurizer.powerExponent };
    }
    steps.push(step);
  });
  steps.sort((p, q) => p.depth - q.depth);

  // Surplus: everything made beyond what the steps consume and the targets ask for.
  const made = new Map<string, number>();
  for (const st of steps) for (const o of st.outputs) made.set(o.item, (made.get(o.item) ?? 0) + o.rate);
  const surplus: Flow[] = [];
  for (const [item, rate] of made) {
    const left = rate - (consumed.get(item) ?? 0) - (demand.get(item) ?? 0);
    if (left > 1e-6) surplus.push({ item, rate: left });
  }

  return { ok: true, steps, totals: totals(steps, surplus) };
}

function addFlow(list: Flow[], item: string, rate: number): void {
  const f = list.find(x => x.item === item);
  if (f) f.rate += rate;
  else list.push({ item, rate });
}

function totals(steps: readonly PlanStep[], surplus: Flow[]): PlanTotals {
  const t: PlanTotals = { raw: [], external: [], byproducts: surplus, machines: [], power: { min: 0, max: 0 }, shards: 0, pressurizers: [] };
  for (const st of steps) {
    if (st.choice.kind === 'external') addFlow(t.external, st.item, st.rate);
    if (st.extractor) {
      t.raw.push({ item: st.item, rate: st.rate, extractor: st.extractor.id, machines: st.machines, machinesCeil: st.machinesCeil });
    }
    if (st.pressurizer) t.pressurizers.push({ item: st.item, ...st.pressurizer, clock: st.clock, shards: st.shards });
    else t.shards += st.shards * st.machinesCeil;
    if (st.building) {
      const m = t.machines.find(x => x.building === st.building);
      if (m) { m.machines += st.machines; m.machinesCeil += st.machinesCeil; }
      else t.machines.push({ building: st.building, machines: st.machines, machinesCeil: st.machinesCeil });
    }
    t.power.min += st.power.min;
    t.power.max += st.power.max;
  }
  return t;
}
