import type { Flow } from '../../../shared/planner.js';

/**
 * Layout of the planner's diagram as a material flow from top to bottom: extractors and items supplied from
 * outside in the top row, what is made from them below, the wanted items in the bottom row. Pure and
 * deterministic.
 *
 * Every item is one node, so an intermediate several steps use has several edges (a graph drawn like a
 * tree). A step's row counts from the extraction side: `maxDepth - depth` (`depth` = longest path from the
 * targets); steps without inputs move to the top row. An edge spanning several rows gets a lane in each row
 * it passes, so it runs between the nodes there instead of through them. Nodes and lanes are ordered per row
 * by the barycenter of their neighbours (sweeps in both directions, keeping the order with the fewest
 * crossings), then placed horizontally as close to their neighbours as the order allows. A row is as high as
 * its tallest node (`heights`, measured by the page, else `nodeHeight`), so the edges of a row start and end
 * on one line. The rate labels sit on a straight piece above the arrowhead; several labels at one side of a
 * node are staggered in height, and the space between two rows grows with them.
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
  /** Height of a node without an entry in `heights`. */
  nodeHeight: number;
  /** Per item the height its node needs; a row takes the largest of its nodes. */
  heights?: ReadonlyMap<string, number>;
  /** Horizontal space between two nodes of a row. */
  columnGap: number;
  /** Vertical room for the curves between two rows, on top of the room the labels take. */
  rowGap: number;
  /** Width of an edge's lane through a row, and the space next to a lane. */
  laneWidth: number;
  laneGap: number;
  /** Horizontal distance between two edges' ends on the same side of a node (at most; less on a crowded side). */
  portGap: number;
  /** A rate label's largest width and its height; labels at one side of a node are staggered by the height. */
  labelWidth: number;
  labelHeight: number;
  padding: number;
  /** Rounds of ordering and placing, each one up and back down. */
  sweeps: number;
}

export const DIAGRAM_DEFAULTS: Readonly<DiagramOptions> = {
  nodeWidth: 224, nodeHeight: 72, columnGap: 32, rowGap: 28, laneWidth: 6, laneGap: 12, portGap: 112,
  labelWidth: 104, labelHeight: 20, padding: 16, sweeps: 4,
};

/** Room for the arrowhead between a node and the label next to it. */
const ARROW = 8;
/** Edge ends keep this far from a node's corners. */
const INSET = 16;
const EPS = 1e-9;

export interface Point { x: number; y: number }

export interface DiagramNode {
  item: string;
  /** 0 = the top row (extraction). */
  row: number;
  /** Position in its row, from the left. */
  order: number;
  /** Top left corner. */
  x: number;
  y: number;
  width: number;
  /** The height of its row. */
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
  /** By row from the top, then from the left. */
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  rows: number;
  width: number;
  height: number;
}

/** Distance from the wanted items: the step's depth, or the largest for a step without inputs. */
function ranks(steps: readonly DiagramStep[]): Map<string, number> {
  const last = Math.max(0, ...steps.map(s => s.depth));
  // A wanted item nothing else uses stays with the other wanted items.
  return new Map(steps.map(s => [s.item, s.inputs.length === 0 && s.depth > 0 ? last : s.depth]));
}

