import { readFileSync } from 'node:fs';
import { cleanElements, type RawCaveElement, type RawCaves } from '../src/shared/caves.js';
import type { CaveLayer, CaveGeometryIndex } from './cave-geometry.js';

/**
 * Caves from hand-drawn outlines (the maintainer data `<data-src>/caves/scim-caves.json`, see data-src/extractor/
 * README.md, "Caves"), merged with what the game geometry says: the outlines and entrances come from the file; the
 * entrances' heights, the 3D model each cave lies in and whether an item lies in a cave come from the game data
 * (`sampleCaves`, the cave volumes, the landscape). Sampled caves that no outline overlaps are kept as they are.
 */

/** One cave of the outline file: `outline` and `holes` as [x, y] (UE cm), entrances as lines of [x, y] or [x, y, z]. */
export interface OutlineCave { id: number; outline: number[][]; holes?: number[][][]; entrances: number[][][] }

/** A volume group of the extractor's cave geometry (`cave-geometry/index.json` with its volumes' elements). */
export interface GeometryCave { id: string; min: number[]; max: number[]; elements: RawCaveElement[] }

/** A cave of the merged layer. `n` is its number on the map; `model` the geometry cave (3D model) it lies in. */
export interface MergedCave {
  id: string;
  n: number;
  model?: string;
  rings: number[][][];
  entrances: { x: number; y: number; z: number }[];
}

/** Items this close (cm) outside a hand-drawn outline still count as inside it. */
const OUTLINE_EDGE = 1000;
/** Grid step (cm) for comparing areas. */
const AREA_STEP = 500;

const isPoint = (p: unknown) => Array.isArray(p) && (p.length === 2 || p.length === 3) && p.every(v => typeof v === 'number' && Number.isFinite(v));
const isRing = (r: unknown, min: number) => Array.isArray(r) && r.length >= min && r.every(isPoint);

/** The caves of the outline file; throws on a malformed file, cave or duplicate id. */
export function readOutlineCaves(raw: unknown): OutlineCave[] {
  const list = (raw as { caves?: unknown } | null)?.caves;
  if (!Array.isArray(list)) throw new Error('Cave outlines: no "caves" list');
  const seen = new Set<number>();
  return list.map((c: { id?: unknown; outline?: unknown; holes?: unknown; entrances?: unknown }) => {
    if (typeof c?.id !== 'number' || !Number.isInteger(c.id) || c.id <= 0) throw new Error(`Cave outlines: bad id ${JSON.stringify(c?.id)}`);
    if (seen.has(c.id)) throw new Error(`Cave outlines: cave ${c.id} twice`);
    seen.add(c.id);
    if (!isRing(c.outline, 3)) throw new Error(`Cave outlines: cave ${c.id} needs an outline of at least 3 points`);
    if (c.holes !== undefined && !(Array.isArray(c.holes) && c.holes.every(h => isRing(h, 3)))) throw new Error(`Cave outlines: cave ${c.id} has a bad hole`);
    if (!Array.isArray(c.entrances) || !c.entrances.every(e => isRing(e, 2))) throw new Error(`Cave outlines: cave ${c.id} has a bad entrance`);
    return {
      id: c.id, outline: c.outline as number[][],
      ...(c.holes ? { holes: c.holes as number[][][] } : {}),
      entrances: c.entrances as number[][][],
    };
  });
}

/**
 * The point of an entrance line: halfway along it; a closed line (an area around the mouth) at the mean of its
 * corners. `z` where the line has heights.
 */
