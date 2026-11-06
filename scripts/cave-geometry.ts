import { readFileSync } from 'node:fs';
import { cleanElements, type RawCaves } from '../src/shared/caves.js';
import { traceMask } from './trace.js';

/**
 * Samples the real shape of caves from the extractor's cave geometry (`--cave-geometry-out`: one GLB per
 * cave with every rock mesh and the landscape around it; data-src/extractor/README.md, "Cave geometry").
 *
 * A vertical ray per 1 m cell collects every surface it passes; `classify` turns them into walkable floors,
 * cave floor and entrances (see there).
 */

/** World units (UE cm). */
export const CELL = 100;
const CLEARANCE = 200;
const STEP = 150;
/** Floors this far below the lowest cave volume still count. */
const BAND_BELOW = 300;
/** Connected cave floor smaller than this (cells = m²) is an overhang or a gap between rocks, not cave. */
const MIN_CAVE_CELLS = 200;
/** Mouth pieces closer than this (cm) and at about the same height are one entrance. */
const ENTRANCE_MERGE = 2000;
const ENTRANCE_MERGE_DZ = 300;
/** Smaller mouths (cells along the opening) are ignored. */
const MIN_MOUTH_CELLS = 3;
/** How far (cells) a mouth may lie under an overhang from open sky. */
const OVERHANG_REACH = 15;
/** The volumes are rough boxes; floors this far outside them (horizontally) still count for finding entrances. */
const BAND_GROW = 3000;
/** Triangles steeper than this (|normal.z| below) are walls; they do not make floors or ceilings. */
const MIN_FLAT = 0.1;

export interface CaveBox { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number }

/** Triangles in UE world coordinates (cm), 9 floats each, and whether each one faces up. */
export interface Triangles { pos: Float32Array; up: Uint8Array; count: number }

interface GltfAccessor { bufferView: number; componentType: number; count: number; byteOffset?: number }
interface GltfJson {
  nodes: { mesh?: number; matrix?: number[] }[];
  meshes: { primitives: { attributes: { POSITION: number }; indices: number }[] }[];
  accessors: GltfAccessor[];
  bufferViews: { byteOffset?: number; byteLength: number }[];
}

/** Reads a GLB written by the extractor: node matrices applied, glTF metres (Y up) back to UE cm (Z up). */
export function readGlb(path: string): Triangles {
  const buf = readFileSync(path);
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error(`${path} is not a GLB file`);
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.toString('utf8', 20, 20 + jsonLen)) as GltfJson;
  const binStart = 20 + jsonLen + 8;
  const view = (a: GltfAccessor) => binStart + (json.bufferViews[a.bufferView]!.byteOffset ?? 0) + (a.byteOffset ?? 0);

  let total = 0;
  for (const n of json.nodes) {
    if (n.mesh === undefined) continue;
    for (const p of json.meshes[n.mesh]!.primitives) total += json.accessors[p.indices]!.count / 3;
  }
  const pos = new Float32Array(total * 9);
  const up = new Uint8Array(total);
  let t = 0;
  const v = [0, 0, 0];
  for (const n of json.nodes) {
    if (n.mesh === undefined) continue;
    const m = n.matrix ?? [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    for (const p of json.meshes[n.mesh]!.primitives) {
      const pa = json.accessors[p.attributes.POSITION]!;
      const ia = json.accessors[p.indices]!;
      const po = view(pa);
      const io = view(ia);
      const wide = ia.componentType === 5125;
      for (let k = 0; k < ia.count; k += 3) {
        // glTF positions, then UE: X = x, Y = z, Z = y (metres -> cm)
        const g: number[] = [];
        for (let c = 0; c < 3; c++) {
          const idx = wide ? buf.readUInt32LE(io + (k + c) * 4) : buf.readUInt16LE(io + (k + c) * 2);
          for (let a = 0; a < 3; a++) v[a] = buf.readFloatLE(po + idx * 12 + a * 4);
          const x = m[0]! * v[0]! + m[4]! * v[1]! + m[8]! * v[2]! + m[12]!;
          const y = m[1]! * v[0]! + m[5]! * v[1]! + m[9]! * v[2]! + m[13]!;
          const z = m[2]! * v[0]! + m[6]! * v[1]! + m[10]! * v[2]! + m[14]!;
          g.push(x, y, z);
          pos[t * 9 + c * 3] = x * 100;
          pos[t * 9 + c * 3 + 1] = z * 100;
          pos[t * 9 + c * 3 + 2] = y * 100;
        }
        // Facing in glTF space (counter-clockwise front faces): the normal's Y is UE's up.
        const ux = g[3]! - g[0]!, uy = g[4]! - g[1]!, uz = g[5]! - g[2]!;
        const wx = g[6]! - g[0]!, wy = g[7]! - g[1]!, wz = g[8]! - g[2]!;
        const ny = uz * wx - ux * wz;
        const len = Math.hypot(uy * wz - uz * wy, ny, ux * wy - uy * wx);
        up[t] = len === 0 || Math.abs(ny) / len < MIN_FLAT ? 2 : ny > 0 ? 1 : 0; // 2 = wall
        t++;
      }
    }
  }
  return { pos, up, count: total };
}

