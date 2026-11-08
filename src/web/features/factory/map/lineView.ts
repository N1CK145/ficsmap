import type { LineEdge, LineGroup, ProductionLine, ProductionLines } from '../../../../shared/factory/lines.js';
import type { FactoryLabels } from '../data.js';
import type { Lang } from '../format.js';
import type { Scene, SceneBuilding, SceneLine } from './scene.js';

/**
 * Production lines on the map (pure): their order in the panel's list, their names and bottleneck in words, and their
 * geometry (the buildings, and the belts and pipes of each connection oriented along the flow), built once per scene
 * and line.
 */

/** How loaded a connection is: flow per minute against the capacity of its slowest belt or pipe. */
export type EdgeLoad = 'low' | 'mid' | 'saturated' | 'unknown';

/** From this share of the capacity a connection counts as busy, from `SATURATED` as full (the contract's 95 %). */
export const LOAD_MID = 0.5;
export const SATURATED = 0.95;

/** Flow per minute over capacity, or null when either is unknown. */
export function edgeRatio(e: LineEdge): number | null {
  if (e.perMin === undefined || !e.capacity) return null;
  return e.perMin / e.capacity;
}

export function edgeLoad(e: LineEdge): EdgeLoad {
  if (e.saturated) return 'saturated';
  const r = edgeRatio(e);
  if (r === null) return 'unknown';
  return r >= SATURATED ? 'saturated' : r >= LOAD_MID ? 'mid' : 'low';
}

/**
 * Whether the line has a problem worth looking at first: a full connection, or a group held back by something other
 * than missing demand or surplus (those are the end of a line that makes more than is taken, not a fault in it).
 */
export function lineHasIssue(l: ProductionLine): boolean {
  const b = l.bottleneck;
  if (!b) return false;
  return b.kind === 'edge' || (b.why !== 'demand' && b.why !== 'surplus');
}

/** The panel's order: lines with an issue first, then the bigger ones (more machines), then the weaker ones. */
export function sortLines(lines: readonly ProductionLine[]): ProductionLine[] {
  return [...lines].sort((a, b) =>
    Number(lineHasIssue(b)) - Number(lineHasIssue(a))
    || b.machines.length - a.machines.length
    || a.productivity - b.productivity
    || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

const byIdCache = new WeakMap<ProductionLines, Map<string, ProductionLine>>();

/** A line by its id. */
export function lineById(pl: ProductionLines, id: string | null | undefined): ProductionLine | undefined {
  if (!id) return undefined;
  let m = byIdCache.get(pl);
  if (!m) byIdCache.set(pl, (m = new Map(pl.lines.map(l => [l.id, l]))));
  return m.get(id);
}

const memberCache = new WeakMap<ProductionLine, Set<string>>();

/** Whether a building, belt, lift or pipe is part of a line (a boundary building, a station, can be in several). */
export function lineHas(l: ProductionLine, id: string): boolean {
  let m = memberCache.get(l);
  if (!m) memberCache.set(l, (m = new Set([...l.buildings, ...(l.via ?? [])])));
  return m.has(id);
}

/**
 * The line a building (or belt, lift, pipe) belongs to: `prefer` (the chosen line) when it is part of it, so a station
 * between two lines stays with the one looked at; else the line the index names.
 */
export function lineOf(pl: ProductionLines | null | undefined, id: string | null | undefined, prefer?: string | null): ProductionLine | undefined {
  if (!pl || !id) return undefined;
  const chosen = lineById(pl, prefer);
  if (chosen && lineHas(chosen, id)) return chosen;
  return lineById(pl, pl.index.get(id));
}

/** Squared distance from a point to a segment. */
function segDist2(px: number, py: number, x0: number, y0: number, x1: number, y1: number): number {
  const dx = x1 - x0, dy = y1 - y0;
  const len2 = dx * dx + dy * dy;
  const k = len2 > 0 ? Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / len2)) : 0;
  const qx = x0 + dx * k - px, qy = y0 + dy * k - py;
  return qx * qx + qy * qy;
}

