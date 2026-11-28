import { distance3d } from './geo.js';
import type { Vec3 } from './types.js';

export const MAX_ROUTE_STOPS = 30;

/** The cave a point lies in: its id and its entrances (world cm). */
export interface RouteCave { id: string; entrances: readonly Vec3[] }

/** A point of a route; `cave` when it lies in a cave (then it is reached through one of the cave's entrances). */
export interface RoutePlace extends Vec3 { cave?: RouteCave }
export interface RoutePoint extends RoutePlace { id: string }

const EPS = 1e-6;
const MAX_SEGMENT = 3;

const inCave = (p: RoutePlace): RouteCave | undefined => (p.cave && p.cave.entrances.length > 0 ? p.cave : undefined);

/**
 * The way from `a` to `b` and its length (world units). On the open map and between two points of the same cave a
 * straight line. Into or out of a cave it goes through the cave's entrance that makes it shortest, from one cave
 * into another through one entrance of each; `via` lists those entrances in walking order. Inside a cave the leg
 * is the straight line from the entrance (an assumption: the tunnels' real paths are not known).
 */
export function leg(a: RoutePlace, b: RoutePlace): { length: number; via: Vec3[] } {
  const ca = inCave(a), cb = inCave(b);
  if (!ca && !cb) return { length: distance3d(a, b), via: [] };
  if (ca && cb && ca.id === cb.id) return { length: distance3d(a, b), via: [] };
  let best = { length: Infinity, via: [] as Vec3[] };
  const outs = ca ? ca.entrances : [null];
  const ins = cb ? cb.entrances : [null];
  for (const o of outs) {
    for (const i of ins) {
      const via = [o, i].filter((e): e is Vec3 => e !== null);
      const pts = [a, ...via, b];
      let length = 0;
      for (let k = 1; k < pts.length; k++) length += distance3d(pts[k - 1]!, pts[k]!);
      if (length < best.length) best = { length, via };
    }
  }
  return best;
}

const legLength = (a: RoutePlace, b: RoutePlace) => leg(a, b).length;

/** Distance between path[i] and path[j]; indices are always in range here. */
function dist(path: RoutePlace[], i: number, j: number): number {
  return legLength(path[i]!, path[j]!);
}

/** Length of the open path start -> ordered[0] -> ... in world units (through cave entrances, see `leg`). */
export function pathLength(start: RoutePlace, ordered: RoutePlace[]): number {
  let total = 0;
  let prev = start;
  for (const p of ordered) {
    total += legLength(prev, p);
    prev = p;
  }
  return total;
}

/** Greedy nearest-neighbour order from a fixed start; ties go to the earlier input stop. */
export function nearestNeighbour(start: RoutePlace, stops: RoutePoint[]): RoutePoint[] {
  const remaining = [...stops];
  const out: RoutePoint[] = [];
  let cur: RoutePlace = start;
  while (remaining.length > 0) {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const d = legLength(cur, remaining[i]!);
      if (d < bestD) { bestD = d; best = i; }
    }
    const next = remaining.splice(best, 1)[0]!;
    out.push(next);
    cur = next;
  }
  return out;
}

/** Reverse path[i..j] if it shortens the open path. path[0] is the fixed start. */
function twoOptPass(path: RoutePlace[]): boolean {
  const n = path.length - 1;
  let improved = false;
  for (let i = 1; i < n; i++) {
    for (let j = i + 1; j <= n; j++) {
      const hasNext = j < n;
      const before = dist(path, i - 1, i) + (hasNext ? dist(path, j, j + 1) : 0);
      const after = dist(path, i - 1, j) + (hasNext ? dist(path, i, j + 1) : 0);
      if (before - after > EPS) {
        for (let a = i, b = j; a < b; a++, b--) [path[a], path[b]] = [path[b]!, path[a]!];
        improved = true;
      }
    }
  }
  return improved;
}

/** Move a run of 1..3 stops to its best position if that shortens the open path. */
function orOptPass(path: RoutePlace[]): boolean {
  let improved = false;
  for (let len = 1; len <= MAX_SEGMENT; len++) {
    for (let s = 1; s + len - 1 < path.length; s++) {
      const e = s + len - 1;
      const hasNext = e + 1 < path.length;
      const removeGain = dist(path, s - 1, s) + (hasNext ? dist(path, e, e + 1) - dist(path, s - 1, e + 1) : 0);
      const rest = [...path.slice(0, s), ...path.slice(e + 1)];
      let bestK = -1;
      let bestCost = Infinity;
      for (let k = 0; k < rest.length; k++) {
        if (k === s - 1) continue; // original position
        const hasAfter = k + 1 < rest.length;
        const cost = legLength(rest[k]!, path[s]!) +
          (hasAfter ? legLength(path[e]!, rest[k + 1]!) - dist(rest, k, k + 1) : 0);
        if (cost < bestCost) { bestCost = cost; bestK = k; }
      }
      if (bestK >= 0 && removeGain - bestCost > EPS) {
        const seg = path.slice(s, e + 1);
        rest.splice(bestK + 1, 0, ...seg);
        for (let i = 0; i < path.length; i++) path[i] = rest[i]!;
        improved = true;
      }
    }
  }
  return improved;
}

/**
 * Stop ids in visiting order: nearest neighbour, then 2-opt and Or-opt until no gain > 1e-6. Distances are the
 * legs of `leg` (through cave entrances; symmetric, so reversing a part of the path keeps its length).
 */
export function optimizeRoute(start: RoutePlace, stops: RoutePoint[]): string[] {
  if (stops.length < 2) return stops.map((s) => s.id);
  const path: RoutePoint[] = [{ ...start, id: '' }, ...nearestNeighbour(start, stops)];
  // Each accepted move shortens the path by > EPS, so this terminates.
  while (twoOptPass(path) || orOptPass(path)) { /* repeat */ }
  return path.slice(1).map((p) => p.id);
}