/** Per cell, every surface a vertical ray passes: heights (cm) and facing (1 up, 0 down), sorted by height. */
export interface Columns { w: number; h: number; x0: number; y0: number; start: Uint32Array; z: Float32Array; up: Uint8Array }

/** Cell (i, j) covers x0 + i*CELL .. +CELL; its ray is at the cell centre. */
export function sampleColumns(tris: Triangles, box: CaveBox): Columns {
  const x0 = Math.floor(box.minX / CELL) * CELL;
  const y0 = Math.floor(box.minY / CELL) * CELL;
  const w = Math.ceil((box.maxX - x0) / CELL);
  const h = Math.ceil((box.maxY - y0) / CELL);
  const counts = new Uint32Array(w * h + 1);

  const visit = (t: number, emit: (cell: number, z: number) => void) => {
    const p = tris.pos;
    const o = t * 9;
    const ax = p[o]!, ay = p[o + 1]!, az = p[o + 2]!, bx = p[o + 3]!, by = p[o + 4]!, bz = p[o + 5]!, cx = p[o + 6]!, cy = p[o + 7]!, cz = p[o + 8]!;
    const det = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (det === 0) return;
    const i0 = Math.max(0, Math.ceil((Math.min(ax, bx, cx) - x0) / CELL - 0.5));
    const i1 = Math.min(w - 1, Math.floor((Math.max(ax, bx, cx) - x0) / CELL - 0.5));
    const j0 = Math.max(0, Math.ceil((Math.min(ay, by, cy) - y0) / CELL - 0.5));
    const j1 = Math.min(h - 1, Math.floor((Math.max(ay, by, cy) - y0) / CELL - 0.5));
    for (let j = j0; j <= j1; j++) {
      const py = y0 + (j + 0.5) * CELL;
      for (let i = i0; i <= i1; i++) {
        const px = x0 + (i + 0.5) * CELL;
        const l1 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / det;
        const l2 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / det;
        const l3 = 1 - l1 - l2;
        if (l1 < 0 || l2 < 0 || l3 < 0) continue;
        emit(j * w + i, l1 * az + l2 * bz + l3 * cz);
      }
    }
  };

  for (let t = 0; t < tris.count; t++) if (tris.up[t] !== 2) visit(t, cell => { counts[cell + 1]!++; });
  const start = new Uint32Array(w * h + 1);
  for (let k = 0; k < w * h; k++) start[k + 1] = start[k]! + counts[k + 1]!;
  const z = new Float32Array(start[w * h]!);
  const up = new Uint8Array(start[w * h]!);
  const fill = start.slice(0, w * h);
  for (let t = 0; t < tris.count; t++) {
    if (tris.up[t] === 2) continue;
    visit(t, (cell, zz) => { const k = fill[cell]!++; z[k] = zz; up[k] = tris.up[t]!; });
  }
  // sort each column by height
  for (let cell = 0; cell < w * h; cell++) {
    const a = start[cell]!, b = start[cell + 1]!;
    if (b - a < 2) continue;
    const order = Array.from({ length: b - a }, (_, k) => a + k).sort((p, q) => z[p]! - z[q]!);
    const zs = order.map(k => z[k]!), us = order.map(k => up[k]!);
    for (let k = 0; k < order.length; k++) { z[a + k] = zs[k]!; up[a + k] = us[k]!; }
  }
  return { w, h, x0, y0, start, z, up };
}

