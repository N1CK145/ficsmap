import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { readHeightGrid } from './heightmap.js';
import { readMapAreas } from './map-areas.js';

/**
 * Biomes from the Satisfactory wiki's biome map (https://satisfactory.wiki.gg/wiki/File:Biome_Map.jpg, a
 * 5000 x 5000 re-creation of the developers' biome map drawn over the in-game map, covering exactly the map
 * square). Every biome is a translucent tint over the map, so with the untinted map known each pixel is
 * `wiki = A * map + B` for the tint of its biome. The tint (A, B) of each biome is fitted on sample points, then
 * every pixel gets the biome whose tint explains it best, or none if the plain map does (sea, labels, grid).
 * Two masks from the game keep land the wiki leaves without a biome that way: no man's land of the game's own map
 * areas is not filled, and the void (no surface above VOID_BELOW) gets no biome at all.
 * Writes the result in the format of the extractor's map areas (areas.u8 + areas.json), which the dataset build
 * reads with --biome-raster. See data-src/extractor/README.md, "Biomes".
 */

/** One biome of the wiki map: its name, German name and sample points (wiki image pixels) inside it. */
export interface WikiBiome { name: string; nameDe?: string; samples: [number, number][] }

const SAMPLE_RADIUS = 25;
/** Window of the majority filter (pixels, odd), and how often it runs: removes label text and speckles. */
const MODE_WINDOW = 5;
const MODE_PASSES = 2;
/** Biome pieces smaller than this (pixels, about 0.7 ha) are dropped; the dataset build gives their land to the nearest biome. */
const MIN_PIECE = 3000;
/**
 * A piece of a biome counts only within this distance (pixels, about 450 m) of the biome's largest piece or of a
 * piece holding one of its sample points. Tints that look alike far apart (Western Beaches in the Dune Desert, the
 * grey islands east of Swamp the wiki leaves without a biome) are dropped that way.
 */
const ANCHOR_REACH = 300;
export const NONE = 255;
/** Highest surface (cm) below which a cell is the void outside the world, not land: the seabed reaches about -170 m. */
export const VOID_BELOW = -20000;

/** Pixels (n x n, 1 = set) that `classifyWikiMap` treats specially; both optional. */
export interface GameMasks {
  /** The game's map areas mark the pixel as no man's land (sea, the map's edge): the final fill leaves it alone. */
  noMansLand?: Uint8Array;
  /** The pixel is void (highest surface below VOID_BELOW): never a biome. */
  void?: Uint8Array;
}

interface Tint { a: number; b: [number, number, number] }

function fitTint(wiki: Uint8Array, map: Uint8Array, n: number, samples: readonly [number, number][]): Tint {
  let idx: number[] = [];
  for (const [sx, sy] of samples) {
    for (let dy = -SAMPLE_RADIUS; dy <= SAMPLE_RADIUS; dy++) {
      for (let dx = -SAMPLE_RADIUS; dx <= SAMPLE_RADIUS; dx++) {
        const x = sx + dx, y = sy + dy;
        if (dx * dx + dy * dy <= SAMPLE_RADIUS * SAMPLE_RADIUS && x >= 0 && y >= 0 && x < n && y < n) idx.push(y * n + x);
      }
    }
  }
  let t: Tint = { a: 1, b: [0, 0, 0] };
  // Least squares with a shared A; four rounds, each dropping the worst fifth (labels, rivers, grid lines).
  for (let round = 0; round < 4; round++) {
    const mm = [0, 0, 0], mw = [0, 0, 0];
    for (const k of idx) for (let c = 0; c < 3; c++) { mm[c]! += map[k * 3 + c]!; mw[c]! += wiki[k * 3 + c]!; }
    for (let c = 0; c < 3; c++) { mm[c]! /= idx.length; mw[c]! /= idx.length; }
    let cov = 0, v = 0;
    for (const k of idx) {
      for (let c = 0; c < 3; c++) { const d = map[k * 3 + c]! - mm[c]!; cov += d * (wiki[k * 3 + c]! - mw[c]!); v += d * d; }
    }
    const a = v > 0 ? Math.max(0, Math.min(1, cov / v)) : 0;
    t = { a, b: [mw[0]! - a * mm[0]!, mw[1]! - a * mm[1]!, mw[2]! - a * mm[2]!] };
    const ranked = idx.map(k => [k, tintError(t, wiki, map, k)] as const).sort((p, q) => p[1] - q[1]);
    idx = ranked.slice(0, Math.floor(ranked.length * 0.8)).map(r => r[0]);
  }
  return t;
}

