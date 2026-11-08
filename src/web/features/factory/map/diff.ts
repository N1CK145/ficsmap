import type { BuildingIndex } from '../../../../shared/buildings.js';
import type { FactoryDiff } from '../../../../shared/factory/analysis.js';
import type { FactorySnapshot } from '../../../../shared/factory/snapshot.js';
import { floorRect, placeBuilding, rectCorners, toMapUnits, type MapTransform, type SceneBuilding, type SceneLine } from './scene.js';
import { lineStyle } from './style.js';

/**
 * What changed between two snapshots on the map. Buildings and productivity come from the factory page's
 * `diffFactory` (the same lists the page shows); the map adds what the page does not list: floor pieces (no ids, so
 * compared by class and position) and lines (belts, pipes, roads; by id).
 */
export interface GeometryDiff {
  floorAdded: FloorPiece[];
  floorRemoved: FloorPiece[];
  /** Line ids added in `after`, and the lines of `before` that are gone. */
  linesAdded: Set<string>;
  linesRemoved: FactorySnapshot['splines'];
}

export interface FloorPiece { cls: string; x: number; y: number; z: number; yaw: number }

export function diffGeometry(before: FactorySnapshot, after: FactorySnapshot): GeometryDiff {
  const pieces = (s: FactorySnapshot) => {
    const out = new Map<string, FloorPiece[]>();
    for (const l of s.lightweight) {
      for (let i = 0; i + 3 < l.xyzYaw.length; i += 4) {
        const p = { cls: l.cls, x: l.xyzYaw[i]!, y: l.xyzYaw[i + 1]!, z: l.xyzYaw[i + 2]!, yaw: l.xyzYaw[i + 3]! };
        const k = `${p.cls}|${Math.round(p.x)}|${Math.round(p.y)}|${Math.round(p.z)}`;
        (out.get(k) ?? out.set(k, []).get(k)!).push(p);
      }
    }
    return out;
  };
  const fb = pieces(before), fa = pieces(after);
  const floorAdded: FloorPiece[] = [], floorRemoved: FloorPiece[] = [];
  for (const [k, list] of fa) floorAdded.push(...list.slice(fb.get(k)?.length ?? 0));
  for (const [k, list] of fb) floorRemoved.push(...list.slice(fa.get(k)?.length ?? 0));
  const oldLines = new Set(before.splines.map(s => s.id));
  const newLines = new Set(after.splines.map(s => s.id));
  return {
    floorAdded, floorRemoved,
    linesAdded: new Set(after.splines.filter(s => !oldLines.has(s.id)).map(s => s.id)),
    linesRemoved: before.splines.filter(s => !newLines.has(s.id)),
  };
}

const geoCache = new WeakMap<FactorySnapshot, WeakMap<FactorySnapshot, GeometryDiff>>();

/** `diffGeometry`, computed once per pair. */
export function geometryDiffOf(before: FactorySnapshot, after: FactorySnapshot): GeometryDiff {
  let inner = geoCache.get(after);
  if (!inner) geoCache.set(after, (inner = new WeakMap()));
  let d = inner.get(before);
  if (!d) inner.set(before, (d = diffGeometry(before, after)));
  return d;
}

/** A diff placed on the map: ghosts and outlines in map units, ready for the canvas. */
export interface DiffOverlay {
  added: ReadonlySet<string>;
  /** Buildings of the older snapshot that are gone, placed where they stood. */
  removed: SceneBuilding[];
  /** +1 better, -1 worse, per machine id (changes of at least the page's threshold). */
  productivity: ReadonlyMap<string, 1 | -1>;
  /** 8 numbers (4 corners) per piece. */
  floorAdded: Float32Array;
  floorRemoved: Float32Array;
  linesAdded: ReadonlySet<string>;
  linesRemoved: SceneLine[];
}

export function placeDiff(
  fd: FactoryDiff | null, geo: GeometryDiff, before: FactorySnapshot, index: BuildingIndex, t: MapTransform,
): DiffOverlay {
  const quads = (list: readonly FloorPiece[]) => {
    const out = new Float32Array(list.length * 8);
    list.forEach((p, i) => out.set(toMapUnits(rectCorners(p.x, p.y, p.yaw, floorRect(index.get(p.cls))), t), i * 8));
    return out;
  };
  const productivity = new Map<string, 1 | -1>();
  for (const c of fd?.better ?? []) productivity.set(c.id, 1);
  for (const c of fd?.worse ?? []) productivity.set(c.id, -1);
  const linesRemoved: SceneLine[] = [];
  for (const s of geo.linesRemoved) {
    const style = lineStyle(s.cls);
    if (!style || s.pts.length < 6) continue;
    const pts = new Float32Array((s.pts.length / 3) * 2);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0, j = 0; i + 2 < s.pts.length; i += 3, j += 2) {
      const x = t.x(s.pts[i]!), y = t.y(s.pts[i + 1]!);
      pts[j] = x; pts[j + 1] = y;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    linesRemoved.push({ id: s.id, cls: s.cls, style, pts, minX, minY, maxX, maxY });
  }
  const removedIds = new Set(fd?.removed ?? []);
  return {
    added: new Set(fd?.added ?? []),
    removed: before.buildings
      .filter(b => removedIds.has(b.id) && index.get(b.cls)?.category !== 'structure')
      .map(b => placeBuilding(b, index.get(b.cls), t)),
    productivity,
    floorAdded: quads(geo.floorAdded),
    floorRemoved: quads(geo.floorRemoved),
    linesAdded: geo.linesAdded,
    linesRemoved,
  };
}

/** The figures for the timeline's counter. */
export function diffCounts(fd: FactoryDiff | null, geo: GeometryDiff | null) {
  return {
    added: fd?.added.length ?? 0,
    removed: fd?.removed.length ?? 0,
    better: fd?.better.length ?? 0,
    worse: fd?.worse.length ?? 0,
    floorAdded: geo?.floorAdded.length ?? 0,
    floorRemoved: geo?.floorRemoved.length ?? 0,
    linesAdded: geo?.linesAdded.size ?? 0,
    linesRemoved: geo?.linesRemoved.length ?? 0,
  };
}