/**
 * Per cell: the cave volumes' height band [lo, hi] (cm), grown BAND_GROW sideways, NaN outside; `inside` is 1
 * where the cell centre lies in a volume itself.
 */
export interface Band { lo: Float32Array; hi: Float32Array; inside: Uint8Array }

export function volumeBand(cols: Columns, elements: readonly { hull: number[][]; zMin: number; zMax: number }[]): Band {
  const lo = new Float32Array(cols.w * cols.h).fill(Number.NaN);
  const hi = new Float32Array(cols.w * cols.h).fill(Number.NaN);
  const inside = new Uint8Array(cols.w * cols.h);
  for (const e of elements) {
    const xs = e.hull.map(p => p[0]!), ys = e.hull.map(p => p[1]!);
    const i0 = Math.max(0, Math.floor((Math.min(...xs) - BAND_GROW - cols.x0) / CELL)), i1 = Math.min(cols.w - 1, Math.floor((Math.max(...xs) + BAND_GROW - cols.x0) / CELL));
    const j0 = Math.max(0, Math.floor((Math.min(...ys) - BAND_GROW - cols.y0) / CELL)), j1 = Math.min(cols.h - 1, Math.floor((Math.max(...ys) + BAND_GROW - cols.y0) / CELL));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const x = cols.x0 + (i + 0.5) * CELL, y = cols.y0 + (j + 0.5) * CELL;
        const k = j * cols.w + i;
        if (inHull(x, y, e.hull)) inside[k] = 1;
        else if (distanceToRing(x, y, e.hull) > BAND_GROW) continue;
        lo[k] = Number.isNaN(lo[k]!) ? e.zMin : Math.min(lo[k]!, e.zMin);
        hi[k] = Number.isNaN(hi[k]!) ? e.zMax : Math.max(hi[k]!, e.zMax);
      }
    }
  }
  return { lo, hi, inside };
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

function inHull(x: number, y: number, ring: readonly number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!, [xj, yj] = ring[j]!;
    if (yi! > y !== yj! > y && x < ((xj! - xi!) * (y - yi!)) / (yj! - yi!) + xi!) inside = !inside;
  }
  return inside;
}

export interface CaveSample {
  w: number; h: number; x0: number; y0: number;
  /** Lowest cave floor per cell (cm), NaN where the cell has none. */
  floor: Float32Array;
  /**
   * Cells the map shows as cave (1): the cave floor cells with small gaps and holes closed (`caveArea`), only
   * the zones that have an entrance (`keepZonesWith`) if the cave has any, clipped to the volumes (`Band.inside`).
   */
  area: Uint8Array;
  /** Per hit of the columns: 1 cave floor, 2 open floor (sky above), 3 open floor reachable from outside, 4 covered floor not in the cave, 0 none. */
  kind: Uint8Array;
  entrances: { x: number; y: number; z: number; cells: number }[];
}