function tintError(t: Tint, wiki: Uint8Array, map: Uint8Array, k: number): number {
  let e = 0;
  for (let c = 0; c < 3; c++) { const d = wiki[k * 3 + c]! - (t.a * map[k * 3 + c]! + t.b[c]!); e += d * d; }
  return e;
}

/** Water on the in-game map: blue to teal, clearly bluer than the beige and grey land. */
function isWater(map: Uint8Array, k: number): boolean {
  const r = map[k * 3]!, g = map[k * 3 + 1]!, b = map[k * 3 + 2]!;
  return b > r + 15 && g > r + 10;
}
/**
 * Outside the map: the black void and its grey glow along the south and east coasts. Both are dark neutral grey,
 * while the map's land is tinted warm (beige, brown, light grey with red over blue) or bright (snow, structures).
 */
function isVoid(map: Uint8Array, k: number): boolean {
  const r = map[k * 3]!, g = map[k * 3 + 1]!, b = map[k * 3 + 2]!;
  return Math.max(r, g, b) < 110 && Math.max(r, g, b) - Math.min(r, g, b) < 7;
}
/** Thin water (rivers, about 2 x this many pixels wide) does not carry the sea inland. */
const RIVER_CUT = 6;

/**
 * Land on the in-game map: everything but the open sea and the black void around the map. The open sea is the
 * water connected to the image's edge; to keep rivers from carrying it inland, the water is shrunk by RIVER_CUT
 * pixels first, flooded from the edge, and grown back within the water. Lakes and rivers inland are land, so the
 * biome around them covers them. (Height does not tell land from sea here: much of the south lies lower than
 * the seabed off the coasts.)
 */
export function landMask(map: Uint8Array, n: number): Uint8Array {
  const water = new Uint8Array(n * n);
  for (let k = 0; k < n * n; k++) water[k] = isWater(map, k) ? 1 : 0;
  // core: water with no land within RIVER_CUT (square window, via row and column distance passes)
  const core = erode(water, n, RIVER_CUT);
  const sea = new Uint8Array(n * n);
  const queue = new Int32Array(n * n);
  let head = 0, tail = 0;
  const push = (k: number) => { if (core[k] && !sea[k]) { sea[k] = 1; queue[tail++] = k; } };
  // seeds: the band along the edge (the map image has a dark frame of a few pixels)
  const band = RIVER_CUT + 6;
  for (let d = 0; d < band; d++) {
    for (let i = 0; i < n; i++) { push(d * n + i); push((n - 1 - d) * n + i); push(i * n + d); push(i * n + n - 1 - d); }
  }
  while (head < tail) {
    const k = queue[head++]!, x = k % n, y = (k - x) / n;
    if (x > 0) push(k - 1); if (x < n - 1) push(k + 1); if (y > 0) push(k - n); if (y < n - 1) push(k + n);
  }
  // grow the sea back over the water it was shrunk from
  const grown = dilate(sea, n, RIVER_CUT);
  const land = new Uint8Array(n * n);
  for (let k = 0; k < n * n; k++) {
    const voidPx = isVoid(map, k);
    land[k] = !voidPx && !(grown[k] && water[k]) ? 1 : 0;
  }
  return land;
}

/** Square-window erosion / dilation (Chebyshev distance r) of a 0/1 mask, separable. */
function erode(m: Uint8Array, n: number, r: number): Uint8Array { return morph(m, n, r, false); }
function dilate(m: Uint8Array, n: number, r: number): Uint8Array { return morph(m, n, r, true); }
function morph(m: Uint8Array, n: number, r: number, grow: boolean): Uint8Array {
  const pass = (src: Uint8Array, horizontal: boolean) => {
    const dst = new Uint8Array(n * n);
    for (let a = 0; a < n; a++) {
      // running count of set pixels in the window along the line
      let count = 0;
      const at = (b: number) => (horizontal ? a * n + b : b * n + a);
      for (let b = 0; b <= r && b < n; b++) count += src[at(b)]!;
      for (let b = 0; b < n; b++) {
        const lo = Math.max(0, b - r), hi = Math.min(n - 1, b + r), size = hi - lo + 1;
        dst[at(b)] = grow ? (count > 0 ? 1 : 0) : (count === size ? 1 : 0);
        if (b - r >= 0) count -= src[at(b - r)]!;
        if (b + r + 1 < n) count += src[at(b + r + 1)]!;
      }
    }
    return dst;
  };
  return pass(pass(m, true), false);
}

