import type { DiffOverlay } from './diff.js';
import { gridOf, stackUnder, type Scene, type SceneBuilding, type SceneLine } from './scene.js';

/**
 * The factory map's height range: only what lies within a chosen band of heights is drawn and picked, so a factory
 * built on several floors on top of each other can be read floor by floor. Pure; `filterScene` makes a scene of what
 * lies in the range (cached per scene and range), which the canvas, the hit tests and the production lines then use
 * unchanged.
 *
 * The rules (world cm; the range's ends are whole metres, widened by `TOLERANCE` each way; an end at the edge of the
 * snapshot's span is open, so the top floor keeps the belts above its machines' feet):
 * - a building counts when its body (`SceneBuilding.zMin`..`zMax`) overlaps the range: a machine standing on a floor in
 *   the range, and a tall one from below that reaches into it (a refinery through the floor above);
 * - a floor piece by its level (`Scene.floorZ`: a foundation's top surface, a wall's foot);
 * - belts, pipes, roads and power lines whole when any part of them lies in the range (a polyline passes every height
 *   between its lowest and highest point): a belt rising from one floor to the next shows on both, never cut off;
 * - stations by their building (else their base), vehicles, map markers and crates by their position.
 */

/** A chosen height range in whole metres, `lo` ≤ `hi`. */
export interface HeightRange { lo: number; hi: number }

/** How far each end of the range reaches beyond its whole metre, cm: floors a little off the metre still count. */
export const TOLERANCE = 50;

/** A floor needs at least this many foundations and buildings standing within 1 m of its level. */
export const FLOOR_MIN_COUNT = 10;

/**
 * The slider's span leaves out this share of the foundations and buildings at either end: a lone miner in a deep cave
 * or a sign on a mountain would squeeze every floor into a few pixels. They still show, as the span's ends are open.
 */
export const SPAN_TRIM = 0.005;

export interface HeightProfile {
  /**
   * The snapshot's span in whole metres: from the lowest to the highest metre where foundations and buildings stand,
   * without the outliers (`SPAN_TRIM`). An end of a range at the span's edge is open.
   */
  min: number;
  max: number;
  /** Foundations and buildings standing at each whole metre from `min` to `max` (index = metre - min). */
  counts: Uint32Array;
  /** Detected floor levels in whole metres, lowest first (`detectFloors`). */
  floors: number[];
}

/**
 * Floor levels from the counts per whole metre (`counts[i]` stands at metre `min + i`): a metre is a floor when it
 * holds more than the metre below and at least as many as the metre above (a level split over two metres counts once,
 * at the lower), and at least `FLOOR_MIN_COUNT` stand within 1 m of it. Floors are mostly 4 m or 8 m apart (a 4 m
 * foundation and a machine's height); two metres apart is the closest two floors can be told apart.
 */
export function detectFloors(counts: ArrayLike<number>, min: number, minCount = FLOOR_MIN_COUNT): number[] {
  const at = (i: number) => (i >= 0 && i < counts.length ? counts[i]! : 0);
  const out: number[] = [];
  for (let i = 0; i < counts.length; i++) {
    const c = at(i);
    if (c === 0 || c <= at(i - 1) || c < at(i + 1)) continue;
    if (at(i - 1) + c + at(i + 1) < minCount) continue;
    out.push(min + i);
  }
  return out;
}

const profileCache = new WeakMap<Scene, HeightProfile | null>();

/**
 * The profile of the levels where things stand (world cm): counts per whole metre, the span without `SPAN_TRIM` of
 * them at either end (at least 2 m), and the floors in it. Null without levels.
 */
export function profileOf(levels: ArrayLike<number>, trim = SPAN_TRIM): HeightProfile | null {
  if (levels.length === 0) return null;
  const all = new Map<number, number>();
  for (let i = 0; i < levels.length; i++) {
    const m = Math.round(levels[i]! / 100);
    all.set(m, (all.get(m) ?? 0) + 1);
  }
  const metres = [...all.keys()].sort((a, b) => a - b);
  const cut = Math.floor(levels.length * trim);
  let min = metres[0]!, max = metres[metres.length - 1]!;
  for (let i = 0, acc = 0; i < metres.length; i++) {
    acc += all.get(metres[i]!)!;
    if (acc > cut) { min = metres[i]!; break; }
  }
  for (let i = metres.length - 1, acc = 0; i >= 0; i--) {
    acc += all.get(metres[i]!)!;
    if (acc > cut) { max = metres[i]!; break; }
  }
  if (max - min < 2) { min -= 1; max = min + 2; }
  const counts = new Uint32Array(max - min + 1);
  for (const [m, n] of all) if (m >= min && m <= max) counts[m - min] = n;
  return { min, max, counts, floors: detectFloors(counts, min) };
}

/**
 * The scene's heights (`profileOf`): where its foundations stand (`Scene.floorZ`) and its buildings stand (their
 * base), the slider's span and histogram, and its floors. Logistics parts (belt attachments, poles, lifts) are not
 * counted: they stand at any height. Null for a scene without buildings. Made once per scene.
 */