/**
 * Walkable floors are upward surfaces with at least CLEARANCE of air above (or open sky). Several can lie
 * above each other in one column. A floor is **covered** if the surface ending its air faces down (a rock
 * ceiling seen from inside); floors under an upward surface are buried (earth under the landscape) and not
 * walkable. Floors connect to the four neighbouring columns when the step is at most STEP.
 * The **cave** is the covered floor inside the volumes' height band (grown BAND_GROW sideways, so mouths just
 * outside a volume are found); the map and the items only use the part inside the volumes (`area`). **Outside**
 * is open floor connected to the edge of the sampled box over open floor. An **entrance** is cave floor next
 * to outside floor, or next to covered non-cave floor at most OVERHANG_REACH cells from it (a mouth under
 * an overhang).
 */
export function classify(cols: Columns, band: Band): CaveSample {
  const n = cols.w * cols.h;
  const hits = cols.z.length;
  const kind = new Uint8Array(hits);
  for (let k = 0; k < n; k++) {
    const a = cols.start[k]!, b = cols.start[k + 1]!;
    for (let s = a; s < b; s++) {
      if (cols.up[s] !== 1) continue;
      const zf = cols.z[s]!;
      if (s === b - 1) { kind[s] = 2; continue; } // open sky
      if (cols.z[s + 1]! - zf < CLEARANCE) continue;
      if (cols.up[s + 1] !== 0) continue; // buried
      const inBand = !Number.isNaN(band.lo[k]!) && zf >= band.lo[k]! - BAND_BELOW && zf <= band.hi[k]!;
      kind[s] = inBand ? 1 : 4;
    }
  }

  const cellOf = new Uint32Array(hits);
  for (let k = 0; k < n; k++) for (let s = cols.start[k]!; s < cols.start[k + 1]!; s++) cellOf[s] = k;
  /** Walkable floors in the four neighbouring columns within STEP of hit s. */
  const neighbours = (s: number, out: number[]) => {
    out.length = 0;
    const k = cellOf[s]!, i = k % cols.w, j = (k - i) / cols.w, z = cols.z[s]!;
    for (const [di, dj] of NEIGHBOURS) {
      const ni = i + di, nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= cols.w || nj >= cols.h) continue;
      const nk = nj * cols.w + ni;
      for (let t = cols.start[nk]!; t < cols.start[nk + 1]!; t++) {
        if (kind[t] && Math.abs(cols.z[t]! - z) <= STEP) out.push(t);
      }
    }
  };
  const nb: number[] = [];

  // Small cave patches are overhangs or gaps between rocks, not cave.
  const seen = new Uint8Array(hits);
  for (let s = 0; s < hits; s++) {
    if (kind[s] !== 1 || seen[s]) continue;
    const part = [s];
    seen[s] = 1;
    for (let q = 0; q < part.length; q++) {
      neighbours(part[q]!, nb);
      for (const t of nb) if (kind[t] === 1 && !seen[t]) { seen[t] = 1; part.push(t); }
    }
    if (part.length < MIN_CAVE_CELLS) for (const t of part) kind[t] = 4;
  }

  // Outside: non-cave floor reachable from the box edge.
  const queue: number[] = [];
  for (let k = 0; k < n; k++) {
    const i = k % cols.w, j = (k - i) / cols.w;
    if (i !== 0 && j !== 0 && i !== cols.w - 1 && j !== cols.h - 1) continue;
    for (let s = cols.start[k]!; s < cols.start[k + 1]!; s++) if (kind[s] === 2) { kind[s] = 3; queue.push(s); }
  }
  while (queue.length > 0) {
    neighbours(queue.pop()!, nb);
    for (const t of nb) if (kind[t] === 2) { kind[t] = 3; queue.push(t); }
  }
  // Mouths under an overhang: from outside, up to OVERHANG_REACH cells over covered floor that is not cave.
  const reach = new Uint16Array(hits);
  let front: number[] = [];
  for (let s = 0; s < hits; s++) if (kind[s] === 3) front.push(s);
  for (let step = 1; step <= OVERHANG_REACH && front.length > 0; step++) {
    const next: number[] = [];
    for (const s of front) {
      neighbours(s, nb);
      for (const t of nb) if (kind[t] === 4 && !reach[t]) { reach[t] = step; next.push(t); }
    }
    front = next;
  }

  const floor = new Float32Array(n).fill(Number.NaN);
  const mouthZ = new Float32Array(n).fill(Number.NaN);
  for (let s = 0; s < hits; s++) {
    if (kind[s] !== 1) continue;
    const k = cellOf[s]!;
    if (Number.isNaN(floor[k]!) || cols.z[s]! < floor[k]!) floor[k] = cols.z[s]!;
    neighbours(s, nb);
    if (nb.some(t => kind[t] === 3 || reach[t]! > 0)) mouthZ[k] = cols.z[s]!;
  }

  // Mouth pieces: 8-connected mouth cells; pieces of one opening merged; narrow ones dropped.
  const pieces: { cells: number[]; x: number; y: number; z: number }[] = [];
  const done = new Uint8Array(n);
  for (let k = 0; k < n; k++) {
    if (Number.isNaN(mouthZ[k]!) || done[k]) continue;
    const cells: number[] = [k];
    done[k] = 1;
    for (let q = 0; q < cells.length; q++) {
      const c = cells[q]!;
      const i = c % cols.w, j = (c - i) / cols.w;
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          const ni = i + di, nj = j + dj;
          if (ni < 0 || nj < 0 || ni >= cols.w || nj >= cols.h) continue;
          const nk = nj * cols.w + ni;
          if (!Number.isNaN(mouthZ[nk]!) && !done[nk] && Math.abs(mouthZ[nk]! - mouthZ[c]!) <= STEP) { done[nk] = 1; cells.push(nk); }
        }
      }
    }
    pieces.push({ cells, ...centre(cells) });
  }
  const groups: (typeof pieces)[] = [];
  for (const p of pieces.sort((a, b) => b.cells.length - a.cells.length)) {
    const g = groups.find(gr => gr.some(q => Math.hypot(q.x - p.x, q.y - p.y) <= ENTRANCE_MERGE && Math.abs(q.z - p.z) <= ENTRANCE_MERGE_DZ));
    if (g) g.push(p);
    else groups.push([p]);
  }
  const entrances: CaveSample['entrances'] = [];
  const mouthCells: number[] = [];
  for (const g of groups) {
    const cells = g.flatMap(p => p.cells);
    if (cells.length < MIN_MOUTH_CELLS) continue;
    entrances.push({ ...centre(cells), cells: cells.length });
    mouthCells.push(...cells);
  }
  // A cave without any found entrance (reached through a shaft or water, say) is kept whole.
  let area = caveArea(Uint8Array.from(floor, f => (Number.isNaN(f) ? 0 : 1)), cols.w, cols.h);
  if (mouthCells.length > 0) area = keepZonesWith(area, cols.w, cols.h, mouthCells);
  // Cave only where the game itself says so: inside its cave volumes (cave sound and fog).
  for (let k = 0; k < n; k++) if (!band.inside[k]) area[k] = 0;
  return { w: cols.w, h: cols.h, x0: cols.x0, y0: cols.y0, floor, area, kind, entrances };

  /** The cell of `cells` nearest their mean, as a world point at its mouth height. */
  function centre(cells: readonly number[]) {
    const mi = cells.reduce((sum, c) => sum + (c % cols.w), 0) / cells.length;
    const mj = cells.reduce((sum, c) => sum + Math.floor(c / cols.w), 0) / cells.length;
    let best = cells[0]!;
    let bestD = Infinity;
    for (const c of cells) {
      const d = Math.hypot((c % cols.w) - mi, Math.floor(c / cols.w) - mj);
      if (d < bestD) { bestD = d; best = c; }
    }
    const bi = best % cols.w, bj = Math.floor(best / cols.w);
    return { x: cols.x0 + (bi + 0.5) * CELL, y: cols.y0 + (bj + 0.5) * CELL, z: mouthZ[best]! };
  }
}

