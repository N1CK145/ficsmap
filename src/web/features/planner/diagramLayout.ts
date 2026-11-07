import type { Flow } from '../../../shared/planner.js';

/**
 * Layout of the planner's diagram, left to right: the wanted items in the first column, what goes into
 * them to the right, extractors and items supplied from outside in the last column. Pure and deterministic.
 *
 * Every item is one node, so an intermediate several steps use has several edges (a graph drawn like a
 * tree). Columns are the steps' `depth` (longest path from the targets); steps without inputs move to the
 * last column. An edge spanning several columns gets a lane in each column it passes, so it runs between
 * the nodes there instead of through them. Nodes and lanes are ordered per column by the barycenter of
 * their neighbours (sweeps in both directions, keeping the order with the fewest crossings), then placed
 * vertically as close to their neighbours as the order allows.
 */

/** What the layout needs of a plan step; a `PlanStep` fits. */
export interface DiagramStep {
  item: string;
  depth: number;
  inputs: readonly Flow[];
  byproducts: readonly Flow[];
  cycle: boolean;
  fromByproducts: number;
}

export interface DiagramOptions {
  nodeWidth: number;
  nodeHeight: number;
  /** Space between two columns; the first `stub` px next to a node carry the labels of the edges arriving there. */
  columnGap: number;
  stub: number;
  /** Vertical space between two nodes. */
  rowGap: number;
  /** Height of an edge's lane through a column, and the space next to a lane. */
  laneHeight: number;
  laneGap: number;
  /** Vertical distance between two edges' ends on the same side of a node (at most; less on a crowded side). */
  portGap: number;
  padding: number;
  /** Rounds of ordering and placing, each one left to right and back. */
  sweeps: number;
}

export const DIAGRAM_DEFAULTS: Readonly<DiagramOptions> = {
  nodeWidth: 216, nodeHeight: 96, columnGap: 164, stub: 100, rowGap: 24, laneHeight: 6, laneGap: 10, portGap: 18, padding: 16, sweeps: 4,
};

/** Room for the arrowhead between a node and the label next to it. */
const ARROW = 8;
const EPS = 1e-9;

export interface Point { x: number; y: number }

export interface DiagramNode {
  item: string;
  column: number;
  /** Position in its column, from the top. */
  order: number;
  /** Top left corner. */
  x: number;
  y: number;
  width: number;
  height: number;
}

/** `from` supplies `to`: an ingredient going into the step that uses it, or a by-product into the step it covers. */
export interface DiagramLink {
  from: string;
  to: string;
  /** Units (or m³) per minute. */
  rate: number;
  kind: 'input' | 'byproduct';
  /** Part of a loop: both steps feed each other, directly or through others. */
  loop: boolean;
}

export interface DiagramEdge extends DiagramLink {
  /** The points the path runs through, from `from` to `to` (the arrowhead). */
  points: Point[];
  /** SVG path data. */
  path: string;
  /** Centre of the rate label, on the straight piece next to `to`, and its available width. */
  label: Point & { width: number };
}

export interface DiagramLayout {
  /** By column, then from the top. */
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  columns: number;
  width: number;
  height: number;
}

/** Column per item: its depth, or the last column for a step without inputs (extracted, supplied from outside). */
export function diagramColumns(steps: readonly DiagramStep[]): Map<string, number> {
  const last = Math.max(0, ...steps.map(s => s.depth));
  // A wanted item nothing else uses stays with the other wanted items.
  return new Map(steps.map(s => [s.item, s.inputs.length === 0 && s.depth > 0 ? last : s.depth]));
}

