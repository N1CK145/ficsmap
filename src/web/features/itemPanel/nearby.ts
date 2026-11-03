import type { Item } from '../../../shared/dataset.js';
import { distance3d, UNITS_PER_METER } from '../../../shared/geo.js';

export const NEARBY_RADIUS_M = 150;
export const NEARBY_MAX = 6;

export interface NearbyItem { item: Item; distM: number; dzM: number }

/**
 * Up to `max` other items within `radiusM` (3D distance), nearest first (spec §10.2). `dzM` is the
 * other item's height relative to `item`: negative means below. A linear scan; ~1.8k items is cheap.
 */
export function nearby(item: Item, items: readonly Item[], radiusM = NEARBY_RADIUS_M, max = NEARBY_MAX): NearbyItem[] {
  const out: NearbyItem[] = [];
  for (const other of items) {
    if (other.name === item.name) continue;
    const distM = distance3d(item, other) / UNITS_PER_METER;
    if (distM <= radiusM) out.push({ item: other, distM, dzM: (other.z - item.z) / UNITS_PER_METER });
  }
  return out.sort((a, b) => a.distM - b.distM).slice(0, max);
}
