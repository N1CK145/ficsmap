import { distanceToRings, imageToWorld, pointInRings, type Calibration } from './geo.js';

export interface BiomeShape { id: string; name: string; rings: number[][][] } // world coords; groups merged

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