/** Gives every `land` pixel without a biome the biome of the nearest biome pixel (breadth-first over `land`). */
function fillLand(index: Uint8Array, land: Uint8Array, n: number): void {
  const queue = new Int32Array(n * n);
  let head = 0, tail = 0;
  for (let k = 0; k < n * n; k++) if (index[k] !== NONE) queue[tail++] = k;
  while (head < tail) {
    const k = queue[head++]!, x = k % n, y = (k - x) / n, v = index[k]!;
    for (const q of [x > 0 ? k - 1 : -1, x < n - 1 ? k + 1 : -1, y > 0 ? k - n : -1, y < n - 1 ? k + n : -1]) {
      if (q >= 0 && land[q] && index[q] === NONE) { index[q] = v; queue[tail++] = q; }
    }
  }
}

/**
 * The biome index per pixel (NONE for none). `wiki` and `map` are RGB, n x n, over the same square. Biomes only
 * on land (`landMask`), so the grey glow along the coasts cannot pass for Abyss Cliffs; at the end every land
 * pixel left without a biome (labels, grid lines, lakes) gets the nearest biome over land, except on the game's
 * no man's land (`masks.noMansLand`), so coasts, channels and islands the wiki leaves without a biome stay so.
 * Void pixels (`masks.void`) are neither filled nor kept.
 */
export function classifyWikiMap(
  wiki: Uint8Array, map: Uint8Array, n: number, biomes: readonly WikiBiome[], masks: GameMasks = {},
): { index: Uint8Array; tints: Tint[] } {
  const tints = biomes.map(b => fitTint(wiki, map, n, b.samples));
  const land = landMask(map, n);
  let index: Uint8Array = new Uint8Array(n * n);
  for (let k = 0; k < n * n; k++) {
    if (!land[k]) { index[k] = NONE; continue; }
    let best = NONE, bestE = 0;
    for (let c = 0; c < 3; c++) { const d = wiki[k * 3 + c]! - map[k * 3 + c]!; bestE += d * d; }
    for (let i = 0; i < tints.length; i++) {
      const e = tintError(tints[i]!, wiki, map, k);
      if (e < bestE) { bestE = e; best = i; }
    }
    index[k] = best;
  }
  for (let p = 0; p < MODE_PASSES; p++) index = modeFilter(index, n, biomes.length);
  dropSmallPieces(index, n);
  dropFarPieces(index, n, biomes);
  // The fill does not reach the game's no man's land: what the tints leave there (untinted coasts, channels and lakes,
  // the grey islands east of Swamp) stays without a biome.
  const fillable = new Uint8Array(n * n);
  for (let k = 0; k < n * n; k++) fillable[k] = land[k] && !masks.noMansLand?.[k] && !masks.void?.[k] ? 1 : 0;
  fillLand(index, fillable, n);
  if (masks.void) for (let k = 0; k < n * n; k++) if (masks.void[k]) index[k] = NONE;
  return { index, tints };
}

/** Majority of the MODE_WINDOW x MODE_WINDOW window (NONE counts as a class too); ties keep the pixel. */
function modeFilter(src: Uint8Array, n: number, classes: number): Uint8Array {
  const dst = new Uint8Array(src.length);
  const r = (MODE_WINDOW - 1) / 2;
  const count = new Int32Array(classes + 1);
  const slot = (v: number) => (v === NONE ? classes : v);
  for (let y = 0; y < n; y++) {
    count.fill(0);
    // running window along the row
    for (let dy = -r; dy <= r; dy++) {
      const yy = y + dy;
      if (yy < 0 || yy >= n) continue;
      for (let dx = -r; dx <= r; dx++) if (dx >= 0 && dx < n) count[slot(src[yy * n + dx]!)]!++;
    }
    for (let x = 0; x < n; x++) {
      if (x > 0) {
        const out = x - r - 1, inn = x + r;
        for (let dy = -r; dy <= r; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= n) continue;
          if (out >= 0) count[slot(src[yy * n + out]!)]!--;
          if (inn < n) count[slot(src[yy * n + inn]!)]!++;
        }
      }
      const own = slot(src[y * n + x]!);
      let best = own;
      for (let c = 0; c <= classes; c++) if (count[c]! > count[best]!) best = c;
      dst[y * n + x] = best === classes ? NONE : best;
    }
  }
  return dst;
}