const NEIGHBOURS = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

/** Gaps narrower than twice this (cells) between cave floor cells are closed. */
const CLOSE_RADIUS = 3;
/** Holes in the cave floor up to this size (cells = m²) are filled: rocks and pillars standing in the cave. */
const MAX_HOLE_CELLS = 1000;

/**
 * The area the map shows as cave, from the cave floor cells (1 = cave): a rock lying in the cave has its own
 * floor on top that is too small to count as cave, and a pillar has none, so both leave holes in the floor,
 * and gaps between rocks leave cracks along the walls. Closes gaps narrower than 2 * CLOSE_RADIUS cells
 * (dilate, then erode with a disc) and fills holes up to MAX_HOLE_CELLS that do not reach the box edge.
 */
export function caveArea(mask: Uint8Array, w: number, h: number): Uint8Array {
  const disc: [number, number][] = [];
  for (let dj = -CLOSE_RADIUS; dj <= CLOSE_RADIUS; dj++) {
    for (let di = -CLOSE_RADIUS; di <= CLOSE_RADIUS; di++) if (di * di + dj * dj <= CLOSE_RADIUS * CLOSE_RADIUS + 1) disc.push([di, dj]);
  }
  // value: what a cell becomes if any (dilate) or every (erode) cell of the disc around it is set; outside the box counts as `edge`
  const morph = (src: Uint8Array, any: boolean, edge: number) => {
    const dst = new Uint8Array(w * h);
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        let hit = !any;
        for (const [di, dj] of disc) {
          const ni = i + di, nj = j + dj;
          const v = ni < 0 || nj < 0 || ni >= w || nj >= h ? edge : src[nj * w + ni]!;
          if (any ? v === 1 : v === 0) { hit = any; break; }
        }
        dst[j * w + i] = hit ? 1 : 0;
      }
    }
    return dst;
  };
  const area = morph(morph(mask, true, 0), false, 1);

  // Fill enclosed holes (4-connected empty cells not touching the box edge) up to MAX_HOLE_CELLS.
  const seen = new Uint8Array(w * h);
  for (let k = 0; k < w * h; k++) {
    if (area[k] || seen[k]) continue;
    const hole = [k];
    seen[k] = 1;
    let open = false;
    for (let q = 0; q < hole.length; q++) {
      const c = hole[q]!, i = c % w, j = (c - i) / w;
      if (i === 0 || j === 0 || i === w - 1 || j === h - 1) open = true;
      for (const [di, dj] of NEIGHBOURS) {
        const ni = i + di, nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= w || nj >= h) continue;
        const nk = nj * w + ni;
        if (!area[nk] && !seen[nk]) { seen[nk] = 1; hole.push(nk); }
      }
    }
    if (!open && hole.length <= MAX_HOLE_CELLS) for (const c of hole) area[c] = 1;
  }
  return area;
}