/** Row per item, 0 at the top: extracted and supplied items there, the wanted items in the last row. */
export function diagramRows(steps: readonly DiagramStep[]): Map<string, number> {
  const rank = ranks(steps);
  const last = Math.max(0, ...rank.values());
  return new Map([...rank].map(([item, r]) => [item, last - r]));
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

/** Through the points with vertical tangents: straight where two points share an x, else an S-curve. */
function curve(points: readonly Point[]): string {
  let d = `M${r1(points[0]!.x)} ${r1(points[0]!.y)}`;
  for (let i = 1; i < points.length; i++) {
    const p = points[i - 1]!;
    const q = points[i]!;
    if (Math.abs(p.x - q.x) < 0.05) d += ` L${r1(q.x)} ${r1(q.y)}`;
    else {
      const my = r1((p.y + q.y) / 2);
      d += ` C${r1(p.x)} ${my} ${r1(q.x)} ${my} ${r1(q.x)} ${r1(q.y)}`;
    }
  }
  return d;
}

interface Slot { row: number; size: number; node?: string }
type Side = 't' | 'b';

export function layoutDiagram(steps: readonly DiagramStep[], options: Partial<DiagramOptions> = {}): DiagramLayout {
  const o: DiagramOptions = { ...DIAGRAM_DEFAULTS, ...options };
  if (steps.length === 0) return { nodes: [], edges: [], rows: 0, width: 0, height: 0 };
  const rowOf = diagramRows(steps);
  const links = diagramLinks(steps);
  const rows = Math.max(...rowOf.values()) + 1;

  // Slots: one per node, and a lane in every row an edge passes through.
  const slots: Slot[] = steps.map(s => ({ row: rowOf.get(s.item)!, size: o.nodeWidth, node: s.item }));
  const slotOf = new Map(steps.map((s, i) => [s.item, i]));
  const above: number[][] = slots.map(() => []);
  const below: number[][] = slots.map(() => []);
  // Per link: the slots from the upper end down to the lower one.
  const chains = links.map(l => {
    const a = slotOf.get(l.from)!;
    const b = slotOf.get(l.to)!;
    const [up, down] = slots[a]!.row <= slots[b]!.row ? [a, b] : [b, a];
    const chain = [up];
    for (let r = slots[up]!.row + 1; r < slots[down]!.row; r++) {
      slots.push({ row: r, size: o.laneWidth });
      above.push([]);
      below.push([]);
      chain.push(slots.length - 1);
    }
    chain.push(down);
    if (slots[up]!.row !== slots[down]!.row) {
      for (let k = 1; k < chain.length; k++) {
        below[chain[k - 1]!]!.push(chain[k]!);
        above[chain[k]!]!.push(chain[k - 1]!);
      }
    }
    return chain;
  });

  // Order within the rows: start with the plan's order (lanes after the nodes), then barycenter sweeps, first from
  // the wanted items up, then back down.
  let byRow: number[][] = Array.from({ length: rows }, () => []);
  slots.forEach((s, i) => byRow[s.row]!.push(i));
  const pos = new Array<number>(slots.length).fill(0);
  const reindex = () => { for (const row of byRow) row.forEach((s, i) => { pos[s] = i; }); };
  reindex();
  const crossings = () => {
    let n = 0;
    for (let r = 0; r + 1 < rows; r++) {
      const segs: [number, number][] = [];
      for (const s of byRow[r]!) for (const t of below[s]!) segs.push([pos[s]!, pos[t]!]);
      for (let i = 0; i < segs.length; i++) {
        for (let j = i + 1; j < segs.length; j++) if ((segs[i]![0] - segs[j]![0]) * (segs[i]![1] - segs[j]![1]) < 0) n++;
      }
    }
    return n;
  };
  const reorder = (r: number, nb: number[][]) => {
    const row = byRow[r]!;
    const key = row.map((s, i) => (nb[s]!.length > 0 ? mean(nb[s]!.map(n => pos[n]!)) : i));
    const order = row.map((_, i) => i).sort((p, q) => key[p]! - key[q]! || p - q);
    byRow[r] = order.map(i => row[i]!);
    byRow[r]!.forEach((s, i) => { pos[s] = i; });
  };
  let best = byRow.map(r => [...r]);
  let fewest = crossings();
  // Equal counts take the later order: it has settled further.
  const keep = () => { const n = crossings(); if (n <= fewest) { fewest = n; best = byRow.map(r => [...r]); } };
  for (let k = 0; k < o.sweeps; k++) {
    for (let r = rows - 2; r >= 0; r--) reorder(r, below);
    keep();
    for (let r = 1; r < rows; r++) reorder(r, above);
    keep();
  }
  byRow = best;
  reindex();

  // Across: centred rows, then each slot as close to the mean of its neighbours as the order allows.
  const x = new Array<number>(slots.length).fill(0);
  const sep = (a: number, b: number) => slots[a]!.size / 2 + slots[b]!.size / 2 + (slots[a]!.node && slots[b]!.node ? o.columnGap : o.laneGap);
  const seps = (row: readonly number[]) => row.map((s, i) => (i > 0 ? sep(row[i - 1]!, s) : 0));
  for (const row of byRow) {
    const placed = pack(row.map(() => 0), seps(row));
    row.forEach((s, i) => { x[s] = placed[i]!; });
  }
  const place = (row: readonly number[], nb: number[][]) => {
    const placed = pack(row.map(s => (nb[s]!.length > 0 ? mean(nb[s]!.map(n => x[n]!)) : x[s]!)), seps(row));
    row.forEach((s, i) => { x[s] = placed[i]!; });
  };
  for (let k = 0; k < o.sweeps; k++) {
    for (let r = rows - 2; r >= 0; r--) place(byRow[r]!, below);
    for (let r = 1; r < rows; r++) place(byRow[r]!, above);
  }

  // Where the edges meet a node: spread over its side, in the order of where they come from. A same-row edge (a
  // loop, or a by-product for a neighbour) leaves and enters at the top.
  const sides = new Map<string, { link: number; other: number }[]>();
  const attach = (slot: number, side: Side, link: number, other: number) => {
    const key = `${slot}${side}`;
    const list = sides.get(key) ?? [];
    list.push({ link, other });
    sides.set(key, list);
  };
  links.forEach((_, k) => {
    const chain = chains[k]!;
    const up = chain[0]!;
    const down = chain[chain.length - 1]!;
    if (slots[up]!.row === slots[down]!.row) {
      attach(up, 't', k, x[down]!);
      attach(down, 't', k, x[up]!);
    } else {
      attach(up, 'b', k, x[chain[1]!]!);
      attach(down, 't', k, x[chain[chain.length - 2]!]!);
    }
  });
  const port = new Map<string, number>();
  for (const [key, list] of sides) {
    const slot = Number(key.slice(0, -1));
    list.sort((p, q) => p.other - q.other || p.link - q.link);
    const room = o.nodeWidth - 2 * INSET;
    const gap = list.length > 1 ? Math.min(o.portGap, room / (list.length - 1)) : 0;
    list.forEach((a, i) => port.set(`${a.link}:${key}`, x[slot]! + (i - (list.length - 1) / 2) * gap));
  }

  // The end with the arrowhead carries the label. Labels at one side are staggered in height where their ends
  // are closer than a label is wide.
  const labelled = links.map((l, k): { slot: number; side: Side } => {
    const chain = chains[k]!;
    const up = chain[0]!;
    const down = chain[chain.length - 1]!;
    const to = slotOf.get(l.to)!;
    if (slots[up]!.row === slots[down]!.row) return { slot: to, side: 't' };
    return to === down ? { slot: down, side: 't' } : { slot: up, side: 'b' };
  });
  const level = new Array<number>(links.length).fill(0);
  const levels = new Map<string, number>();
  const ends = new Map<string, number[]>();
  labelled.forEach((e, k) => {
    const key = `${e.slot}${e.side}`;
    ends.set(key, [...(ends.get(key) ?? []), k]);
  });
  for (const [key, list] of ends) {
    const px = (k: number) => port.get(`${k}:${key}`)!;
    list.sort((a, b) => px(a) - px(b) || a - b);
    let closest = Infinity;
    for (let i = 1; i < list.length; i++) closest = Math.min(closest, px(list[i]!) - px(list[i - 1]!));
    const n = list.length < 2 ? 1 : Math.min(list.length, Math.ceil((o.labelWidth + 4) / Math.max(closest, 1)));
    list.forEach((k, i) => { level[k] = i % n; });
    levels.set(key, n);
  }
  /** Length of the straight piece before the arrowhead, from the node's side, for a label at level `v`. */
  const stub = (v: number) => ARROW + 4 + (v + 1) * o.labelHeight;
  /** Distance of a label's centre from the node's side. */
  const labelOffset = (v: number) => ARROW + 2 + o.labelHeight / 2 + v * o.labelHeight;
  const room = (slot: number, side: Side) => {
    const n = levels.get(`${slot}${side}`) ?? 0;
    return n > 0 ? stub(n - 1) : 0;
  };

  // Heights: each row as low as the labels above it and the labels and curves between it and the row above need.
  const arcsIn = new Set(links.flatMap((_, k) => {
    const chain = chains[k]!;
    return slots[chain[0]!]!.row === slots[chain[chain.length - 1]!]!.row ? [slots[chain[0]!]!.row] : [];
  }));
  const nodesIn = (r: number) => byRow[r]!.filter(s => slots[s]!.node);
  const needTop = (r: number) => Math.max(0, ...nodesIn(r).map(s => room(s, 't')));
  const needBottom = (r: number) => Math.max(0, ...nodesIn(r).map(s => room(s, 'b')));
  const height = new Array<number>(rows).fill(0);
  for (const s of steps) {
    const r = rowOf.get(s.item)!;
    height[r] = Math.max(height[r]!, o.heights?.get(s.item) ?? o.nodeHeight);
  }
  const top: number[] = [];
  for (let r = 0; r < rows; r++) {
    top.push(r === 0
      ? needTop(0) + (arcsIn.has(0) ? o.rowGap : 0)
      : top[r - 1]! + height[r - 1]! + needBottom(r - 1) + o.rowGap + needTop(r));
  }
  const topOf = (s: number) => top[slots[s]!.row]!;
  const bottomOf = (s: number) => topOf(s) + height[slots[s]!.row]!;

  const edges = links.map((l, k) => {
    const chain = chains[k]!;
    const up = chain[0]!;
    const down = chain[chain.length - 1]!;
    const end = labelled[k]!;
    const v = level[k]!;
    const width = o.labelWidth;
    if (slots[up]!.row === slots[down]!.row) {
      // Same row: an arc out of the top and back into the top of the other node.
      const fromSlot = slotOf.get(l.from)!;
      const s = { x: port.get(`${k}:${fromSlot}t`)!, y: topOf(fromSlot) };
      const t = { x: port.get(`${k}:${end.slot}t`)!, y: topOf(end.slot) };
      const e = { x: t.x, y: t.y - stub(v) };
      const bulge = Math.min(o.rowGap - 8, 24 + Math.abs(s.x - t.x) / 4);
      const cy = e.y - bulge;
      return {
        link: l, points: [s, { x: (s.x + t.x) / 2, y: e.y - bulge * 0.75 }, e, t], arc: cy,
        label: { x: t.x, y: t.y - labelOffset(v), width },
      };
    }
    // Downwards: out of the bottom of the upper node, through the lanes, into the top of the lower node.
    const pts: Point[] = [{ x: port.get(`${k}:${up}b`)!, y: bottomOf(up) }];
    for (const lane of chain.slice(1, -1)) pts.push({ x: x[lane]!, y: topOf(lane) }, { x: x[lane]!, y: bottomOf(lane) });
    pts.push({ x: port.get(`${k}:${down}t`)!, y: topOf(down) });
    // A straight piece next to the arrowhead carries the label.
    let label: DiagramEdge['label'];
    if (end.slot === down) {
      const t = pts[pts.length - 1]!;
      pts.splice(pts.length - 1, 0, { x: t.x, y: t.y - stub(v) });
      label = { x: t.x, y: t.y - labelOffset(v), width };
    } else {
      // A by-product for a step further up: the arrow points up into the bottom of the upper node.
      const t = pts[0]!;
      pts.splice(1, 0, { x: t.x, y: t.y + stub(v) });
      pts.reverse();
      label = { x: t.x, y: t.y + labelOffset(v), width };
    }
    return { link: l, points: pts, arc: undefined, label };
  });

  // Everything into view, with the padding on the top and left too (labels may reach past the outer nodes).
  const nodeBoxes = byRow.flatMap(row => row.filter(s => slots[s]!.node).map(s => ({ s, x: x[s]! - o.nodeWidth / 2, y: topOf(s) })));
  const minX = Math.min(...nodeBoxes.map(b => b.x), ...edges.flatMap(e => [...e.points.map(p => p.x), e.label.x - e.label.width / 2]));
  const minY = Math.min(...nodeBoxes.map(b => b.y), ...edges.flatMap(e => [...e.points.map(p => p.y), e.label.y - o.labelHeight / 2, e.arc ?? Infinity]));
  const dx = o.padding - minX;
  const dy = o.padding - minY;
  const move = (p: Point): Point => ({ x: p.x + dx, y: p.y + dy });

  const nodes: DiagramNode[] = byRow.flatMap((row, r) => row.filter(s => slots[s]!.node).map((s, order) => ({
    item: slots[s]!.node!, row: r, order, x: x[s]! - o.nodeWidth / 2 + dx, y: topOf(s) + dy, width: o.nodeWidth, height: height[r]!,
  })));
  const out: DiagramEdge[] = edges.map(e => {
    const points = e.points.map(move);
    const label = { ...move(e.label), width: e.label.width };
    let path: string;
    if (e.arc !== undefined) {
      const [s, , end, t] = points as [Point, Point, Point, Point];
      const cy = r1(e.arc + dy);
      path = `M${r1(s.x)} ${r1(s.y)} C${r1(s.x)} ${cy} ${r1(end.x)} ${cy} ${r1(end.x)} ${r1(end.y)} L${r1(t.x)} ${r1(t.y)}`;
    } else path = curve(points);
    return { ...e.link, points, path, label };
  });

  const xs = [...nodes.map(n => n.x + n.width), ...out.flatMap(e => [...e.points.map(p => p.x), e.label.x + e.label.width / 2])];
  const ys = [...nodes.map(n => n.y + n.height), ...out.flatMap(e => [...e.points.map(p => p.y), e.label.y + o.labelHeight / 2])];
  return { nodes, edges: out, rows, width: Math.ceil(Math.max(...xs) + o.padding), height: Math.ceil(Math.max(...ys) + o.padding) };
}

/**
 * Where a diagram wider than its box starts (its `scrollLeft`), so the box shows whole nodes rather than the diagram's
 * left edge: of the top row's runs of neighbouring nodes that fit the box, the longest (then the one nearest the
 * diagram's middle) is centred; where not even one node fits, the node nearest the middle. 0 when the diagram fits.
 */
export function initialScroll(layout: Pick<DiagramLayout, 'nodes' | 'width'>, box: number): number {
  const top = layout.nodes.filter(n => n.row === 0).sort((a, b) => a.x - b.x);
  if (box <= 0 || layout.width <= box || top.length === 0) return 0;
  const middle = layout.width / 2;
  let best: { left: number; right: number; count: number } | null = null;
  for (let i = 0; i < top.length; i++) {
    for (let j = i; j < top.length; j++) {
      const left = top[i]!.x;
      const right = top[j]!.x + top[j]!.width;
      const count = j - i + 1;
      if (right - left > box && count > 1) break;
      const off = (r: { left: number; right: number }) => Math.abs((r.left + r.right) / 2 - middle);
      if (!best || count > best.count || (count === best.count && off({ left, right }) < off(best))) best = { left, right, count };
    }
  }
  const centre = (best!.left + best!.right) / 2;
  return Math.round(Math.min(Math.max(centre - box / 2, 0), layout.width - box));
}
