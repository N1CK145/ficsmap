import { plan, PURITY_FACTOR, type Flow, type PlanInput, type PlanResult, type Purity } from './planner.js';
import type { GameExtractor, GameItem, RecipeIndex } from './recipes.js';

/**
 * The planner's "available nodes" mode: from the resource nodes the player has (resource, purity, how many, which
 * extractor) to the most the plan's targets can be made at. Pure.
 *
 * With the recipes fixed, a plan is linear in its targets: twice the targets need twice of every resource. So the
 * targets as entered are a ratio, the plan for them says what each node resource is needed per "one ratio", and the
 * largest factor that no node resource exceeds is the maximum. The resource reaching its limit first is the bottleneck.
 * Only resources extracted on nodes are limited (miners, oil extractors, resource well extractors); water from water
 * extractors and items supplied from outside are not.
 */

/** A group of the player's nodes: `count` nodes of `resource` at `purity`, each with one `extractor`. */
export interface NodeGroup { resource: string; purity: Purity; count: number; extractor: string }

/** The resources extracted on nodes (miners, oil extractors, resource well extractors), as in the data. */
export function nodeResources(index: RecipeIndex): GameItem[] {
  return index.plannable.filter(i => nodeExtractors(index, i.id).length > 0);
}

/** The extractors that work on a node of the resource, in the index's order (miners by tier, then pumps, then wells). */
export function nodeExtractors(index: RecipeIndex, resource: string): GameExtractor[] {
  return (index.extractorsFor.get(resource) ?? []).filter(e => e.onNode);
}

/** The extractor a node of the resource gets unless another is picked: the miner setting for solids, else the first. */
export function defaultNodeExtractor(index: RecipeIndex, resource: string, miner: string): GameExtractor | undefined {
  const fits = nodeExtractors(index, resource);
  return fits.find(e => e.id === miner) ?? fits[0];
}

/**
 * Per resource what the node groups give per minute at the extractor clock speed `clock` (1 = 100 %). Groups whose
 * extractor does not fit the resource, or without a positive count, give nothing.
 */
export function nodeSupply(index: RecipeIndex, groups: readonly NodeGroup[], clock: number): Map<string, number> {
  const out = new Map<string, number>();
  for (const g of groups) {
    const e = nodeExtractors(index, g.resource).find(x => x.id === g.extractor);
    if (!e || !Number.isFinite(g.count) || g.count <= 0 || !Object.hasOwn(PURITY_FACTOR, g.purity)) continue;
    out.set(g.resource, (out.get(g.resource) ?? 0) + g.count * e.rate * PURITY_FACTOR[g.purity] * clock);
  }
  return out;
}

/** A node resource of the plan: what the maximum uses of it and what the nodes give. */
export interface NodeUse { item: string; used: number; available: number }

export type MaxOutputResult =
  | {
    ok: true;
    /** How many times the targets as entered can be made (0 when a needed resource has no nodes). */
    factor: number;
    /** The targets at the maximum, per minute. */
    targets: Flow[];
    /** The plan at the maximum; undefined when the factor is 0. */
    plan?: Extract<PlanResult, { ok: true }>;
    /** Every node resource the plan needs, the bottleneck first, then by how much of it is used. */
    uses: NodeUse[];
    /** The resources that reach their limit (usually one). */
    bottleneck: string[];
  }
  | Extract<PlanResult, { ok: false }>
  /** The plan needs no node resource, so nothing limits it. */
  | { ok: false; error: 'unbounded' };

/** Relative tolerance for "reaches its limit too". */
const TIE = 1e-9;

export function maxOutput(index: RecipeIndex, input: PlanInput, supply: ReadonlyMap<string, number>): MaxOutputResult {
  const base = plan(index, input);
  if (!base.ok) return base;
  const need = new Map<string, number>();
  for (const st of base.steps) {
    if (st.extractor?.onNode && st.rate > 0) need.set(st.item, (need.get(st.item) ?? 0) + st.rate);
  }
  if (need.size === 0) return { ok: false, error: 'unbounded' };
  const limits = [...need].map(([item, rate]) => ({ item, rate, k: (supply.get(item) ?? 0) / rate }));
  const factor = Math.min(...limits.map(l => l.k));
  const bottleneck = limits.filter(l => l.k <= factor * (1 + TIE) + 1e-12).map(l => l.item);
  const targets = input.targets.flatMap(tg => (Number.isFinite(tg.rate) && tg.rate > 0 ? [{ item: tg.item, rate: tg.rate * factor }] : []));
  const uses = limits
    .map(l => ({ item: l.item, used: l.rate * factor, available: supply.get(l.item) ?? 0 }))
    .sort((a, b) => Number(bottleneck.includes(b.item)) - Number(bottleneck.includes(a.item)) || share(b) - share(a));
  if (factor <= 0) return { ok: true, factor: 0, targets, uses, bottleneck };
  const scaled = plan(index, { ...input, targets });
  if (!scaled.ok) return scaled;
  return { ok: true, factor, targets, plan: scaled, uses, bottleneck };
}

const share = (u: NodeUse) => (u.available > 0 ? u.used / u.available : 0);