/**
 * Keeps only the zones of `area` (8-connected cells) that contain one of `seeds` (cell indices, the entrances'
 * mouth cells); the rest is cleared in place. Zones without an entrance are mostly gaps under rocks next to the
 * cave or parts reached only through openings too small to count.
 */
export function keepZonesWith(area: Uint8Array, w: number, h: number, seeds: readonly number[]): Uint8Array {
  const keep = new Uint8Array(w * h);
  const queue = seeds.filter(k => area[k]);
  for (const k of queue) keep[k] = 1;
  while (queue.length > 0) {
    const c = queue.pop()!, i = c % w, j = (c - i) / w;
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        const ni = i + di, nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= w || nj >= h) continue;
        const nk = nj * w + ni;
        if (area[nk] && !keep[nk]) { keep[nk] = 1; queue.push(nk); }
      }
    }
  }
  for (let k = 0; k < w * h; k++) area[k] = keep[k]!;
  return area;
}

/** Items this far below a cave floor or above its ceiling still count as inside (cm). */
const ITEM_BELOW = 300;
const ITEM_ABOVE = 100;

/**
 * Whether a world point lies in the cave: a cave floor in its cell or a neighbour, inside the cave area (not in a
 * zone dropped for having no entrance), with the point between floor and ceiling.
 */
