import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BiomeShape } from '../src/shared/biomes.js';
import type { WorldBounds } from '../src/shared/types.js';
import { traceMask } from './trace.js';

/**
 * Biomes from the game's own map areas (extractor `--map-areas-out`: areas.u8 + areas.json): the raster the
 * game uses to name the region you are in, 4096 x 4096 over the map square (about 1.8 m per pixel), each pixel
 * an index into a palette of area classes. See data-src/extractor/README.md, "Map areas".
 */
export interface MapAreaEntry {
  index: number;
  class: string;
  /** The game's display name (string table World_Data, key `nameKey`) in English and German; missing in old output. */
  nameKey?: string | null;
  name?: string | null;
  nameDe?: string | null;
}
export interface MapAreas { width: number; height: number; index: Uint8Array; areas: MapAreaEntry[] }

export function readMapAreas(dir: string): MapAreas | null {
  if (!existsSync(join(dir, 'areas.json')) || !existsSync(join(dir, 'areas.u8'))) return null;
  const info = JSON.parse(readFileSync(join(dir, 'areas.json'), 'utf8')) as { width: number; height: number; areas: MapAreaEntry[] };
  const index = new Uint8Array(readFileSync(join(dir, 'areas.u8')));
  if (index.length !== info.width * info.height) throw new Error(`${dir}/areas.u8: ${index.length} bytes, expected ${info.width * info.height}`);
  return { ...info, index };
}

/** Not a biome: sea and the map's edge. */
const NO_BIOME_CLASSES = new Set(['Area_NoMansLand_1_C', 'None', '']);
const NO_BIOME_KEY = 'Locations/NoMansLand';

/**
 * The biome name of an area: the game's display name. The class name does not always say it (Area_Savanna_* is
 * shown as Rocky Desert, Area_RedJungle_2 as Jungle Spires), so it is only a fallback for extractor output without
 * names ("Area_RedBambooFields_2_C" -> "Red Bamboo Fields"). Null for no biome.
 */
export function biomeNameOf(a: MapAreaEntry): { en: string; de?: string } | null {
  if (NO_BIOME_CLASSES.has(a.class) || a.nameKey === NO_BIOME_KEY) return null;
  if (a.name) return a.nameDe ? { en: a.name, de: a.nameDe } : { en: a.name };
  const core = a.class.replace(/^Area_/, '').replace(/(_\d+)?_C$/, '');
  return { en: core.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, c => c.toUpperCase()) };
}

/**
 * How far (cm) an item on "no man's land" (sea, the map's edge: the game names no area there) may lie from a biome
 * and still get it. In 1.2.5.0 15 items lie there, all within 300 m of land (underwater pickups, coastal rocks).
 */
export const AREA_SNAP = 50000;

/** Douglas-Peucker tolerance of the outlines (cm): about one pixel. */
const SIMPLIFY = 150;
/** Smaller rings (cm²) are dropped from the outlines (single stray pixels); items still get their biome. */
const MIN_RING_AREA = 200 * 100 * 100;

/** The open sea: ground below this height (cm) that is connected to the edge of the height grid. */
export const SEA_LEVEL = -1500;

/**
 * Whether a world point is land: not open sea and not void. Open sea is every cell of the height grid below
 * SEA_LEVEL that is connected to the grid's edge over such cells (breadth-first from the edge).
 * Low ground inland stays land however deep it is (Blue Crater, the Grass Fields crater, much of the south lies
 * below -15 m), as its rim cuts it off from the sea. Undefined without a height grid.
 */
export function landTest(
  heights: { meta: { cell: number; minX: number; minY: number; width: number; height: number }; top: Float32Array } | null,
): ((x: number, y: number) => boolean) | undefined {
  if (!heights) return undefined;
  const { meta, top } = heights;
  const w = meta.width, h = meta.height;
  // Only real seabed: cells without any surface (the black void off the map's south and east edges) neither are
  // sea nor carry it, else the sea would run from the void into the low ground of the south.
  const low = (k: number) => top[k]! <= SEA_LEVEL;
  const sea = new Uint8Array(w * h);
  const queue = new Int32Array(w * h);
  let head = 0, tail = 0;
  const push = (k: number) => { if (!sea[k] && low(k)) { sea[k] = 1; queue[tail++] = k; } };
  for (let i = 0; i < w; i++) { push(i); push((h - 1) * w + i); }
  for (let j = 0; j < h; j++) { push(j * w); push(j * w + w - 1); }
  while (head < tail) {
    const k = queue[head++]!, i = k % w, j = (k - i) / w;
    if (i > 0) push(k - 1);
    if (i < w - 1) push(k + 1);
    if (j > 0) push(k - w);
    if (j < h - 1) push(k + w);
  }
  return (x, y) => {
    const i = Math.floor((x - meta.minX) / meta.cell), j = Math.floor((y - meta.minY) / meta.cell);
    return i >= 0 && j >= 0 && i < w && j < h && !sea[j * w + i] && !Number.isNaN(top[j * w + i]!);
  };
}

/**
 * The biomes of the map areas, in palette order (the game lists them roughly north to south), sub-areas of one
 * biome (`_1`, `_2`, several colours) merged, with their outlines traced from the raster, and `assign(x, y)`:
 * the biome index at a world point; on sea or off the raster the nearest biome pixel within `snapUnits`; else -1.
 *
 * With `isLand`, land the game gives no area (coastal strips and islands it marks as no man's land, about 1 km² in
 * 1.2.5.0) joins the nearest biome, so no land on the map is without a name.
 */