export function entrancePoint(line: readonly number[][]): { x: number; y: number; z?: number } {
  const first = line[0]!, last = line[line.length - 1]!;
  const withZ = line.every(p => p.length === 3);
  if (line.length > 3 && first[0] === last[0] && first[1] === last[1]) {
    const corners = line.slice(0, -1);
    const mean = (k: number) => corners.reduce((s, p) => s + p[k]!, 0) / corners.length;
    return { x: mean(0), y: mean(1), ...(withZ ? { z: mean(2) } : {}) };
  }
  const lengths = line.slice(1).map((p, k) => Math.hypot(p[0]! - line[k]![0]!, p[1]! - line[k]![1]!));
  let rest = lengths.reduce((a, b) => a + b, 0) / 2;
  for (let k = 0; k < lengths.length; k++) {
    if (rest <= lengths[k]! || k === lengths.length - 1) {
      const t = lengths[k]! === 0 ? 0 : Math.min(1, rest / lengths[k]!);
      const a = line[k]!, b = line[k + 1]!;
      const at = (i: number) => a[i]! + t * (b[i]! - a[i]!);
      return { x: at(0), y: at(1), ...(withZ ? { z: at(2) } : {}) };
    }
    rest -= lengths[k]!;
  }
  return { x: first[0]!, y: first[1]!, ...(withZ ? { z: first[2]! } : {}) };
}

/** The entrance points of all caves, in file order, with the drawn height where there is one (the probes for `sampleCaves`). */
export function outlineEntrancePoints(caves: readonly OutlineCave[]): { x: number; y: number; z?: number }[] {
  return caves.flatMap(c => c.entrances.map(e => entrancePoint(e)));
}

/** Even-odd over all rings (an outline and its holes). */
export function inRings(x: number, y: number, rings: readonly (readonly number[][])[]): boolean {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i]!, [xj, yj] = ring[j]!;
      if (yi! > y !== yj! > y && x < ((xj! - xi!) * (y - yi!)) / (yj! - yi!) + xi!) inside = !inside;
    }
  }
  return inside;
}

function distanceToRing(x: number, y: number, ring: readonly number[][]): number {
  let best = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, ay] = ring[j]!, [bx, by] = ring[i]!;
    const dx = bx! - ax!, dy = by! - ay!;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax!) * dx + (y - ay!) * dy) / len2));
    best = Math.min(best, Math.hypot(x - (ax! + t * dx), y - (ay! + t * dy)));
  }
  return best;
}

/** Grid points (AREA_STEP) inside the rings; at least one point (the first corner) for tiny shapes. */
function areaPoints(rings: readonly (readonly number[][])[]): [number, number][] {
  const outer = rings[0]!;
  const xs = outer.map(p => p[0]!), ys = outer.map(p => p[1]!);
  const pts: [number, number][] = [];
  for (let x = Math.min(...xs) + AREA_STEP / 2; x < Math.max(...xs); x += AREA_STEP) {
    for (let y = Math.min(...ys) + AREA_STEP / 2; y < Math.max(...ys); y += AREA_STEP) {
      if (inRings(x, y, rings)) pts.push([x, y]);
    }
  }
  if (pts.length === 0) pts.push([outer[0]![0]!, outer[0]![1]!]);
  return pts;
}

/** The geometry cave whose volumes cover most of the rings, else whose box holds most of them; undefined if none. */
function modelOf(rings: readonly (readonly number[][])[], geometry: readonly GeometryCave[]): string | undefined {
  const pts = areaPoints(rings);
  const best = (score: (g: GeometryCave, x: number, y: number) => boolean) => {
    let id: string | undefined, top = 0;
    for (const g of geometry) {
      const n = pts.filter(([x, y]) => score(g, x, y)).length;
      if (n > top) { top = n; id = g.id; }
    }
    return id;
  };
  return best((g, x, y) => g.elements.some(e => inRings(x, y, [e.hull])))
    ?? best((g, x, y) => x >= g.min[0]! && x <= g.max[0]! && y >= g.min[1]! && y <= g.max[1]!);
}

export interface MergeInput {
  outlines: readonly OutlineCave[];
  /** `sampleCaves` run with `outlineEntrancePoints(outlines)` as probes. */
  sampled: CaveLayer;
  geometry: readonly GeometryCave[];
  items: readonly { name: string; x: number; y: number }[];
  /** The landscape's height at a point (cm), the last fallback for an entrance's height. */
  landscapeZ: (x: number, y: number) => number | null;
}

