import { footprintRect, type BuildingEntry, type BuildingIndex, type FootprintBox } from '../../../../shared/buildings.js';
import type {
  FactorySnapshot, SnapshotBuilding, SnapshotMarker, SnapshotStation, SnapshotVehicle,
} from '../../../../shared/factory/snapshot.js';
import type { WorldBounds } from '../../../../shared/types.js';
import {
  analyzeRoutes, reasonsOf, type Band, type FactoryAnalysis, type Reason, type RouteAnalysis, type StationFlow, type VehicleFlow,
} from '../../../../shared/factory/analysis.js';
import { lineStyle, machineBand, mapKind, productivityOf, type LineStyle, type MapKind } from './style.js';

/**
 * A snapshot prepared for drawing: every position in map units (the 256-unit zoom-0 image, x east, y south), every
 * footprint as corner points, the lines as flat point arrays, and a grid for hit tests. Built once per snapshot and
 * dataset (`sceneOf` caches it), so a frame only transforms and fills.
 */

/** A local rectangle in the actor's frame (cm). */
export interface LocalRect { minX: number; minY: number; maxX: number; maxY: number }

/** Without a footprint in the dataset a building is a 1 m square, a floor piece 8 m. */
const FALLBACK_BUILDING: LocalRect = { minX: -50, minY: -50, maxX: 50, maxY: 50 };
const FALLBACK_FLOOR: LocalRect = { minX: -400, minY: -400, maxX: 400, maxY: 400 };

export interface MapTransform {
  /** World cm → map units. */
  x(wx: number): number;
  y(wy: number): number;
  /** Map units per cm along x and y. */
  sx: number;
  sy: number;
  bounds: WorldBounds;
}

export function mapTransform(b: WorldBounds): MapTransform {
  const sx = 256 / (b.maxX - b.minX);
  const sy = 256 / (b.maxY - b.minY);
  return { x: wx => (wx - b.minX) * sx, y: wy => (wy - b.minY) * sy, sx, sy, bounds: b };
}

/**
 * The four corners of a local rectangle placed at (x, y) with `yawDeg` (0 = facing +x, positive turns +x towards +y),
 * in world cm, as x0, y0, … x3, y3 (counter-clockwise in the local frame).
 */
export function rectCorners(x: number, y: number, yawDeg: number, r: LocalRect): number[] {
  const a = (yawDeg * Math.PI) / 180;
  const c = Math.cos(a), s = Math.sin(a);
  const out: number[] = [];
  for (const [lx, ly] of [[r.minX, r.minY], [r.maxX, r.minY], [r.maxX, r.maxY], [r.minX, r.maxY]] as const) {
    out.push(x + lx * c - ly * s, y + lx * s + ly * c);
  }
  return out;
}

/** Corners from world cm to map units, in place. */
export function toMapUnits(pts: number[], t: MapTransform): number[] {
  for (let i = 0; i < pts.length; i += 2) {
    pts[i] = t.x(pts[i]!);
    pts[i + 1] = t.y(pts[i + 1]!);
  }
  return pts;
}

const boxRect = (b: FootprintBox): LocalRect => ({ minX: b.min[0], minY: b.min[1], maxX: b.max[0], maxY: b.max[1] });

/** The building body's boxes (not soft) and the soft ones; a footprint of only soft boxes counts them as the body. */
export function splitBoxes(entry: Pick<BuildingEntry, 'footprint'> | undefined): { hard: LocalRect[]; soft: LocalRect[] } {
  const all = entry?.footprint?.boxes ?? [];
  const hard = all.filter(b => !b.soft);
  if (hard.length === 0) return { hard: all.map(boxRect), soft: [] };
  return { hard: hard.map(boxRect), soft: all.filter(b => b.soft).map(boxRect) };
}