/** Labels the 4-connected pieces: piece id per pixel (-1 for NONE) and each piece's class and size. */
function pieces(index: Uint8Array, n: number): { id: Int32Array; cls: number[]; size: number[] } {
  const id = new Int32Array(n * n).fill(-1);
  const cls: number[] = [], size: number[] = [];
  const queue = new Int32Array(n * n);
  for (let k = 0; k < n * n; k++) {
    if (id[k] !== -1 || index[k] === NONE) continue;
    const v = index[k]!, pid = cls.length;
    let head = 0, tail = 0;
    queue[tail++] = k; id[k] = pid;
    while (head < tail) {
      const p = queue[head++]!, x = p % n, y = (p - x) / n;
      for (const q of [x > 0 ? p - 1 : -1, x < n - 1 ? p + 1 : -1, y > 0 ? p - n : -1, y < n - 1 ? p + n : -1]) {
        if (q >= 0 && id[q] === -1 && index[q] === v) { id[q] = pid; queue[tail++] = q; }
      }
    }
    cls.push(v); size.push(tail);
  }
  return { id, cls, size };
}

/** Sets the pieces of each biome that lie farther than ANCHOR_REACH from its anchors (see there) to NONE. */
function dropFarPieces(index: Uint8Array, n: number, biomes: readonly WikiBiome[]): void {
  const { id, cls, size } = pieces(index, n);
  const dist = new Int32Array(n * n);
  const queue = new Int32Array(n * n);
  for (let b = 0; b < biomes.length; b++) {
    const anchors = new Set<number>();
    let largest = -1;
    for (let p = 0; p < cls.length; p++) if (cls[p] === b && (largest < 0 || size[p]! > size[largest]!)) largest = p;
    if (largest >= 0) anchors.add(largest);
    for (const [x, y] of biomes[b]!.samples) { const p = id[y * n + x]!; if (p >= 0 && cls[p] === b) anchors.add(p); }
    // breadth-first from the anchor pieces over every pixel, up to ANCHOR_REACH steps
    dist.fill(-1);
    let head = 0, tail = 0;
    for (let k = 0; k < n * n; k++) if (anchors.has(id[k]!)) { dist[k] = 0; queue[tail++] = k; }
    const reached = new Set<number>(anchors);
    while (head < tail) {
      const p = queue[head++]!, d = dist[p]!;
      if (d >= ANCHOR_REACH) continue;
      const x = p % n, y = (p - x) / n;
      for (const q of [x > 0 ? p - 1 : -1, x < n - 1 ? p + 1 : -1, y > 0 ? p - n : -1, y < n - 1 ? p + n : -1]) {
        if (q < 0 || dist[q] !== -1) continue;
        dist[q] = d + 1; queue[tail++] = q;
        const pq = id[q]!;
        if (pq >= 0 && cls[pq] === b) reached.add(pq);
      }
    }
    for (let k = 0; k < n * n; k++) { const p = id[k]!; if (p >= 0 && cls[p] === b && !reached.has(p)) index[k] = NONE; }
  }
}

/**
 * The game masks at the wiki image's size (n x n), sampled at each pixel's centre. The game's map areas
 * (`--map-areas-out`) and height grid (`--heightmap-out`) cover the same map square as the image.
 */
export function gameMasks(
  n: number, areas: { width: number; height: number; index: Uint8Array; noMansLand: ReadonlySet<number> },
  heights: { width: number; height: number; top: Float32Array },
): Required<GameMasks> {
  const noMansLand = new Uint8Array(n * n), voidMask = new Uint8Array(n * n);
  for (let y = 0; y < n; y++) {
    const ay = Math.floor(((y + 0.5) * areas.height) / n), hy = Math.floor(((y + 0.5) * heights.height) / n);
    for (let x = 0; x < n; x++) {
      const ax = Math.floor(((x + 0.5) * areas.width) / n), hx = Math.floor(((x + 0.5) * heights.width) / n);
      if (areas.noMansLand.has(areas.index[ay * areas.width + ax]!)) noMansLand[y * n + x] = 1;
      if (heights.top[hy * heights.width + hx]! < VOID_BELOW) voidMask[y * n + x] = 1; // NaN (no surface) is not void
    }
  }
  return { noMansLand, void: voidMask };
}

