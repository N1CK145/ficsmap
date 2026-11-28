import { isFluid, type Names, type RecipeIndex } from './recipes.js';

/**
 * Which conveyor belt or pipeline a flow of the planner needs: the slowest tier that carries it, from the dataset's
 * `recipes.json` (`belts`: `mSpeed` / 2 per minute, `pipes`: `mFlowLimit` × 60 m³/min). A flow faster than the
 * fastest tier needs that tier several times side by side. Pure.
 */

export interface TransportTier {
  kind: 'belt' | 'pipe';
  /** Building class of the tier, e.g. `Build_ConveyorBeltMk2_C`. */
  id: string;
  name: Names;
  /** What one line of it carries per minute (fluids in m³). */
  rate: number;
  /** Lines of this tier side by side: 1 unless even the fastest tier is too slow. */
  lines: number;
}

/** Below this, a flow fits a tier exactly (float noise). */
const EPS = 1e-6;

/**
 * The tier a flow of `rate` per minute of `item` needs: belts for solids (not lifts), pipelines for fluids (one per flow
 * limit; the clean variants without flow indicator are the same). Undefined without a flow, or for a dataset built
 * before belts and pipes were added.
 */
export function transportTier(index: RecipeIndex, item: string, rate: number): TransportTier | undefined {
  if (!Number.isFinite(rate) || rate <= EPS) return undefined;
  const fluid = isFluid(index.items.get(item));
  const tiers = fluid
    ? (index.data.pipes ?? []).map(p => ({ ...p, kind: 'pipe' as const }))
    : (index.data.belts ?? []).filter(b => b.kind === 'belt').map(b => ({ ...b, kind: 'belt' as const }));
  const sorted = tiers
    .filter((tr, i, all) => all.findIndex(o => o.rate === tr.rate) === i)
    .sort((a, b) => a.rate - b.rate);
  if (sorted.length === 0) return undefined;
  const fit = sorted.find(tr => tr.rate >= rate - EPS);
  const tier = fit ?? sorted[sorted.length - 1]!;
  return { kind: tier.kind, id: tier.id, name: tier.name, rate: tier.rate, lines: fit ? 1 : Math.ceil(rate / tier.rate - EPS) };
}

/** "Mk.2" from a tier's name ("Conveyor Belt Mk.2", "Pipeline Mk.2"); the whole name if it has no Mk. number. */
export function tierShort(name: string): string {
  return /Mk\.\s?\d+/i.exec(name)?.[0] ?? name;
}