export interface SceneBuilding {
  b: SnapshotBuilding;
  entry: BuildingEntry | undefined;
  kind: MapKind;
  /** The productivity band of a machine (as the factory page has it); null for buildings without production. */
  band: Band | null;
  /** Why a machine is below full productivity, main reason first (the page's reasons). */
  reasons: Reason[];
  /** Paused by the player: a neutral state on the map, not a problem colour. */
  paused: boolean;
  /** The item it makes (its first output in the page's analysis: the recipe's main product, an extractor's resource). */
  product: string | undefined;
  cx: number;
  cy: number;
  /** The body's boxes, 8 numbers (4 corners) per box, map units. */
  hard: number[];
  /** Soft boxes, likewise. */
  soft: number[];
  /** The outline (bounding rectangle of the body), its 4 corners in map units, and the same rectangle locally. */
  outline: number[];
  local: LocalRect;
  /** Shorter and longer side of the outline in map units. */
  minSide: number;
  maxSide: number;
  /** Axis-aligned box of the outline, map units. */
  minX: number; minY: number; maxX: number; maxY: number;
  /**
   * Another building of about its size stands right above it (a stacked floor of smelters): close up the map draws it
   * inset and dimmed under the upper one and gives only the upper one a name (`stackUnder`).
   */
  under: boolean;
  /**
   * The body's vertical extent in world cm (`zMin` its foot, `zMax` its top): the hard boxes' heights (all boxes when it
   * has only soft ones; a lift from its foot to its top end), else just its base. The height range filter reads it.
   */
  zMin: number;
  zMax: number;
}

export interface SceneLine {
  id: string;
  cls: string;
  style: LineStyle;
  /** x, y per point, map units. */
  pts: Float32Array;
  minX: number; minY: number; maxX: number; maxY: number;
  /** Lowest and highest point in world cm (a polyline passes every height in between). */
  zMin: number;
  zMax: number;
}

export interface SceneStation {
  s: SnapshotStation;
  cx: number;
  cy: number;
  /** Its vehicles' throughput (`analyzeRoutes`, as on the factory page). */
  flow: StationFlow;
  /**
   * `idle`: no vehicle docks here; `empty`: vehicles dock but move nothing (empty runs); `active` otherwise. The page's
   * `StationFlow.problem` when the analysis has one.
   */
  state: 'idle' | 'empty' | 'active';
  /** In use but hardly anything moves (`StationFlow.problem` `lowThroughput`): a warning, not an outage. */
  low: boolean;
}

export interface SceneVehicle {
  v: SnapshotVehicle;
  flow: VehicleFlow;
  entry: BuildingEntry | undefined;
  cx: number;
  cy: number;
  /** Body outline corners in map units. */
  outline: number[];
}

export interface ScenePoint { cx: number; cy: number }

export interface Scene {
  snapshot: FactorySnapshot;
  t: MapTransform;
  buildings: SceneBuilding[];
  byId: Map<string, SceneBuilding>;
  /** Floor pieces (lightweight and actor foundations, ramps, walls), 8 numbers per piece, lowest first. */
  floor: Float32Array;
  /** Each floor piece's level in world cm, the surface one stands on (`floorLevel`), in the order of `floor`. */
  floorZ: Float32Array;
  lines: SceneLine[];
  /** Power lines: x1, y1, x2, y2 per line, map units. */
  power: Float32Array;
  /** Each power line's lower and upper end in world cm (zMin, zMax per line). */
  powerZ: Float32Array;
  stations: SceneStation[];
  stationById: Map<string, SceneStation>;
  vehicles: SceneVehicle[];
  vehicleById: Map<string, SceneVehicle>;
  markers: (ScenePoint & { m: SnapshotMarker })[];
  crates: (ScenePoint & { kind: string; z: number })[];
  /** Hit-test grid over the buildings (`GRID` map units per cell). */
  grid: Map<number, number[]>;
  /** The area with anything built, map units; null when empty. */
  extent: { minX: number; minY: number; maxX: number; maxY: number } | null;
}

/** Grid cell size for hit tests, map units (about 15 m in 1.2). */
export const GRID = 0.5;
const cellKey = (gx: number, gy: number) => (gx + 2048) * 8192 + (gy + 2048);