export function biomesFromAreas(
  m: MapAreas, world: WorldBounds, snapUnits: number, isLand?: (x: number, y: number) => boolean,
): { biomes: BiomeShape[]; assign: (x: number, y: number) => number; filled: number } {
  const names: string[] = [];
  const namesDe: (string | undefined)[] = [];
  const biomeOfIndex = new Int16Array(256).fill(-1);
  for (const a of m.areas) {
    const name = biomeNameOf(a);
    if (name === null) continue;
    let b = names.indexOf(name.en);
    if (b < 0) { b = names.push(name.en) - 1; namesDe.push(name.de); }
    biomeOfIndex[a.index] = b;
  }
  const px = (world.maxX - world.minX) / m.width, py = (world.maxY - world.minY) / m.height;
  const pix = new Int16Array(m.width * m.height);
  for (let k = 0; k < pix.length; k++) pix[k] = biomeOfIndex[m.index[k]!]!;
  const filled = isLand ? fillLand(pix, m.width, m.height, (i, j) => isLand(world.minX + (i + 0.5) * px, world.minY + (j + 0.5) * py)) : 0;
  const cellBiome = (i: number, j: number) => pix[j * m.width + i]!;

  // Pixel bounds per biome, so each is traced over its own window only.
  const box = names.map(() => [Infinity, Infinity, -Infinity, -Infinity]);
  for (let j = 0; j < m.height; j++) {
    for (let i = 0; i < m.width; i++) {
      const b = cellBiome(i, j);
      if (b < 0) continue;
      const r = box[b]!;
      if (i < r[0]!) r[0] = i; if (j < r[1]!) r[1] = j; if (i > r[2]!) r[2] = i; if (j > r[3]!) r[3] = j;
    }
  }
  const cell = Math.min(px, py);
  if (Math.abs(px - py) > 1e-6 * px) throw new Error(`map area pixels are not square (${px} x ${py})`);
  const biomes: BiomeShape[] = names.map((name, b) => {
    const [i0, j0, i1, j1] = box[b]!;
    const de = namesDe[b] ? { nameDe: namesDe[b]! } : {};
    if (!Number.isFinite(i0!)) return { id: kebab(name), name, ...de, rings: [] };
    const rings = traceMask((i, j) => cellBiome(i0! + i, j0! + j) === b, i1! - i0! + 1, j1! - j0! + 1, {
      x0: world.minX + i0! * cell, y0: world.minY + j0! * cell, cell, simplify: SIMPLIFY, minArea: MIN_RING_AREA, smooth: false,
    });
    return { id: kebab(name), name, ...de, rings: rings.map(r => r.map(([x, y]) => [Math.round(x!), Math.round(y!)])) };
  });

  const assign = (x: number, y: number): number => {
    const ci = Math.floor((x - world.minX) / cell), cj = Math.floor((y - world.minY) / cell);
    const at = (i: number, j: number) => (i < 0 || j < 0 || i >= m.width || j >= m.height ? -1 : cellBiome(i, j));
    if (at(ci, cj) >= 0) return at(ci, cj);
    // Nearest biome pixel: rings of growing radius, exact distance within each.
    const maxR = Math.ceil(snapUnits / cell);
    let best = -1, bestD = Infinity;
    for (let r = 1; r <= maxR && r <= Math.sqrt(bestD) + 1; r++) {
      for (let dj = -r; dj <= r; dj++) {
        for (let di = -r; di <= r; di++) {
          if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
          const b = at(ci + di, cj + dj);
          const d = di * di + dj * dj;
          if (b >= 0 && (d < bestD || (d === bestD && b < best))) { bestD = d; best = b; }
        }
      }
    }
    return best >= 0 && Math.sqrt(bestD) * cell <= snapUnits ? best : -1;
  };
  return { biomes, assign, filled };
}

/**
 * Gives every land pixel without a biome the biome of the nearest biome pixel (breadth-first over all pixels, so
 * islands are reached across the sea). Returns how many pixels it filled.
 */
function fillLand(pix: Int16Array, w: number, h: number, isLand: (i: number, j: number) => boolean): number {
  const near = Int16Array.from(pix);
  const queue = new Int32Array(w * h);
  let head = 0, tail = 0;
  for (let k = 0; k < pix.length; k++) if (pix[k]! >= 0) queue[tail++] = k;
  while (head < tail) {
    const k = queue[head++]!, i = k % w, j = (k - i) / w, b = near[k]!;
    if (i > 0 && near[k - 1]! < 0) { near[k - 1] = b; queue[tail++] = k - 1; }
    if (i < w - 1 && near[k + 1]! < 0) { near[k + 1] = b; queue[tail++] = k + 1; }
    if (j > 0 && near[k - w]! < 0) { near[k - w] = b; queue[tail++] = k - w; }
    if (j < h - 1 && near[k + w]! < 0) { near[k + w] = b; queue[tail++] = k + w; }
  }
  let filled = 0;
  for (let k = 0; k < pix.length; k++) {
    if (pix[k]! >= 0 || near[k]! < 0) continue;
    const i = k % w;
    if (isLand(i, (k - i) / w)) { pix[k] = near[k]!; filled++; }
  }
  return filled;
}

function kebab(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