/**
 * The belt or pipe of a production line nearest to a map point within `slack` map units (belts and pipes are not
 * picked as buildings), or null: hovering or clicking a belt lights up its line too.
 */
export function pickLineSpline(scene: Scene, pl: ProductionLines | null | undefined, mx: number, my: number, slack: number): string | null {
  if (!pl) return null;
  let best: string | null = null, bestD = slack * slack;
  for (const l of scene.lines) {
    if (l.style.kind === 'road' || l.style.kind === 'rail' || l.style.kind === 'hyper') continue;
    if (mx < l.minX - slack || mx > l.maxX + slack || my < l.minY - slack || my > l.maxY + slack) continue;
    if (!pl.index.has(l.id)) continue;
    const p = l.pts;
    for (let i = 2; i + 1 < p.length; i += 2) {
      const d = segDist2(mx, my, p[i - 2]!, p[i - 1]!, p[i]!, p[i + 1]!);
      if (d <= bestD) { bestD = d; best = l.id; }
    }
  }
  return best;
}

/** The line lit up on the map: the hovered one (a building, a row of the list), else the chosen one. */
export function shownLine(pl: ProductionLines | null | undefined, hoverId: string | null, chosenId: string | null): ProductionLine | undefined {
  if (!pl) return undefined;
  return lineById(pl, hoverId) ?? lineById(pl, chosenId);
}

/** A line's name: its main product ("Kupferbarren"), with "+2" when it makes more. */
export function lineName(l: ProductionLine, labels: FactoryLabels | undefined, lang: Lang): string {
  const main = l.products[0];
  if (!main) return labels ? groupName(l, l.groups.find(g => !g.logistics)?.id ?? '', labels, lang) : l.id;
  const name = labels?.item(main.item, lang) ?? main.item;
  return l.products.length > 1 ? `${name} +${l.products.length - 1}` : name;
}

function groupOf(l: ProductionLine, id: string): LineGroup | undefined {
  return l.groups.find(g => g.id === id);
}

/** The name of a group's building class ("Konstruktor"); the group id when unknown. */
export function groupName(l: ProductionLine, groupId: string, labels: FactoryLabels, lang: Lang): string {
  const g = groupOf(l, groupId);
  return g ? labels.building(g.cls, lang) : groupId;
}

type T = (key: string, opts?: Record<string, unknown>) => string;

/**
 * The bottleneck in words: "Förderband Mk.2 voll zwischen Schmelzofen und Konstruktor" (a full connection) or
 * "Konstruktor: Mangel" (a group and its reason; "3 × Konstruktor: Mangel" for several). Null without one.
 */
export function bottleneckText(l: ProductionLine, labels: FactoryLabels, lang: Lang, t: T): string | null {
  const b = l.bottleneck;
  if (!b) return null;
  if (b.kind === 'edge') {
    const e = l.edges[b.edge];
    if (!e) return null;
    const from = groupName(l, e.from, labels, lang), to = groupName(l, e.to, labels, lang);
    const link = e.slowest ? labels.building(e.slowest, lang) : t(e.item && labels.isFluid(e.item) ? 'factoryMap.lines.pipe' : 'factoryMap.lines.belt');
    return t('factoryMap.lines.edgeFull', { link, from, to });
  }
  const g = groupOf(l, b.group);
  const name = g ? labels.building(g.cls, lang) : b.group;
  const why = b.why === 'demand' ? t('factoryMap.lines.demand') : t(`factory.reason.${b.why}`);
  const count = g && !g.logistics ? g.members.length : 1;
  return count > 1 ? t('factoryMap.lines.groupIssueMany', { count, name, why }) : t('factoryMap.lines.groupIssue', { name, why });
}

// ---------------------------------------------------------------------------------------------------------------
// Geometry.