export interface MergeResult {
  caves: MergedCave[];
  /** Sampled caves no outline overlaps, kept with their own shape (ids). */
  geometryOnly: string[];
  itemsInCaves: Set<string>;
}

/**
 * The merged cave layer: per outline cave `sc-NNN` (its id in the file, also its number `n`) with its outline and holes
 * and its entrances, each at the height of the floor the geometry has there (`sampled.probeZ`, chosen with the
 * height the file gives where it has one), else the height the file gives, else the landscape; then every sampled cave whose area meets no outline, with its own id and shape,
 * numbered after the highest outline id. `model` is the geometry cave (its 3D model) the cave lies in.
 * An item lies in a cave when the sampling's cave test says so (a cave floor under it with a rock ceiling: the game
 * geometry, not the sampled outline, decides; the hand-drawn outlines miss some parts of caves, in 1.2.5.0 seven
 * tracked collectibles up to 110 m from the nearest outline), or when it lies deep underground (`isUnderground`) inside
 * an outline (or within OUTLINE_EDGE of it, they are drawn by hand): caves outside the game's cave volumes, which
 * the sampling does not see.
 */
export function mergeOutlineCaves({ outlines, sampled, geometry, items, landscapeZ }: MergeInput): MergeResult {
  const caves: MergedCave[] = [];
  let probe = 0;
  for (const c of outlines) {
    const rings = [c.outline.map(p => [p[0]!, p[1]!]), ...(c.holes ?? []).map(h => h.map(p => [p[0]!, p[1]!]))];
    const entrances = c.entrances.map(line => {
      const p = entrancePoint(line);
      const z = sampled.probeZ[probe++] ?? p.z ?? landscapeZ(p.x, p.y) ?? 0;
      return { x: p.x, y: p.y, z };
    });
    const model = modelOf(rings, geometry);
    caves.push({ id: `sc-${String(c.id).padStart(3, '0')}`, n: c.id, ...(model ? { model } : {}), rings, entrances });
  }
  const outlineRings = caves.map(c => c.rings);
  const geometryOnly = sampled.caves.filter(s => !areaPoints(s.rings).some(([x, y]) => outlineRings.some(r => inRings(x, y, r))));
  let n = Math.max(0, ...outlines.map(c => c.id));
  for (const s of geometryOnly) caves.push({ id: s.id, n: ++n, model: s.id, rings: s.rings, entrances: s.entrances });

  const itemsInCaves = new Set<string>();
  for (const item of items) {
    if (sampled.itemsInCaves.has(item.name)) { itemsInCaves.add(item.name); continue; }
    if (!sampled.underground.has(item.name)) continue;
    const inside = caves.some(c => inRings(item.x, item.y, c.rings)
      || (!c.rings.slice(1).some(h => inRings(item.x, item.y, [h])) && distanceToRing(item.x, item.y, c.rings[0]!) <= OUTLINE_EDGE));
    if (inside) itemsInCaves.add(item.name);
  }
  return { caves, geometryOnly: geometryOnly.map(s => s.id), itemsInCaves };
}

/** The volume groups of the extractor's cave geometry with their (cleaned) volume elements. */
export function readGeometryCaves(geometryDir: string, volumes: RawCaves): GeometryCave[] {
  const index = JSON.parse(readFileSync(`${geometryDir}/index.json`, 'utf8')) as CaveGeometryIndex & { caves: { min: number[]; max: number[] }[] };
  const byName = new Map(volumes.volumes.map(v => [v.name, v]));
  return index.caves.map(c => ({ id: c.id, min: c.min, max: c.max, elements: c.volumes.flatMap(n => cleanElements(byName.get(n)?.elements ?? [])) }));
}
