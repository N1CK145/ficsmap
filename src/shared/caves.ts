/**
 * Caves. Their shape comes from the game's 3D geometry (scripts/cave-geometry.ts); this file holds what the
 * dataset build and the app share: the extractor's cave volumes and the served `caves.geojson`.
 */

/** One convex element of a cave volume: 2D hull in world X/Y (cm) and its Z range. */
export interface RawCaveElement { hull: number[][]; zMin: number; zMax: number }
/** A cave sound or fog volume, from the extractor's caves.json (`--caves-out`). */
export interface RawCaveVolume { name: string; source: string; elements: RawCaveElement[] }
export interface RawCaves { volumes: RawCaveVolume[] }

/** An element this many times larger (any axis) than its volume's median element is a broken brush (seen twice). */
const OUTLIER_FACTOR = 5;

/** A volume's elements without the ones far larger than the rest. */
export function cleanElements(elements: readonly RawCaveElement[]): RawCaveElement[] {
  if (elements.length < 3) return [...elements];
  const size = (e: RawCaveElement) => {
    const xs = e.hull.map(p => p[0]!), ys = e.hull.map(p => p[1]!);
    return Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), e.zMax - e.zMin);
  };
  const sizes = elements.map(size);
  const median = [...sizes].sort((a, b) => a - b)[Math.floor(sizes.length / 2)]!;
  return elements.filter((_, i) => sizes[i]! <= OUTLIER_FACTOR * median);
}

/** A cave's outline rings (world cm, filled even-odd: outer rings and holes) and its entrances. */
export interface CaveShape { id: string; rings: number[][][]; entrances: { x: number; y: number; z: number }[] }

/**
 * `caves.geojson`, world coordinates: per cave one `kind: "cave"` feature whose polygon holds all its rings
 * (even-odd fill, so holes need no special order), and per entrance one `kind: "entrance"` point with its
 * height in `z` (cm).
 */
export function cavesToGeojson(caves: readonly CaveShape[]) {
  const round = (p: readonly number[]) => p.map(v => Math.round(v));
  return {
    type: 'FeatureCollection',
    features: [
      ...caves.map(c => ({
        type: 'Feature',
        properties: { kind: 'cave', id: c.id },
        geometry: { type: 'Polygon', coordinates: c.rings.map(r => [...r.map(round), round(r[0]!)]) },
      })),
      ...caves.flatMap(c => c.entrances.map(e => ({
        type: 'Feature',
        properties: { kind: 'entrance', cave: c.id, z: Math.round(e.z) },
        geometry: { type: 'Point', coordinates: round([e.x, e.y]) },
      }))),
    ],
  };
}
