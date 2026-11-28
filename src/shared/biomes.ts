import { distanceToRings, imageToWorld, pointInRings, type Calibration } from './geo.js';

/** World coords; groups merged. `nameDe`: German name where the source has one (else `name` in both languages). */
export interface BiomeShape { id: string; name: string; nameDe?: string; rings: number[][][] }

interface EditorFeature {
  properties?: { name?: string; group?: string | null };
  geometry?: { type: string; coordinates: unknown } | null;
}

function kebab(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function polygonsOf(g: EditorFeature['geometry']): number[][][][] {
  if (!g) return [];
  if (g.type === 'Polygon') return [g.coordinates as number[][][]];
  if (g.type === 'MultiPolygon') return g.coordinates as number[][][][];
  return [];
}

/** Features sharing `group ?? name` merge into one biome; order = first appearance. */
export function loadEditorBiomes(geojson: unknown, c: Calibration): BiomeShape[] {
  const features = ((geojson as { features?: EditorFeature[] }).features ?? []);
  const byName = new Map<string, BiomeShape>();
  for (const f of features) {
    const name = f.properties?.group ?? f.properties?.name ?? '';
    let biome = byName.get(name);
    if (!biome) {
      biome = { id: kebab(name), name, rings: [] };
      byName.set(name, biome);
    }
    for (const poly of polygonsOf(f.geometry)) {
      for (const ring of poly) {
        biome.rings.push(ring.map(([x, y]) => {
          const w = imageToWorld(x ?? 0, y ?? 0, c);
          return [w.x, w.y];
        }));
      }
    }
  }
  return [...byName.values()];
}

/** Containing biome index; else nearest within snapUnits; else -1. Ties → lower index. */
export function assignBiome(x: number, y: number, biomes: BiomeShape[], snapUnits: number): number {
  for (let i = 0; i < biomes.length; i++) {
    if (pointInRings(x, y, biomes[i]!.rings)) return i;
  }
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < biomes.length; i++) {
    const d = distanceToRings(x, y, biomes[i]!.rings);
    if (d < bestD) { bestD = d; best = i; }
  }
  return bestD <= snapUnits ? best : -1;
}

/** `biomes.geojson` of a dataset: one feature per biome (or several), `idx` as in `Dataset.biomes`, world coordinates. */
export interface BiomeCollection {
  features: { properties?: { idx?: number } | null; geometry?: { type: string; coordinates: unknown } | null }[];
}

/**
 * Which biome a point lies in, by the dataset's `biomes.geojson`: the `idx` of the biome containing it, else of the
 * nearest one within `snapUnits` (as the dataset build assigns items), else -1.
 */
export function biomeLocator(fc: BiomeCollection, snapUnits: number): (x: number, y: number) => number {
  const shapes: BiomeShape[] = [];
  for (const f of fc.features) {
    const idx = f.properties?.idx;
    if (typeof idx !== 'number' || !Number.isInteger(idx) || idx < 0) continue;
    while (shapes.length <= idx) shapes.push({ id: '', name: '', rings: [] });
    for (const poly of polygonsOf(f.geometry ?? null)) shapes[idx]!.rings.push(...poly);
  }
  // Bounding boxes, grown by the snap distance: a point outside one can be neither in that biome nor near enough.
  const boxes = shapes.map(b => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const ring of b.rings) for (const [px, py] of ring) {
      minX = Math.min(minX, px!); minY = Math.min(minY, py!); maxX = Math.max(maxX, px!); maxY = Math.max(maxY, py!);
    }
    return { minX: minX - snapUnits, minY: minY - snapUnits, maxX: maxX + snapUnits, maxY: maxY + snapUnits };
  });
  const empty: BiomeShape = { id: '', name: '', rings: [] };
  return (x, y) => {
    const near = shapes.map((b, i) => {
      const box = boxes[i]!;
      return x >= box.minX && x <= box.maxX && y >= box.minY && y <= box.maxY ? b : empty;
    });
    return assignBiome(x, y, near, snapUnits);
  };
}