export function heightProfile(scene: Scene): HeightProfile | null {
  if (profileCache.has(scene)) return profileCache.get(scene)!;
  let profile: HeightProfile | null = null;
  if (scene.buildings.length > 0) {
    const levels: number[] = [];
    for (const sb of scene.buildings) if (sb.kind !== 'logistics') levels.push(sb.b.z);
    for (let i = 0; i < scene.floorZ.length; i++) levels.push(scene.floorZ[i]!);
    // Only logistics parts: their bases make the span.
    if (levels.length === 0) for (const sb of scene.buildings) levels.push(sb.b.z);
    profile = profileOf(levels);
  }
  profileCache.set(scene, profile);
  return profile;
}

/** A range within the span, or null when it covers all of it (no filter). */
export function normalizeRange(r: HeightRange | null, p: HeightProfile): HeightRange | null {
  if (!r) return null;
  const lo = Math.max(p.min, Math.min(r.lo, r.hi)), hi = Math.min(p.max, Math.max(r.lo, r.hi));
  if (lo <= p.min && hi >= p.max) return null;
  return { lo, hi };
}

/** Whether a remembered range still says something for this span (it overlaps it). */
export function rangeFits(r: HeightRange, p: HeightProfile): boolean {
  return r.hi >= p.min && r.lo <= p.max;
}

/** The range's bounds in world cm with the tolerance; an end at the span's edge is open. */
export function rangeBounds(r: HeightRange, p: HeightProfile): { lo: number; hi: number } {
  return {
    lo: r.lo <= p.min ? -Infinity : r.lo * 100 - TOLERANCE,
    hi: r.hi >= p.max ? Infinity : r.hi * 100 + TOLERANCE,
  };
}

type Bounds = { lo: number; hi: number };

export const spanInside = (zMin: number, zMax: number, b: Bounds) => zMin <= b.hi && zMax >= b.lo;
export const pointInside = (z: number, b: Bounds) => z >= b.lo && z <= b.hi;
export const buildingInside = (sb: Pick<SceneBuilding, 'zMin' | 'zMax'>, b: Bounds) => spanInside(sb.zMin, sb.zMax, b);
export const lineInside = (l: Pick<SceneLine, 'zMin' | 'zMax'>, b: Bounds) => spanInside(l.zMin, l.zMax, b);

/** The scene of what passes `keep`; the buildings are copies, so their stacking (`under`) is worked out among them. */
function subScene(
  scene: Scene,
  keep: {
    building(sb: SceneBuilding): boolean; floor(z: number): boolean; line(l: SceneLine): boolean; span(zMin: number, zMax: number): boolean;
    point(z: number): boolean;
  },
): Scene {
  const buildings = scene.buildings.filter(keep.building).map(sb => ({ ...sb, under: false }));
  const n = scene.floorZ.length;
  let kept = 0;
  for (let i = 0; i < n; i++) if (keep.floor(scene.floorZ[i]!)) kept++;
  const floor = new Float32Array(kept * 8), floorZ = new Float32Array(kept);
  for (let i = 0, j = 0; i < n; i++) {
    if (!keep.floor(scene.floorZ[i]!)) continue;
    floor.set(scene.floor.subarray(i * 8, i * 8 + 8), j * 8);
    floorZ[j++] = scene.floorZ[i]!;
  }
  const power: number[] = [], powerZ: number[] = [];
  for (let i = 0, k = 0; k + 1 < scene.powerZ.length; i += 4, k += 2) {
    if (!keep.span(scene.powerZ[k]!, scene.powerZ[k + 1]!)) continue;
    power.push(scene.power[i]!, scene.power[i + 1]!, scene.power[i + 2]!, scene.power[i + 3]!);
    powerZ.push(scene.powerZ[k]!, scene.powerZ[k + 1]!);
  }
  const byId = new Map(buildings.map(sb => [sb.b.id, sb]));
  const stations = scene.stations.filter(st => {
    const sb = scene.byId.get(st.s.id);
    return sb ? keep.building(sb) : keep.point(st.s.z);
  });
  const vehicles = scene.vehicles.filter(v => keep.point(v.v.z));
  const crates = scene.crates.filter(c => keep.point(c.z));
  const grid = gridOf(buildings);
  stackUnder(buildings, grid, scene.t);
  return {
    snapshot: scene.snapshot, t: scene.t,
    buildings, byId,
    floor, floorZ,
    lines: scene.lines.filter(keep.line),
    power: new Float32Array(power), powerZ: new Float32Array(powerZ),
    stations, stationById: new Map(stations.map(s => [s.s.id, s])),
    vehicles, vehicleById: new Map(vehicles.map(v => [v.v.id, v])),
    markers: scene.markers.filter(m => keep.point(m.m.z)),
    crates, crateById: new Map(crates.map(c => [c.id, c])),
    grid,
    // Fits to "the whole factory" stay on the whole factory.
    extent: scene.extent,
  };
}