/** The edges: each step's inputs from the steps making them, then the by-products that cover a step's need. */
export function diagramLinks(steps: readonly DiagramStep[]): DiagramLink[] {
  const by = new Map(steps.map(s => [s.item, s]));
  const out: DiagramLink[] = [];
  for (const s of steps) {
    const rates = new Map<string, number>();
    for (const f of s.inputs) {
      // Not in the plan or nothing flows: an ingredient of a step that by-products made unnecessary.
      if (f.item === s.item || f.rate < EPS || !by.has(f.item)) continue;
      rates.set(f.item, (rates.get(f.item) ?? 0) + f.rate);
    }
    for (const [item, rate] of rates) {
      const src = by.get(item)!;
      // Across loops the depth grows by at least one, so the same depth means the same loop.
      out.push({ from: item, to: s.item, rate, kind: 'input', loop: s.cycle && src.cycle && src.depth === s.depth });
    }
  }
  for (const s of steps) {
    const rates = new Map<string, number>();
    for (const f of s.byproducts) {
      if (f.item === s.item || f.rate < EPS || (by.get(f.item)?.fromByproducts ?? 0) < EPS) continue;
      rates.set(f.item, (rates.get(f.item) ?? 0) + f.rate);
    }
    for (const [item, rate] of rates) out.push({ from: s.item, to: item, rate, kind: 'byproduct', loop: false });
  }
  return out;
}

/** Least-squares fit of `t` by a non-decreasing sequence (pool adjacent violators). */
function isotonic(t: readonly number[]): number[] {
  const blocks: { sum: number; n: number }[] = [];
  for (const v of t) {
    blocks.push({ sum: v, n: 1 });
    while (blocks.length > 1) {
      const b = blocks[blocks.length - 1]!;
      const a = blocks[blocks.length - 2]!;
      if (a.sum / a.n <= b.sum / b.n) break;
      a.sum += b.sum;
      a.n += b.n;
      blocks.pop();
    }
  }
  return blocks.flatMap(b => new Array<number>(b.n).fill(b.sum / b.n));
}

/** Positions as close to `want` as possible, in order and at least `sep[i]` after the previous one. */
export function pack(want: readonly number[], sep: readonly number[]): number[] {
  const offset: number[] = [];
  let sum = 0;
  want.forEach((_, i) => { if (i > 0) sum += sep[i]!; offset.push(sum); });
  return isotonic(want.map((w, i) => w - offset[i]!)).map((z, i) => z + offset[i]!);
}

const mean = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const r1 = (n: number) => Math.round(n * 10) / 10;

/** Through the points with horizontal tangents: straight where two points share a height, else an S-curve. */
function curve(points: readonly Point[]): string {
  let d = `M${r1(points[0]!.x)} ${r1(points[0]!.y)}`;
  for (let i = 1; i < points.length; i++) {
    const p = points[i - 1]!;
    const q = points[i]!;
    if (Math.abs(p.y - q.y) < 0.05) d += ` L${r1(q.x)} ${r1(q.y)}`;
    else {
      const mx = r1((p.x + q.x) / 2);
      d += ` C${mx} ${r1(p.y)} ${mx} ${r1(q.y)} ${r1(q.x)} ${r1(q.y)}`;
    }
  }
  return d;
}

interface Slot { column: number; size: number; node?: string }

