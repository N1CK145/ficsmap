import { PURITY_FACTOR } from './planner.js';
import type { GameExtractor, RecipeIndex } from './recipes.js';
import type { ExtractorInfo, ExtractorKind, Purity, ResourceNode } from './resourceNodes.js';

/**
 * Extraction rates on resource nodes, from the extractors in `recipes.json` (rate at 100 % clock speed on a normal
 * node) and the purity factors (`PURITY_FACTOR`, from the Satisfactory wiki). Units per minute; fluids in m³.
 * Geysers (the geothermal generator makes power, no items), cores (the pressurizer extracts nothing itself) and the
 * portable miner (not in the recipe data) have no rate.
 */

/** Units per minute: the extractor's rate at 100 % on a normal node × the purity factor × the clock speed (1 = 100 %). */
export function extractionRate(base: number, purity: Purity, clock = 1): number {
  return base * PURITY_FACTOR[purity] * clock;
}

/**
 * The extractors of the recipe data that can stand on a node: on a resource node the miners (by tier) for a solid
 * resource or the oil extractor for crude oil, on a well's satellite the resource well extractor. None for cores and
 * geysers, and none that are not built on nodes (the water extractor).
 */
export function extractorsForNode(node: Pick<ResourceNode, 'kind' | 'resource'>, index: RecipeIndex): GameExtractor[] {
  if (node.kind !== 'node' && node.kind !== 'satellite') return [];
  const well = node.kind === 'satellite';
  return (index.extractorsFor.get(node.resource) ?? []).filter(e => e.onNode && (e.kind === 'well') === well);
}

export interface NodeRate { extractor: GameExtractor; rate: number }

/** What each fitting extractor gets out of the node at 100 % clock speed; empty without a purity. */
export function nodeRates(node: Pick<ResourceNode, 'kind' | 'resource' | 'purity'>, index: RecipeIndex): NodeRate[] {
  const { purity } = node;
  if (purity === null) return [];
  return extractorsForNode(node, index).map(extractor => ({ extractor, rate: extractionRate(extractor.rate, purity) }));
}

/** The extractor of the recipe data a save's extractor kind stands for, among those that fit the node. */
export function gameExtractorFor(kind: ExtractorKind, fitting: readonly GameExtractor[]): GameExtractor | undefined {
  switch (kind) {
    case 'miner1': case 'miner2': case 'miner3':
      return fitting.find(e => e.kind === 'miner' && e.tier === Number(kind.slice(-1)));
    case 'oil': return fitting.find(e => e.kind === 'pump');
    case 'well': return fitting.find(e => e.kind === 'well');
    default: return undefined;
  }
}

export interface PlacedRate { extractor: GameExtractor; clock: number; rate: number }

/**
 * What an extractor from the save import gets out of the node: its rate × the purity × its clock speed. A resource
 * well extractor runs at its pressurizer's clock speed (`pressurizerClock`, from the well's core). Null when the
 * recipe data has no such extractor for the node (portable miner, geothermal generator, pressurizer) or the clock
 * speed is unknown (a well without a pressurizer extracts nothing).
 */
export function placedRate(
  node: Pick<ResourceNode, 'kind' | 'resource' | 'purity'>, e: ExtractorInfo, index: RecipeIndex, pressurizerClock: number | null = null,
): PlacedRate | null {
  if (node.purity === null) return null;
  const extractor = gameExtractorFor(e.kind, extractorsForNode(node, index));
  const clock = e.kind === 'well' ? pressurizerClock : e.clock;
  if (!extractor || clock === null) return null;
  return { extractor, clock, rate: extractionRate(extractor.rate, node.purity, clock) };
}

/** The clock speed of the pressurizer on a well's core, or null (no core, no pressurizer, or no clock in the save). */
export function pressurizerClock(node: Pick<ResourceNode, 'core'>, extractors: ReadonlyMap<string, readonly ExtractorInfo[]>): number | null {
  if (node.core === undefined) return null;
  return extractors.get(node.core)?.find(e => e.kind === 'pressurizer')?.clock ?? null;
}

/** All extractors built on nodes (miners, oil extractor, resource well extractor) with their rate on a node of this purity. */
export function purityRates(purity: Purity, index: RecipeIndex): NodeRate[] {
  const order = { miner: 0, pump: 1, well: 2 } as const;
  return [...index.extractors.values()]
    .filter(e => e.onNode)
    .sort((a, b) => order[a.kind] - order[b.kind] || (a.tier ?? 0) - (b.tier ?? 0))
    .map(extractor => ({ extractor, rate: extractionRate(extractor.rate, purity) }));
}