/** One connection of a line on the map. */
export interface LineEdgeGeom {
  edge: LineEdge;
  /** Index in `ProductionLine.edges`. */
  index: number;
  load: EdgeLoad;
  /** This connection is the line's bottleneck. */
  bottleneck: boolean;
  belt: boolean;
  /** The belts and pipes along the way, each as x, y per point in map units, oriented along the flow. */
  paths: Float32Array[];
  /** Lifts (and other buildings) along the way. */
  lifts: SceneBuilding[];
  /** Where its glyph goes: the middle of its longest path, with the direction there (radians); null without a path. */
  mid: { x: number; y: number; a: number } | null;
}

export interface LineGeom {
  line: ProductionLine;
  /** The line's belts and pipes that are no connection between its groups (inside a group: a manifold's belts). */
  inner: Float32Array[];
  /** The line's buildings in the scene (machines and logistics nodes). */
  buildings: SceneBuilding[];
  edges: LineEdgeGeom[];
  /** The box around buildings and paths, map units; null when nothing is in the scene. */
  box: { minX: number; minY: number; maxX: number; maxY: number } | null;
}

const lineIdCache = new WeakMap<Scene, Map<string, SceneLine>>();

/** The scene's belts and pipes by spline id. */
export function sceneLineById(scene: Scene): Map<string, SceneLine> {
  let m = lineIdCache.get(scene);
  if (!m) lineIdCache.set(scene, (m = new Map(scene.lines.map(l => [l.id, l]))));
  return m;
}

function centroid(scene: Scene, ids: readonly string[]): { x: number; y: number } | null {
  let x = 0, y = 0, n = 0;
  for (const id of ids) {
    const sb = scene.byId.get(id);
    if (!sb) continue;
    x += sb.cx; y += sb.cy; n++;
  }
  return n > 0 ? { x: x / n, y: y / n } : null;
}

function reversed(pts: Float32Array): Float32Array {
  const out = new Float32Array(pts.length);
  for (let i = 0, j = pts.length - 2; j >= 0; i += 2, j -= 2) {
    out[i] = pts[j]!;
    out[i + 1] = pts[j + 1]!;
  }
  return out;
}

/**
 * A path along the flow. A belt's spline runs the way its items move (from its input to its output connector), so it
 * stays as it is. A pipe's direction is not in its spline: the end nearer to the upstream group comes first.
 */
export function orientPath(pts: Float32Array, belt: boolean, from: { x: number; y: number } | null, to: { x: number; y: number } | null): Float32Array {
  if (belt || !from || !to || pts.length < 4) return pts;
  const n = pts.length;
  const d = (i: number, p: { x: number; y: number }) => Math.hypot(pts[i]! - p.x, pts[i + 1]! - p.y);
  const forward = d(0, from) + d(n - 2, to);
  const backward = d(n - 2, from) + d(0, to);
  return backward < forward ? reversed(pts) : pts;
}

/** The point at half the length of a path with its direction, map units. */
export function midOf(pts: ArrayLike<number>): { x: number; y: number; a: number } | null {
  if (pts.length < 4) return null;
  let total = 0;
  for (let i = 2; i + 1 < pts.length; i += 2) total += Math.hypot(pts[i]! - pts[i - 2]!, pts[i + 1]! - pts[i - 1]!);
  let left = total / 2;
  for (let i = 2; i + 1 < pts.length; i += 2) {
    const dx = pts[i]! - pts[i - 2]!, dy = pts[i + 1]! - pts[i - 1]!;
    const len = Math.hypot(dx, dy);
    if (len >= left && len > 0) {
      const k = left / len;
      return { x: pts[i - 2]! + dx * k, y: pts[i - 1]! + dy * k, a: Math.atan2(dy, dx) };
    }
    left -= len;
  }
  return { x: pts[pts.length - 2]!, y: pts[pts.length - 1]!, a: 0 };
}

function pathLength(pts: ArrayLike<number>): number {
  let total = 0;
  for (let i = 2; i + 1 < pts.length; i += 2) total += Math.hypot(pts[i]! - pts[i - 2]!, pts[i + 1]! - pts[i - 1]!);
  return total;
}