export function layoutDiagram(steps: readonly DiagramStep[], options: Partial<DiagramOptions> = {}): DiagramLayout {
  const o: DiagramOptions = { ...DIAGRAM_DEFAULTS, ...options };
  if (steps.length === 0) return { nodes: [], edges: [], columns: 0, width: 0, height: 0 };
  const columnOf = diagramColumns(steps);
  const links = diagramLinks(steps);
  const columns = Math.max(...columnOf.values()) + 1;

  // Slots: one per node, and a lane in every column an edge passes through.
  const slots: Slot[] = steps.map(s => ({ column: columnOf.get(s.item)!, size: o.nodeHeight, node: s.item }));
  const slotOf = new Map(steps.map((s, i) => [s.item, i]));
  const left: number[][] = slots.map(() => []);
  const right: number[][] = slots.map(() => []);
  const chains = links.map(l => {
    const a = slotOf.get(l.from)!;
    const b = slotOf.get(l.to)!;
    const [lo, hi] = slots[a]!.column <= slots[b]!.column ? [a, b] : [b, a];
    const chain = [lo];
    for (let c = slots[lo]!.column + 1; c < slots[hi]!.column; c++) {
      slots.push({ column: c, size: o.laneHeight });
      left.push([]);
      right.push([]);
      chain.push(slots.length - 1);
    }
    chain.push(hi);
    if (slots[lo]!.column !== slots[hi]!.column) {
      for (let k = 1; k < chain.length; k++) {
        right[chain[k - 1]!]!.push(chain[k]!);
        left[chain[k]!]!.push(chain[k - 1]!);
      }
    }
    return chain;
  });

  // Order within the columns: start with the plan's order (lanes after the nodes), then barycenter sweeps.
  let cols: number[][] = Array.from({ length: columns }, () => []);
  slots.forEach((s, i) => cols[s.column]!.push(i));
  const pos = new Array<number>(slots.length).fill(0);
  const reindex = () => { for (const col of cols) col.forEach((s, i) => { pos[s] = i; }); };
  reindex();
  const crossings = () => {
    let n = 0;
    for (let c = 0; c + 1 < columns; c++) {
      const segs: [number, number][] = [];
      for (const s of cols[c]!) for (const t of right[s]!) segs.push([pos[s]!, pos[t]!]);
      for (let i = 0; i < segs.length; i++) {
        for (let j = i + 1; j < segs.length; j++) if ((segs[i]![0] - segs[j]![0]) * (segs[i]![1] - segs[j]![1]) < 0) n++;
      }
    }
    return n;
  };
  const reorder = (c: number, nb: number[][]) => {
    const col = cols[c]!;
    const key = col.map((s, i) => (nb[s]!.length > 0 ? mean(nb[s]!.map(n => pos[n]!)) : i));
    const order = col.map((_, i) => i).sort((p, q) => key[p]! - key[q]! || p - q);
    cols[c] = order.map(i => col[i]!);
    cols[c]!.forEach((s, i) => { pos[s] = i; });
  };
  let best = cols.map(c => [...c]);
  let fewest = crossings();
  // Equal counts take the later order: it has settled further.
  const keep = () => { const n = crossings(); if (n <= fewest) { fewest = n; best = cols.map(c => [...c]); } };
  for (let r = 0; r < o.sweeps; r++) {
    for (let c = 1; c < columns; c++) reorder(c, left);
    keep();
    for (let c = columns - 2; c >= 0; c--) reorder(c, right);
    keep();
  }
  cols = best;
  reindex();

  // Heights: centred columns, then each slot as close to the mean of its neighbours as the order allows.
  const y = new Array<number>(slots.length).fill(0);
  const sep = (a: number, b: number) => slots[a]!.size / 2 + slots[b]!.size / 2 + (slots[a]!.node && slots[b]!.node ? o.rowGap : o.laneGap);
  const seps = (col: readonly number[]) => col.map((s, i) => (i > 0 ? sep(col[i - 1]!, s) : 0));
  for (const col of cols) {
    const placed = pack(col.map(() => 0), seps(col));
    col.forEach((s, i) => { y[s] = placed[i]!; });
  }
  const place = (col: readonly number[], nb: number[][]) => {
    const placed = pack(col.map(s => (nb[s]!.length > 0 ? mean(nb[s]!.map(n => y[n]!)) : y[s]!)), seps(col));
    col.forEach((s, i) => { y[s] = placed[i]!; });
  };
  for (let r = 0; r < o.sweeps; r++) {
    for (let c = 1; c < columns; c++) place(cols[c]!, left);
    for (let c = columns - 2; c >= 0; c--) place(cols[c]!, right);
  }
  const top = Math.min(...slots.map((s, i) => y[i]! - s.size / 2));
  for (let i = 0; i < slots.length; i++) y[i] = y[i]! - top + o.padding;

  const colX = (c: number) => o.padding + c * (o.nodeWidth + o.columnGap);
  const nodes: DiagramNode[] = cols.flatMap((col, c) => col.filter(s => slots[s]!.node).map((s, order) => ({
    item: slots[s]!.node!, column: c, order, x: colX(c), y: y[s]! - o.nodeHeight / 2, width: o.nodeWidth, height: o.nodeHeight,
  })));

  // Where the edges meet a node: spread over its side, in the order of where they come from.
  const sides = new Map<string, { link: number; other: number }[]>();
  const attach = (slot: number, side: 'l' | 'r', link: number, other: number) => {
    const key = `${slot}${side}`;
    const list = sides.get(key) ?? [];
    list.push({ link, other });
    sides.set(key, list);
  };
  links.forEach((_, k) => {
    const chain = chains[k]!;
    const lo = chain[0]!;
    const hi = chain[chain.length - 1]!;
    if (slots[lo]!.column === slots[hi]!.column) {
      attach(lo, 'r', k, y[hi]!);
      attach(hi, 'r', k, y[lo]!);
    } else {
      attach(lo, 'r', k, y[chain[1]!]!);
      attach(hi, 'l', k, y[chain[chain.length - 2]!]!);
    }
  });
  const port = new Map<string, number>();
  for (const [key, list] of sides) {
    const slot = Number(key.slice(0, -1));
    list.sort((p, q) => p.other - q.other || p.link - q.link);
    const room = o.nodeHeight - 2 * 10;
    const gap = list.length > 1 ? Math.min(o.portGap, room / (list.length - 1)) : 0;
    list.forEach((a, i) => port.set(`${a.link}:${slot}${key.slice(-1)}`, y[slot]! + (i - (list.length - 1) / 2) * gap));
  }

  const edges: DiagramEdge[] = links.map((l, k) => {
    const chain = chains[k]!;
    const lo = chain[0]!;
    const hi = chain[chain.length - 1]!;
    const toSlot = slotOf.get(l.to)!;
    const xr = (s: number) => colX(slots[s]!.column) + o.nodeWidth;
    const xl = (s: number) => colX(slots[s]!.column);
    const labelWidth = o.stub - ARROW;
    if (slots[lo]!.column === slots[hi]!.column) {
      // Same column (a loop, or a by-product for a neighbour): an arc out to the right and back in.
      const fromSlot = slotOf.get(l.from)!;
      const s = { x: xr(fromSlot), y: port.get(`${k}:${fromSlot}r`)! };
      const t = { x: xr(toSlot), y: port.get(`${k}:${toSlot}r`)! };
      const end = { x: t.x + o.stub, y: t.y };
      const bulge = Math.min(o.columnGap - o.stub - 8, 24 + Math.abs(s.y - t.y) / 4);
      const cx = r1(end.x + bulge);
      return {
        ...l,
        points: [s, { x: end.x + bulge * 0.75, y: (s.y + t.y) / 2 }, end, t],
        path: `M${r1(s.x)} ${r1(s.y)} C${cx} ${r1(s.y)} ${cx} ${r1(t.y)} ${r1(end.x)} ${r1(end.y)} L${r1(t.x)} ${r1(t.y)}`,
        label: { x: t.x + ARROW + labelWidth / 2, y: t.y, width: labelWidth },
      };
    }
    // Left to right: out of the right side of the left node, through the lanes, into the left side of the right node.
    const pts: Point[] = [{ x: xr(lo), y: port.get(`${k}:${lo}r`)! }];
    for (const lane of chain.slice(1, -1)) pts.push({ x: xl(lane), y: y[lane]! }, { x: xr(lane), y: y[lane]! });
    pts.push({ x: xl(hi), y: port.get(`${k}:${hi}l`)! });
    // A straight piece next to the arrowhead carries the label.
    let label: DiagramEdge['label'];
    if (toSlot === lo) {
      pts.splice(1, 0, { x: pts[0]!.x + o.stub, y: pts[0]!.y });
      pts.reverse();
      const t = pts[pts.length - 1]!;
      label = { x: t.x + ARROW + labelWidth / 2, y: t.y, width: labelWidth };
    } else {
      const t = pts[pts.length - 1]!;
      pts.splice(pts.length - 1, 0, { x: t.x - o.stub, y: t.y });
      label = { x: t.x - ARROW - labelWidth / 2, y: t.y, width: labelWidth };
    }
    return { ...l, points: pts, path: curve(pts), label };
  });

  const xs = [...nodes.map(n => n.x + n.width), ...edges.flatMap(e => [...e.points.map(p => p.x), e.label.x + e.label.width / 2])];
  const ys = [...nodes.map(n => n.y + n.height), ...edges.flatMap(e => e.points.map(p => p.y))];
  return { nodes, edges, columns, width: Math.ceil(Math.max(...xs) + o.padding), height: Math.ceil(Math.max(...ys) + o.padding) };
}