/** Sets 4-connected biome pieces smaller than MIN_PIECE to NONE. */
function dropSmallPieces(index: Uint8Array, n: number): void {
  const seen = new Uint8Array(n * n);
  const queue = new Int32Array(n * n);
  for (let k = 0; k < n * n; k++) {
    if (seen[k] || index[k] === NONE) continue;
    const v = index[k]!;
    let head = 0, tail = 0;
    queue[tail++] = k; seen[k] = 1;
    while (head < tail) {
      const p = queue[head++]!, x = p % n, y = (p - x) / n;
      for (const q of [x > 0 ? p - 1 : -1, x < n - 1 ? p + 1 : -1, y > 0 ? p - n : -1, y < n - 1 ? p + n : -1]) {
        if (q >= 0 && !seen[q] && index[q] === v) { seen[q] = 1; queue[tail++] = q; }
      }
    }
    if (tail < MIN_PIECE) for (let i = 0; i < tail; i++) index[queue[i]!] = NONE;
  }
}

function main() {
  const { values: v } = parseArgs({
    options: {
      // Raw RGB (n x n x 3 bytes) of the wiki biome map and of the in-game map at the same size; see the README for
      // how to make them (any image tool; the map from the extractor's tiles).
      'wiki-rgb': { type: 'string' }, 'map-rgb': { type: 'string' }, size: { type: 'string', default: '5000' },
      // biome list with samples (JSON array of WikiBiome) and the output directory
      biomes: { type: 'string' }, out: { type: 'string' },
      // the extractor's map areas (--map-areas-out) and height grid (--heightmap-out) for the game masks
      'map-areas': { type: 'string' }, heightmap: { type: 'string' },
    },
  });
  if (!v['wiki-rgb'] || !v['map-rgb'] || !v.biomes || !v.out || !v['map-areas'] || !v.heightmap) {
    throw new Error('usage: tsx scripts/wiki-biomes.ts --wiki-rgb <file> --map-rgb <file> [--size 5000] --biomes <biomes.json> --map-areas <dir> --heightmap <dir> --out <dir>');
  }
  const n = Number(v.size);
  const wiki = new Uint8Array(readFileSync(resolve(v['wiki-rgb'])));
  const map = new Uint8Array(readFileSync(resolve(v['map-rgb'])));
  if (wiki.length !== n * n * 3 || map.length !== n * n * 3) throw new Error(`expected ${n * n * 3} bytes of RGB each`);
  const biomes = JSON.parse(readFileSync(resolve(v.biomes), 'utf8')) as WikiBiome[];
  const areas = readMapAreas(resolve(v['map-areas']));
  const heights = readHeightGrid(resolve(v.heightmap));
  if (!areas || !heights) throw new Error('no map areas (areas.json, areas.u8) or height grid (heightmap.json, top.f32) there');
  const noMansLand = new Set(areas.areas.filter(a => a.class === 'Area_NoMansLand_1_C' || a.nameKey === 'Locations/NoMansLand').map(a => a.index));
  const masks = gameMasks(n, { ...areas, noMansLand }, { ...heights.meta, top: heights.top });
  const { index, tints } = classifyWikiMap(wiki, map, n, biomes, masks);
  const square = 750000; // the map square (cm), for the areas printed below
  const out = resolve(v.out);
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'areas.u8'), index);
  const counts = new Map<number, number>();
  for (const c of index) counts.set(c, (counts.get(c) ?? 0) + 1);
  writeFileSync(join(out, 'areas.json'), JSON.stringify({
    width: n, height: n, source: 'satisfactory.wiki.gg File:Biome_Map.jpg',
    areas: biomes.map((b, i) => ({ index: i, class: `Wiki_${b.name.replace(/\W+/g, '')}`, name: b.name, nameDe: b.nameDe ?? null })),
  }, null, 1));
  biomes.forEach((b, i) => console.log(`${b.name.padEnd(20)} tint alpha ${(1 - tints[i]!.a).toFixed(2)}, ${((counts.get(i) ?? 0) * (square / n / 100) ** 2 / 1e6).toFixed(2)} km²`));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
