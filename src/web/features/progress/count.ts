import { COLLECTIBLE_TYPES } from '../../../shared/collectibleTypes.js';
import type { Item } from '../../../shared/dataset.js';
import type { CollectibleTypeId } from '../../../shared/types.js';

export interface Count { done: number; total: number }

/**
 * Progress counts (spec §10, §10.4): `byType` covers the selected biome (all biomes when `biome` is
 * null) and ignores the type filter; `byBiome` covers the enabled types. `byBiome` has one entry per
 * biome: `biomeCount` entries (pass `ds.biomes.length`, so biomes without items count too), at
 * least up to the highest biome index in `items`.
 */
export function countProgress(items: Item[], isDone: (name: string) => boolean, o: { typeFilter: Set<CollectibleTypeId>; biome: number | null; biomeCount?: number }):
  { byType: Record<CollectibleTypeId, Count>; byBiome: Count[] } {
  const byType = Object.fromEntries(COLLECTIBLE_TYPES.map(t => [t.id, { done: 0, total: 0 }])) as Record<CollectibleTypeId, Count>;
  const byBiome: Count[] = [];
  const ensureBiome = (i: number): Count => {
    while (byBiome.length <= i) byBiome.push({ done: 0, total: 0 });
    return byBiome[i]!;
  };
  if (o.biomeCount !== undefined && o.biomeCount > 0) ensureBiome(o.biomeCount - 1);

  for (const item of items) {
    const done = isDone(item.name) ? 1 : 0;
    if (o.biome === null || item.biome === o.biome) {
      const c = byType[item.type];
      c.total++;
      c.done += done;
    }
    if (o.typeFilter.has(item.type) && item.biome >= 0) {
      const c = ensureBiome(item.biome);
      c.total++;
      c.done += done;
    }
  }
  return { byType, byBiome };
}
