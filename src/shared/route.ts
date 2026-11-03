import { distance3d } from './geo.js';
import type { Vec3 } from './types.js';

export const MAX_ROUTE_STOPS = 30;

export interface RoutePoint extends Vec3 { id: string }

const EPS = 1e-6;
const MAX_SEGMENT = 3;

/** Distance between path[i] and path[j]; indices are always in range here. */
function dist(path: Vec3[], i: number, j: number): number {
  return distance3d(path[i]!, path[j]!);
}

/** Length of the open path start -> ordered[0] -> ... in world units. */
export function pathLength(start: Vec3, ordered: Vec3[]): number {
  let total = 0;
  let prev = start;
  for (const p of ordered) {
    total += distance3d(prev, p);
    prev = p;
  }
  return total;
}

/** Greedy nearest-neighbour order from a fixed start; ties go to the earlier input stop. */
export function nearestNeighbour(start: Vec3, stops: RoutePoint[]): RoutePoint[] {
  const remaining = [...stops];
  const out: RoutePoint[] = [];
  let cur: Vec3 = start;
  while (remaining.length > 0) {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const d = distance3d(cur, remaining[i]!);
      if (d < bestD) { bestD = d; best = i; }
    }
    const next = remaining.splice(best, 1)[0]!;
    out.push(next);
    cur = next;
  }
  return out;
}

/** Reverse path[i..j] if it shortens the open path. path[0] is the fixed start. */
function twoOptPass(path: Vec3[]): boolean {
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
function orOptPass(path: Vec3[]): boolean {
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
        const cost = distance3d(rest[k]!, path[s]!) +
          (hasAfter ? distance3d(path[e]!, rest[k + 1]!) - dist(rest, k, k + 1) : 0);
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

/** Stop ids in visiting order: nearest neighbour, then 2-opt and Or-opt until no gain > 1e-6. */
export function optimizeRoute(start: Vec3, stops: RoutePoint[]): string[] {
  if (stops.length < 2) return stops.map((s) => s.id);
  const path: RoutePoint[] = [{ id: '', ...start }, ...nearestNeighbour(start, stops)];
  // Each accepted move shortens the path by > EPS, so this terminates.
  while (twoOptPass(path) || orOptPass(path)) { /* repeat */ }
  return path.slice(1).map((p) => p.id);
}
