/** Outline tracing of cell masks (cave floor plans, biome areas). */

/** Options of `traceMask`: world placement of the grid and how the outlines are cleaned up. */
export interface TraceOptions {
  /** World position of the grid corner (cell 0, 0) and the cell size (cm). */
  x0: number; y0: number; cell: number;
  /** Douglas-Peucker tolerance (cm). */
  simplify: number;
  /** Rings smaller than this (cm²) are dropped. */
  minArea: number;
  /** One pass of Chaikin corner cutting after simplifying. */
  smooth: boolean;
}

/**
 * Outlines of the cells where `inside(i, j)` holds, as closed rings in world coordinates (first point not
 * repeated): outer rings and holes alike, to be filled with the even-odd rule. Traced along cell edges, then
 * simplified (and rounded off if `smooth`).
 */
export function traceMask(inside: (i: number, j: number) => boolean, w: number, h: number, o: TraceOptions): number[][][] {
  const isIn = (i: number, j: number) => i >= 0 && j >= 0 && i < w && j < h && inside(i, j);
  // Directed boundary edges between lattice corners (inside on the left), keyed by start corner.
  const W1 = w + 1;
  const out = new Map<number, number[]>();
  const add = (a: number, b: number) => { const l = out.get(a); if (l) l.push(b); else out.set(a, [b]); };
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      if (!isIn(i, j)) continue;
      const c00 = j * W1 + i, c10 = c00 + 1, c01 = c00 + W1, c11 = c01 + 1;
      if (!isIn(i, j - 1)) add(c10, c00);
      if (!isIn(i, j + 1)) add(c01, c11);
      if (!isIn(i - 1, j)) add(c00, c01);
      if (!isIn(i + 1, j)) add(c11, c10);
    }
  }
  const rings: number[][][] = [];
  for (const [startCorner, ends] of out) {
    while (ends.length > 0) {
      const ring: number[] = [startCorner];
      let prev = startCorner;
      let cur = ends.pop()!;
      while (cur !== startCorner) {
        ring.push(cur);
        const next = out.get(cur)!;
        // At a corner where two outlines touch, take the sharpest left turn so outlines do not cross.
        let pick = 0;
        if (next.length > 1) {
          const [px, py] = [prev % W1, Math.floor(prev / W1)], [cx, cy] = [cur % W1, Math.floor(cur / W1)];
          const din = [cx - px, cy - py];
          pick = next.findIndex(n => { const d = [n % W1 - cx, Math.floor(n / W1) - cy]; return din[0]! * d[1]! - din[1]! * d[0]! < 0; });
          if (pick < 0) pick = 0;
        }
        prev = cur;
        cur = next.splice(pick, 1)[0]!;
      }
      const pts = ring.map(c => [o.x0 + (c % W1) * o.cell, o.y0 + Math.floor(c / W1) * o.cell]);
      const simple = simplify(pts, o.simplify);
      const done = o.smooth ? chaikin(simple) : simple;
      if (done.length >= 3 && Math.abs(area(done)) >= o.minArea) rings.push(done);
    }
  }
  return rings;
}

function area(ring: readonly number[][]): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += ring[j]![0]! * ring[i]![1]! - ring[i]![0]! * ring[j]![1]!;
  return a / 2;
}

/** Douglas-Peucker on a closed ring (split at the point farthest from the first). */
function simplify(ring: number[][], tol: number): number[][] {
  if (ring.length < 4) return ring;
  let far = 0, farD = -1;
  for (let i = 1; i < ring.length; i++) {
    const d = Math.hypot(ring[i]![0]! - ring[0]![0]!, ring[i]![1]! - ring[0]![1]!);
    if (d > farD) { farD = d; far = i; }
  }
  const a = dp([...ring.slice(0, far + 1)], tol), b = dp([...ring.slice(far), ring[0]!], tol);
  return [...a.slice(0, -1), ...b.slice(0, -1)];
}

function dp(pts: number[][], tol: number): number[][] {
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length > 0) {
    const [s, e] = stack.pop()!;
    const [ax, ay] = pts[s]!, [bx, by] = pts[e]!;
    let best = -1, bestD = tol;
    for (let i = s + 1; i < e; i++) {
      const [px, py] = pts[i]!;
      const dx = bx! - ax!, dy = by! - ay!;
      const len = Math.hypot(dx, dy);
      const d = len === 0 ? Math.hypot(px! - ax!, py! - ay!) : Math.abs(dy * (px! - ax!) - dx * (py! - ay!)) / len;
      if (d > bestD) { bestD = d; best = i; }
    }
    if (best >= 0) { keep[best] = 1; stack.push([s, best], [best, e]); }
  }
  return pts.filter((_, i) => keep[i]);
}

/** One pass of Chaikin corner cutting on a closed ring. */
function chaikin(ring: number[][]): number[][] {
  if (ring.length < 3) return ring;
  const out: number[][] = [];
  for (let i = 0; i < ring.length; i++) {
    const [ax, ay] = ring[i]!, [bx, by] = ring[(i + 1) % ring.length]!;
    out.push([0.75 * ax! + 0.25 * bx!, 0.75 * ay! + 0.25 * by!], [0.25 * ax! + 0.75 * bx!, 0.25 * ay! + 0.75 * by!]);
  }
  return out;
}

