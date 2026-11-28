import { create } from 'zustand';
import type { DatasetIndex, Item } from '../../../shared/dataset.js';
import { worldToLatLng } from '../../../shared/geo.js';
import { leg, type RouteCave, type RoutePlace } from '../../../shared/route.js';
import type { Vec3, WorldBounds } from '../../../shared/types.js';
import { caveAt } from '../caves/caveModels.js';
import type { CaveShapes } from '../caves/useCaves.js';

/** The cave of a route stop: id and entrances (for the legs, `leg`), and the number the map shows. */
export interface StopCave extends RouteCave { n: number }

/** Items flagged as in a cave but outside every outline belong to the cave of the nearest entrance this close (cm). */
const NEAR_ENTRANCE = 15_000;

/**
 * Per item in a cave (`extra.cave`) its cave: the one whose outline holds it, else (the outlines miss parts of some
 * caves) the cave of the nearest entrance within NEAR_ENTRANCE. Items without a cave are not in the map.
 */
export function stopCaves(index: DatasetIndex, shapes: CaveShapes): Map<string, StopCave> {
  const caves = new Map<string, StopCave>();
  shapes.ids.forEach((id, k) => {
    const entrances: Vec3[] = shapes.entrances.filter(e => e.cave === id).map(({ x, y, z }) => ({ x, y, z }));
    caves.set(id, { id, n: shapes.numbers[k] ?? k + 1, entrances });
  });
  const out = new Map<string, StopCave>();
  for (const item of index.items) {
    if (item.extra?.cave !== true) continue;
    let id = caveAt(...worldToLatLng(item.x, item.y, index.ds.bounds), shapes);
    if (id === null) {
      let best = NEAR_ENTRANCE;
      for (const e of shapes.entrances) {
        const d = Math.hypot(e.x - item.x, e.y - item.y);
        if (d <= best) { best = d; id = e.cave; }
      }
    }
    const cave = id === null ? undefined : caves.get(id);
    if (cave) out.set(item.name, cave);
  }
  return out;
}

/** An item as a route place, with its cave when it has one. */
export function placeOf(item: Item, caves: ReadonlyMap<string, StopCave> | null): RoutePlace & { id: string } {
  const cave = caves?.get(item.name);
  return { id: item.name, x: item.x, y: item.y, z: item.z, ...(cave ? { cave } : {}) };
}

/**
 * The caves of the route stops for the dataset on the map: set by the route layer once the dataset's caves are loaded,
 * null without caves (then the planner measures straight lines, as before).
 */
export const useRouteCaves = create<{ caves: ReadonlyMap<string, StopCave> | null; setCaves(caves: ReadonlyMap<string, StopCave> | null): void }>()(set => ({
  caves: null,
  setCaves: caves => set({ caves }),
}));

/** The route's line on the map (`[lat, lng]`): through the items, bending at the cave entrances the legs go through. */
export function routeLine(items: readonly Item[], caves: ReadonlyMap<string, StopCave> | null, bounds: WorldBounds): [number, number][] {
  const at = (p: { x: number; y: number }) => worldToLatLng(p.x, p.y, bounds);
  return items.flatMap((item, k) => {
    const via = k === 0 ? [] : leg(placeOf(items[k - 1]!, caves), placeOf(item, caves)).via;
    return [...via.map(at), at(item)];
  });
}