/** Filtered scenes per scene, the most recent few ranges (dragging the slider back and forth stays quick). */
const filterCache = new WeakMap<Scene, Map<string, Scene>>();
const FILTER_CACHE_SIZE = 6;

function cached(scene: Scene, key: string, make: () => Scene): Scene {
  let perScene = filterCache.get(scene);
  if (!perScene) filterCache.set(scene, (perScene = new Map()));
  const hit = perScene.get(key);
  if (hit) {
    // Most recent last.
    perScene.delete(key);
    perScene.set(key, hit);
    return hit;
  }
  const made = make();
  perScene.set(key, made);
  while (perScene.size > FILTER_CACHE_SIZE) perScene.delete(perScene.keys().next().value!);
  return made;
}

/**
 * The scene of what lies within the range (see the rules above), or the scene itself when the range covers the whole
 * span. Made once per scene and range.
 */
export function filterScene(scene: Scene, range: HeightRange | null, profile: HeightProfile | null): Scene {
  const r = profile ? normalizeRange(range, profile) : null;
  if (!r || !profile) return scene;
  const b = rangeBounds(r, profile);
  return cached(scene, `in:${r.lo}:${r.hi}`, () => subScene(scene, {
    building: sb => buildingInside(sb, b),
    floor: z => pointInside(z, b),
    line: l => lineInside(l, b),
    span: (zMin, zMax) => spanInside(zMin, zMax, b),
    point: z => pointInside(z, b),
  }));
}

/**
 * What lies wholly below the range ("Darunter blass zeigen": drawn as faint outlines for orientation), or null when the
 * range is open at the bottom. Made once per scene and range.
 */
export function belowScene(scene: Scene, range: HeightRange | null, profile: HeightProfile | null): Scene | null {
  const r = profile ? normalizeRange(range, profile) : null;
  if (!r || !profile) return null;
  const { lo } = rangeBounds(r, profile);
  if (lo === -Infinity) return null;
  return cached(scene, `below:${r.lo}`, () => subScene(scene, {
    building: sb => sb.zMax < lo,
    floor: z => z < lo,
    line: l => l.zMax < lo,
    span: (_, zMax) => zMax < lo,
    point: z => z < lo,
  }));
}

/** The changes' removed buildings and lines within the range (the rest of a diff refers to the scene by id). */
export function filterDiff(diff: DiffOverlay, range: HeightRange | null, profile: HeightProfile | null): DiffOverlay {
  const r = profile ? normalizeRange(range, profile) : null;
  if (!r || !profile) return diff;
  const b = rangeBounds(r, profile);
  return { ...diff, removed: diff.removed.filter(sb => buildingInside(sb, b)), linesRemoved: diff.linesRemoved.filter(l => lineInside(l, b)) };
}

/** Ids (buildings, stations, vehicles) of the whole scene that the filtered one leaves out. */
export function outsideIds(scene: Scene, shown: Scene, ids: Iterable<string>): string[] {
  if (shown === scene) return [];
  const out: string[] = [];
  for (const id of ids) {
    if (scene.byId.has(id) && !shown.byId.has(id)) out.push(id);
    else if (scene.vehicleById.has(id) && !shown.vehicleById.has(id)) out.push(id);
  }
  return out;
}

/**
 * The range widened so these ids are inside: down to the lowest one's foot (its floor shows with it) and up to the
 * highest one's foot. Null when that covers the whole span.
 */
export function widenTo(range: HeightRange, profile: HeightProfile, scene: Scene, ids: Iterable<string>): HeightRange | null {
  let lo = range.lo, hi = range.hi;
  for (const id of ids) {
    const sb = scene.byId.get(id);
    const z = sb ? sb.zMin : scene.vehicleById.get(id)?.v.z;
    if (z === undefined) continue;
    lo = Math.min(lo, Math.floor(z / 100));
    hi = Math.max(hi, Math.ceil(z / 100));
  }
  return normalizeRange({ lo, hi }, profile);
}

/**
 * Where PageUp and PageDown take a handle: the lower one to each floor's level, the upper one to just below the next
 * floor (the top of a floor: a range from a floor's level to its top is that floor), and both to the span's ends.
 */
export function floorStops(p: HeightProfile, handle: 'lo' | 'hi'): number[] {
  const set = new Set<number>([p.min, p.max]);
  p.floors.forEach((f, i) => {
    if (handle === 'lo') set.add(f);
    else if (i > 0) set.add(Math.max(p.floors[i - 1]!, f - 1));
  });
  if (handle === 'hi' && p.floors.length > 0) set.add(Math.max(p.min, p.floors[0]! - 1));
  return [...set].filter(v => v >= p.min && v <= p.max).sort((a, b) => a - b);
}

/** The next stop above (`dir` 1) or below (-1) a value, or the value itself when there is none. */
export function nextStop(stops: readonly number[], value: number, dir: 1 | -1): number {
  if (dir > 0) return stops.find(s => s > value) ?? value;
  for (let i = stops.length - 1; i >= 0; i--) if (stops[i]! < value) return stops[i]!;
  return value;
}