const geomCache = new WeakMap<Scene, WeakMap<ProductionLine, LineGeom>>();

/** A line's buildings and connections in the scene, built once per scene and line. */
export function lineGeometry(scene: Scene, line: ProductionLine): LineGeom {
  let perScene = geomCache.get(scene);
  if (!perScene) geomCache.set(scene, (perScene = new WeakMap()));
  const hit = perScene.get(line);
  if (hit) return hit;
  const splines = sceneLineById(scene);
  const groups = new Map(line.groups.map(g => [g.id, g]));
  const buildings = line.buildings.map(id => scene.byId.get(id)).filter((sb): sb is SceneBuilding => sb !== undefined);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const grow = (x0: number, y0: number, x1: number, y1: number) => {
    if (x0 < minX) minX = x0;
    if (y0 < minY) minY = y0;
    if (x1 > maxX) maxX = x1;
    if (y1 > maxY) maxY = y1;
  };
  for (const sb of buildings) grow(sb.minX, sb.minY, sb.maxX, sb.maxY);
  const neck = line.bottleneck?.kind === 'edge' ? line.bottleneck.edge : -1;
  const edges = line.edges.map((edge, index): LineEdgeGeom => {
    const from = centroid(scene, groups.get(edge.from)?.members ?? [edge.from]);
    const to = centroid(scene, groups.get(edge.to)?.members ?? [edge.to]);
    const paths: Float32Array[] = [];
    const lifts: SceneBuilding[] = [];
    let belt = true;
    for (const id of edge.via) {
      const l = splines.get(id);
      if (l) {
        if (l.style.kind === 'pipe') belt = false;
        paths.push(orientPath(l.pts, l.style.kind !== 'pipe', from, to));
        grow(l.minX, l.minY, l.maxX, l.maxY);
        continue;
      }
      const sb = scene.byId.get(id);
      if (sb) lifts.push(sb);
    }
    let longest: Float32Array | null = null, best = -1;
    for (const p of paths) {
      const len = pathLength(p);
      if (len > best) { best = len; longest = p; }
    }
    return { edge, index, load: edgeLoad(edge), bottleneck: index === neck, belt, paths, lifts, mid: longest ? midOf(longest) : null };
  });
  const onEdge = new Set(line.edges.flatMap(e => e.via));
  const inner: Float32Array[] = [];
  for (const id of line.via ?? []) {
    if (onEdge.has(id)) continue;
    const l = splines.get(id);
    if (!l) continue;
    inner.push(l.pts);
    grow(l.minX, l.minY, l.maxX, l.maxY);
  }
  const geom: LineGeom = { line, inner, buildings, edges, box: Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null };
  perScene.set(line, geom);
  return geom;
}

/**
 * Chevrons along a path in screen px (x, y per point): every `spacing` px, starting half a spacing in, each with the
 * direction of its segment (radians). Points off the box `[0, w] × [0, h]` (with `margin`) are left out.
 */
export function chevronsAlong(pts: ArrayLike<number>, spacing: number, w: number, h: number, margin = 16): { x: number; y: number; a: number }[] {
  const out: { x: number; y: number; a: number }[] = [];
  let next = spacing / 2;
  let walked = 0;
  for (let i = 2; i + 1 < pts.length; i += 2) {
    const x0 = pts[i - 2]!, y0 = pts[i - 1]!;
    const dx = pts[i]! - x0, dy = pts[i + 1]! - y0;
    const len = Math.hypot(dx, dy);
    if (len === 0) continue;
    while (next <= walked + len) {
      const k = (next - walked) / len;
      const x = x0 + dx * k, y = y0 + dy * k;
      if (x >= -margin && y >= -margin && x <= w + margin && y <= h + margin) out.push({ x, y, a: Math.atan2(dy, dx) });
      next += spacing;
      if (out.length > 2000) return out;
    }
    walked += len;
  }
  return out;
}