export function inCaveAt(cols: Columns, sample: CaveSample, x: number, y: number, z: number): boolean {
  const ci = Math.floor((x - cols.x0) / CELL), cj = Math.floor((y - cols.y0) / CELL);
  for (let dj = -1; dj <= 1; dj++) {
    for (let di = -1; di <= 1; di++) {
      const i = ci + di, j = cj + dj;
      if (i < 0 || j < 0 || i >= cols.w || j >= cols.h) continue;
      const k = j * cols.w + i;
      for (let s = cols.start[k]!; s < cols.start[k + 1]! - 1; s++) {
        if (sample.kind[s] !== 1 || !sample.area[k]) continue;
        if (z >= cols.z[s]! - ITEM_BELOW && z <= cols.z[s + 1]! + ITEM_ABOVE) return true;
      }
    }
  }
  return false;
}

/** Rings smaller than this (cm²) are dropped. */
const MIN_RING_AREA = 20 * CELL * CELL;
/** Douglas-Peucker tolerance for the traced outlines (cm). */
const SIMPLIFY = 100;

/**
 * Outlines of the cave area (`caveArea`) as closed rings in world coordinates (cm, first point not repeated): outer
 * rings and holes alike, to be filled with the even-odd rule. Traced along cell edges, simplified, and rounded
 * off with one pass of corner cutting.
 */
export function traceRings(sample: CaveSample): number[][][] {
  return traceMask((i, j) => sample.area[j * sample.w + i] === 1, sample.w, sample.h,
    { x0: sample.x0, y0: sample.y0, cell: CELL, simplify: SIMPLIFY, minArea: MIN_RING_AREA, smooth: true });
}

export interface CaveGeometryIndex { caves: { id: string; file: string; min: number[]; max: number[]; volumes: string[] }[] }
export interface SampledCave { id: string; rings: number[][][]; entrances: { x: number; y: number; z: number }[] }
export interface CaveLayer { caves: SampledCave[]; itemsInCaves: Set<string> }

/**
 * Samples every cave of the extractor's cave geometry (`<dir>/index.json` and one GLB per cave) and tests the
 * given points (items) against the caves. `volumes` is the extractor's caves.json.
 */
export function sampleCaves(
  dir: string, volumes: RawCaves, points: readonly { name: string; x: number; y: number; z: number }[],
  log: (line: string) => void = () => {},
): CaveLayer {
  const index = JSON.parse(readFileSync(`${dir}/index.json`, 'utf8')) as CaveGeometryIndex;
  const byName = new Map(volumes.volumes.map(v => [v.name, v]));
  const caves: SampledCave[] = [];
  const itemsInCaves = new Set<string>();
  for (const entry of index.caves) {
    const elements = entry.volumes.flatMap(n => cleanElements(byName.get(n)?.elements ?? []));
    if (elements.length === 0) continue;
    const box: CaveBox = { minX: entry.min[0]!, minY: entry.min[1]!, minZ: entry.min[2]!, maxX: entry.max[0]!, maxY: entry.max[1]!, maxZ: entry.max[2]! };
    const cols = sampleColumns(readGlb(`${dir}/${entry.file}`), box);
    const sample = classify(cols, volumeBand(cols, elements));
    const rings = traceRings(sample);
    if (rings.length === 0) continue;
    caves.push({ id: entry.id, rings, entrances: sample.entrances.map(({ x, y, z }) => ({ x, y, z })) });
    for (const p of points) {
      if (p.x < box.minX || p.x > box.maxX || p.y < box.minY || p.y > box.maxY) continue;
      if (inCaveAt(cols, sample, p.x, p.y, p.z)) itemsInCaves.add(p.name);
    }
    log(`  ${entry.id}: ${rings.length} outline rings, ${sample.entrances.length} entrances`);
  }
  return { caves, itemsInCaves };
}