/** Lowest and highest z of a flat x, y, z point list (world cm). */
export function zRangeOf(xyz: ArrayLike<number>): { zMin: number; zMax: number } {
  let zMin = Infinity, zMax = -Infinity;
  for (let i = 2; i < xyz.length; i += 3) {
    const z = xyz[i]!;
    if (z < zMin) zMin = z;
    if (z > zMax) zMax = z;
  }
  return Number.isFinite(zMin) ? { zMin, zMax } : { zMin: 0, zMax: 0 };
}

export function bboxOf(pts: ArrayLike<number>): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < pts.length; i += 2) {
    const x = pts[i]!, y = pts[i + 1]!;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

/**
 * The vertical extent of a building in world cm: its body's boxes (`splitBoxes`' rule: the hard ones, else all), a
 * lift from its foot to its other end (`height`, up or down), else only its base.
 */
export function zExtent(b: Pick<SnapshotBuilding, 'z' | 'height'>, entry: Pick<BuildingEntry, 'footprint'> | undefined): { zMin: number; zMax: number } {
  if (b.height !== undefined && b.height !== 0) return { zMin: Math.min(b.z, b.z + b.height), zMax: Math.max(b.z, b.z + b.height) };
  const all = entry?.footprint?.boxes ?? [];
  const hard = all.filter(x => !x.soft);
  const boxes = hard.length > 0 ? hard : all;
  if (boxes.length === 0) return { zMin: b.z, zMax: b.z };
  let lo = Infinity, hi = -Infinity;
  for (const x of boxes) {
    if (x.min[2] < lo) lo = x.min[2];
    if (x.max[2] > hi) hi = x.max[2];
  }
  return { zMin: b.z + Math.min(lo, 0), zMax: b.z + Math.max(hi, 0) };
}

/**
 * The level of a floor piece in world cm, the surface one stands on: the top of a piece whose boxes are centred on its
 * origin (foundations, ramps: a 4 m foundation at z reaches from z - 2 m to z + 2 m, its machines stand at z + 2 m),
 * else its base (walls, railings and pillars stand on their origin).
 */
export function floorLevel(entry: Pick<BuildingEntry, 'footprint'> | undefined, z: number): number {
  const boxes = entry?.footprint?.boxes ?? [];
  if (boxes.length === 0) return z;
  let lo = Infinity, hi = -Infinity;
  for (const x of boxes) {
    if (x.min[2] < lo) lo = x.min[2];
    if (x.max[2] > hi) hi = x.max[2];
  }
  return lo < 0 ? z + hi : z;
}

/** A building placed on the map: its boxes, outline, kind and productivity. */
export function placeBuilding(b: SnapshotBuilding, entry: BuildingEntry | undefined, t: MapTransform, analysis?: FactoryAnalysis | null): SceneBuilding {
  const { hard, soft } = splitBoxes(entry);
  const local = footprintRect(entry ?? {}) ?? FALLBACK_BUILDING;
  const corners = (r: LocalRect) => toMapUnits(rectCorners(b.x, b.y, b.yaw, r), t);
  const outline = corners(local);
  const box = bboxOf(outline);
  const w = (local.maxX - local.minX) * t.sx, d = (local.maxY - local.minY) * t.sy;
  return {
    b, entry,
    kind: mapKind(entry?.category),
    band: analysis?.byId.get(b.id)?.band ?? machineBand(b.prod),
    reasons: reasonsFor(b, analysis),
    paused: analysis?.byId.get(b.id)?.paused ?? b.prod?.paused === true,
    product: analysis?.byId.get(b.id)?.outputs[0]?.item,
    cx: t.x(b.x), cy: t.y(b.y),
    hard: (hard.length > 0 ? hard : [local]).flatMap(corners),
    soft: soft.flatMap(corners),
    outline, local,
    minSide: Math.min(w, d), maxSide: Math.max(w, d),
    ...box,
    under: false,
    ...zExtent(b, entry),
  };
}

/** The local rectangle of a floor piece: its footprint, else its grid size, else 8 × 8 m. */
export function floorRect(entry: BuildingEntry | undefined): LocalRect {
  const fp = entry ? footprintRect(entry) : null;
  if (fp) return fp;
  const w = entry?.size?.w, d = entry?.size?.d;
  if (w && d) return { minX: -w / 2, minY: -d / 2, maxX: w / 2, maxY: d / 2 };
  return FALLBACK_FLOOR;
}

/** A machine's reasons: the analysis's (which knows extractors) when there is one, else from the save alone. */
function reasonsFor(b: SnapshotBuilding, analysis: FactoryAnalysis | null | undefined): Reason[] {
  if (!b.prod) return [];
  return analysis?.byId.get(b.id)?.reasons ?? reasonsOf(b.prod, productivityOf(b.prod));
}

/**
 * `analysis`: the snapshot's analysis when the dataset has recipes (refines the reasons of extractors); `routes`: the
 * page's route analysis (with stack sizes, so it knows how full vehicles are), else the map works it out without.
 */
export function buildScene(
  snapshot: FactorySnapshot, index: BuildingIndex, bounds: WorldBounds, analysis?: FactoryAnalysis | null, routeAnalysis?: RouteAnalysis | null,
): Scene {
  const t = mapTransform(bounds);
  const buildings: SceneBuilding[] = [];
  const floorPieces: { z: number; level: number; pts: number[] }[] = [];
  for (const l of snapshot.lightweight) {
    const entry = index.get(l.cls);
    const r = floorRect(entry);
    for (let i = 0; i + 3 < l.xyzYaw.length; i += 4) {
      const z = l.xyzYaw[i + 2]!;
      floorPieces.push({ z, level: floorLevel(entry, z), pts: toMapUnits(rectCorners(l.xyzYaw[i]!, l.xyzYaw[i + 1]!, l.xyzYaw[i + 3]!, r), t) });
    }
  }
  for (const b of snapshot.buildings) {
    const entry = index.get(b.cls);
    if (entry?.category === 'structure') {
      floorPieces.push({ z: b.z, level: floorLevel(entry, b.z), pts: toMapUnits(rectCorners(b.x, b.y, b.yaw, floorRect(entry)), t) });
      continue;
    }
    buildings.push(placeBuilding(b, entry, t, analysis));
  }
  // Lower buildings first, so what stands on top of them (a machine on an upper floor) is drawn over them.
  buildings.sort((a, b) => a.b.z - b.b.z);
  floorPieces.sort((a, b) => a.z - b.z);
  const floor = new Float32Array(floorPieces.length * 8);
  const floorZ = new Float32Array(floorPieces.length);
  floorPieces.forEach((p, i) => { floor.set(p.pts, i * 8); floorZ[i] = p.level; });

  const lines: SceneLine[] = [];
  for (const s of snapshot.splines) {
    const style = lineStyle(s.cls);
    if (!style || s.pts.length < 6) continue;
    const pts = new Float32Array((s.pts.length / 3) * 2);
    for (let i = 0, j = 0; i + 2 < s.pts.length; i += 3, j += 2) {
      pts[j] = t.x(s.pts[i]!);
      pts[j + 1] = t.y(s.pts[i + 1]!);
    }
    lines.push({ id: s.id, cls: s.cls, style, pts, ...bboxOf(pts), ...zRangeOf(s.pts) });
  }
  // Higher tiers on top.
  lines.sort((a, b) => a.style.tier - b.style.tier);

  const pl = snapshot.powerLines;
  const power = new Float32Array((pl.length / 6) * 4);
  const powerZ = new Float32Array((pl.length / 6) * 2);
  for (let i = 0, j = 0, k = 0; i + 5 < pl.length; i += 6, j += 4, k += 2) {
    power[j] = t.x(pl[i]!);
    power[j + 1] = t.y(pl[i + 1]!);
    power[j + 2] = t.x(pl[i + 3]!);
    power[j + 3] = t.y(pl[i + 4]!);
    powerZ[k] = Math.min(pl[i + 2]!, pl[i + 5]!);
    powerZ[k + 1] = Math.max(pl[i + 2]!, pl[i + 5]!);
  }

  const routes = routeAnalysis ?? analyzeRoutes(snapshot);
  const stations = snapshot.stations.map((s, i): SceneStation => {
    const flow = routes.stations[i]!;
    const problem = flow.problem !== undefined ? flow.problem : flow.visits.length === 0 ? 'noVehicles' : (flow.itemsPerMin ?? 0) <= 0 ? 'nothingMoved' : null;
    const state = problem === 'noVehicles' ? 'idle' : problem === 'nothingMoved' ? 'empty' : 'active';
    return { s, cx: t.x(s.x), cy: t.y(s.y), flow, state, low: state === 'active' && problem === 'lowThroughput' };
  });
  const vehicles = snapshot.vehicles.map((v, i): SceneVehicle => {
    const entry = index.get(v.cls);
    const local = footprintRect(entry ?? {}) ?? { minX: -300, minY: -150, maxX: 300, maxY: 150 };
    return { v, flow: routes.vehicles[i]!, entry, cx: t.x(v.x), cy: t.y(v.y), outline: toMapUnits(rectCorners(v.x, v.y, v.yaw, local), t) };
  });

  const grid = gridOf(buildings);
  stackUnder(buildings, grid, t);

  const all: number[] = [];
  for (const sb of buildings) all.push(sb.minX, sb.minY, sb.maxX, sb.maxY);
  for (let i = 0; i < floor.length; i++) all.push(floor[i]!);
  for (const l of lines) all.push(l.minX, l.minY, l.maxX, l.maxY);
  const extent = all.length > 0 ? bboxOf(all) : null;

  return {
    snapshot, t, buildings,
    byId: new Map(buildings.map(sb => [sb.b.id, sb])),
    floor, floorZ, lines, power, powerZ,
    stations, stationById: new Map(stations.map(s => [s.s.id, s])),
    vehicles, vehicleById: new Map(vehicles.map(v => [v.v.id, v])),
    markers: snapshot.markers.map(m => ({ m, cx: t.x(m.x), cy: t.y(m.y) })),
    crates: snapshot.crates.map(c => ({ kind: c.kind, z: c.z, cx: t.x(c.x), cy: t.y(c.y) })),
    grid, extent,
  };
}

const cache = new WeakMap<FactorySnapshot, {
  index: BuildingIndex; bounds: WorldBounds; analysis: FactoryAnalysis | null; routes: RouteAnalysis | null; scene: Scene;
}>();

/** The scene of a snapshot, built once per snapshot, building index, bounds and analysis. */
export function sceneOf(
  snapshot: FactorySnapshot, index: BuildingIndex, bounds: WorldBounds, analysis: FactoryAnalysis | null = null, routes: RouteAnalysis | null = null,
): Scene {
  const hit = cache.get(snapshot);
  if (hit && hit.index === index && hit.bounds === bounds && hit.analysis === analysis && hit.routes === routes) return hit.scene;
  const scene = buildScene(snapshot, index, bounds, analysis, routes);
  cache.set(snapshot, { index, bounds, analysis, routes, scene });
  return scene;
}

/** The hit-test grid over buildings: per `GRID` cell the indexes of the buildings whose box touches it. */
export function gridOf(buildings: readonly SceneBuilding[]): Map<number, number[]> {
  const grid = new Map<number, number[]>();
  buildings.forEach((sb, i) => {
    for (let gx = Math.floor(sb.minX / GRID); gx <= Math.floor(sb.maxX / GRID); gx++) {
      for (let gy = Math.floor(sb.minY / GRID); gy <= Math.floor(sb.maxY / GRID); gy++) {
        const k = cellKey(gx, gy);
        const cell = grid.get(k);
        if (cell) cell.push(i);
        else grid.set(k, [i]);
      }
    }
  });
  return grid;
}

/** A building counts as standing on top of another when it is at least this much higher (cm; a floor is 4 m). */
const STACK_DZ = 250;

/**
 * Marks the buildings with another one of about their size right above them (`SceneBuilding.under`): the upper one's
 * centre lies in the lower one's outline (or the other way round), it is at least `STACK_DZ` higher, and its shorter
 * side is at least half as long. Logistics parts (poles, splitters, lifts) never count, neither below nor above.
 */
export function stackUnder(buildings: SceneBuilding[], grid: Map<number, number[]>, t: MapTransform): void {
  for (const sb of buildings) {
    if (sb.kind === 'logistics') continue;
    const cell = grid.get(cellKey(Math.floor(sb.cx / GRID), Math.floor(sb.cy / GRID))) ?? [];
    for (const j of cell) {
      const o = buildings[j]!;
      if (o === sb || o.kind === 'logistics' || o.b.z < sb.b.z + STACK_DZ || o.minSide < sb.minSide * 0.5) continue;
      if (insideOutline(sb, o.cx, o.cy, t) || insideOutline(o, sb.cx, sb.cy, t)) {
        sb.under = true;
        break;
      }
    }
  }
}

/** 2 machines, 1 other buildings, 0 logistics parts (poles, splitters, lifts, signs). */
function pickRank(sb: SceneBuilding): number {
  return sb.kind === 'logistics' ? 0 : sb.kind === 'building' ? 1 : 2;
}

/** Whether a map point lies in a building's outline, grown by `slack` map units on each side. */
export function insideOutline(sb: SceneBuilding, mx: number, my: number, t: MapTransform, slack = 0): boolean {
  // Back to the actor's frame: world cm relative to the building, rotated by -yaw.
  const dx = mx / t.sx + t.bounds.minX - sb.b.x;
  const dy = my / t.sy + t.bounds.minY - sb.b.y;
  const a = (sb.b.yaw * Math.PI) / 180;
  const c = Math.cos(a), s = Math.sin(a);
  const lx = dx * c + dy * s, ly = -dx * s + dy * c;
  const sl = slack / t.sx;
  return lx >= sb.local.minX - sl && lx <= sb.local.maxX + sl && ly >= sb.local.minY - sl && ly <= sb.local.maxY + sl;
}

/**
 * The building at a map point, as drawn on top: of all whose outline (grown by `slack` map units) holds the point,
 * machines before other buildings before logistics parts (the canvas's fill order), then the smallest, so a splitter
 * beside a storage container wins where they overlap, then the upper of two stacked ones. Null when none.
 */
export function pickBuilding(scene: Scene, mx: number, my: number, slack = 0): SceneBuilding | null {
  let best: SceneBuilding | null = null;
  let bestArea = Infinity;
  const seen = new Set<number>();
  const r = Math.max(slack, 0);
  for (let gx = Math.floor((mx - r) / GRID); gx <= Math.floor((mx + r) / GRID); gx++) {
    for (let gy = Math.floor((my - r) / GRID); gy <= Math.floor((my + r) / GRID); gy++) {
      for (const i of scene.grid.get(cellKey(gx, gy)) ?? []) {
        if (seen.has(i)) continue;
        seen.add(i);
        const sb = scene.buildings[i]!;
        if (!insideOutline(sb, mx, my, scene.t, slack)) continue;
        // Rank first (×1e6 outweighs any area in map units²), then the area; of two the same (a stacked floor of
        // the same machine) the upper one, which is drawn on top.
        const area = (2 - pickRank(sb)) * 1e6 + sb.minSide * sb.maxSide;
        if (area < bestArea - 1e-9 || (best && Math.abs(area - bestArea) <= 1e-9 && sb.b.z > best.b.z)) { best = sb; bestArea = area; }
      }
    }
  }
  return best;
}

/** The map-unit box around a set of ids (buildings, stations, vehicles), or null when none is in the scene. */
export function boundsOfIds(scene: Scene, ids: Iterable<string>): { minX: number; minY: number; maxX: number; maxY: number } | null {
  const pts: number[] = [];
  for (const id of ids) {
    const sb = scene.byId.get(id);
    if (sb) { pts.push(sb.minX, sb.minY, sb.maxX, sb.maxY); continue; }
    const v = scene.vehicleById.get(id);
    if (v) pts.push(v.cx, v.cy);
  }
  return pts.length > 0 ? bboxOf(pts) : null;
}
