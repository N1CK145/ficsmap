import { COLLECTIBLE_TYPES } from '../../../shared/collectibleTypes.js';
import type { DatasetIndex } from '../../../shared/dataset.js';
import { hasMismatch, type MarksCache } from '../marks/useMarks.js';

const typeOrder = new Map(COLLECTIBLE_TYPES.map((t, i) => [t.id, i]));

/**
 * The checked actors the last import still flagged and that this dataset knows, in reading order:
 * type (registry order), then biome (English name, compared alphabetically), then the item's number (numeric). Actors with
 * a pending write do not count (the write clears the flag).
 */
export function conflictActors(cache: MarksCache, index: DatasetIndex): string[] {
  const rows: { name: string; type: number; biome: string; seq: number }[] = [];
  for (const name of cache.marks.keys()) {
    const item = index.byName.get(name);
    if (!item || !hasMismatch(cache, name)) continue;
    rows.push({ name, type: typeOrder.get(item.type) ?? 0, biome: index.ds.biomes[item.biome]?.name.en ?? '', seq: item.seq });
  }
  rows.sort((a, b) => a.type - b.type || a.biome.localeCompare(b.biome, 'en') || a.seq - b.seq);
  return rows.map(r => r.name);
}
