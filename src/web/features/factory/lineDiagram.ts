import type { LineEdge, LineGroup, ProductionLine } from '../../../shared/factory/lines.js';
import { worldPath } from '../../app/pages.js';
import type { GraphLink, GraphNode } from '../planner/diagramLayout.js';

/**
 * A production line (`src/shared/factory/lines.ts`) as a graph for the planner's top-down layout (`layoutGraph`): one
 * node per group in the row of its stage, one link per edge. Pure.
 */

/** The query parameter that opens a line on the factory page: `/w/<id>/factory?line=<line id>`. */
export const LINE_PARAM = 'line';

/** The factory page with one production line open (its diagram); the map's "As diagram" leads here. */
export function linePath(worldId: string, lineId: string): string {
  return `${worldPath(worldId, 'factory')}?${LINE_PARAM}=${encodeURIComponent(lineId)}`;
}

/** Widths of the diagram's nodes: machine groups, and the narrower logistics nodes (splitters, mergers, storage, stations). */
export const NODE_WIDTH = 236;
export const LOGISTICS_WIDTH = 172;

/** From here a belt or pipe counts as full (`LineEdge.saturated` says the same, ≥ 95 %). */
export const SATURATED_FROM = 0.95;

/** Above this many groups (after `compactLine`) a line opens with only its machines (`machinesOnly`). */
export const MACHINES_ONLY_ABOVE = 30;

/**
 * How an edge is drawn: `flow` down the line, `byproduct` an item its source makes besides its main product (dotted,
 * like the planner's), `loop` back to the same or an earlier stage (dashed, like the planner's loops).
 */
export type LineLinkKind = 'flow' | 'byproduct' | 'loop';

export interface LineLink extends GraphLink {
  /** Index in `ProductionLine.edges`. */
  edge: number;
  kind: LineLinkKind;
}

export interface LineGraph {
  nodes: GraphNode[];
  links: LineLink[];
  /** Group id → row (the stages without gaps, 0 at the top). */
  rows: ReadonlyMap<string, number>;
}

/** Load of a connection (flow / capacity), or null when either is unknown. */
export function loadOf(e: Pick<LineEdge, 'perMin' | 'capacity'>): number | null {
  if (e.perMin === undefined || !e.capacity || e.capacity <= 0) return null;
  return e.perMin / e.capacity;
}

/** Full: the line says so, or the flow is at least 95 % of the capacity. */
export function isSaturated(e: Pick<LineEdge, 'perMin' | 'capacity' | 'saturated'>): boolean {
  if (e.saturated !== undefined) return e.saturated;
  const load = loadOf(e);
  return load !== null && load >= SATURATED_FROM;
}

/** The item a group makes first (its main product), if any. */
export const mainOutput = (g: Pick<LineGroup, 'outputs'>): string | undefined => g.outputs[0]?.item;

/**
 * The line as a graph: rows are the groups' stages without gaps (extractors and inputs at the top); within a row the
 * groups keep the line's order. Edges to an unknown group or from a group to itself are left out, and by-product
 * links too with `byproducts: false` (folded on large lines).
 */
export function lineGraph(line: Pick<ProductionLine, 'groups' | 'edges'>, { byproducts = true }: { byproducts?: boolean } = {}): LineGraph {
  const stages = [...new Set(line.groups.map(g => g.stage))].sort((a, b) => a - b);
  const rowOfStage = new Map(stages.map((s, i) => [s, i]));
  const rows = new Map(line.groups.map(g => [g.id, rowOfStage.get(g.stage)!]));
  const byId = new Map(line.groups.map(g => [g.id, g]));
  const nodes: GraphNode[] = line.groups.map(g => ({ id: g.id, row: rows.get(g.id)!, width: g.logistics ? LOGISTICS_WIDTH : NODE_WIDTH }));
  const links: LineLink[] = [];
  line.edges.forEach((e, edge) => {
    const from = byId.get(e.from);
    if (!from || !byId.has(e.to) || e.from === e.to) return;
    const back = rows.get(e.to)! <= rows.get(e.from)!;
    const byproduct = !from.logistics && e.item !== undefined && from.outputs.length > 1 && mainOutput(from) !== e.item;
    if (byproduct && !back && !byproducts) return;
    links.push({ from: e.from, to: e.to, edge, kind: back ? 'loop' : byproduct ? 'byproduct' : 'flow' });
  });
  return { nodes, links, rows };
}

/** Logistics that only pass items on (pumps, valves, junctions, splitters, mergers), by class or by the line's kind. */
const PASS_THROUGH = /^(Build_(PipelinePump|Valve|PipelineJunction|ConveyorAttachment(Splitter|Merger))|(splitter|merger|junction|pump|valve)$)/;
const PASS_KINDS: ReadonlySet<string> = new Set(['splitter', 'merger', 'junction', 'pump', 'valve']);

/** A logistics group that only passes items on: by its `kind`, else by its class. */
export const passesThrough = (g: Pick<LineGroup, 'logistics' | 'cls' | 'kind'>): boolean =>
  Boolean(g.logistics) && (g.kind ? PASS_KINDS.has(g.kind) : PASS_THROUGH.test(g.cls));

/**
 * The line as the diagram draws it: a pass-through logistics group (a pump, valve, junction, splitter or merger) with
 * exactly one way in and one way out of the same item adds nothing to the picture, so its two edges become one (the
 * flow going out, the smaller capacity and its belt or pipe, full when either was; chains of them in one go). The
 * bottleneck follows its edge. `hidden` counts the groups left out.
 */
export function compactLine(line: ProductionLine): { line: ProductionLine; hidden: number } {
  let groups = line.groups;
  let edges = [...line.edges];
  const marked = line.bottleneck?.kind === 'edge' ? line.edges[line.bottleneck.edge] : undefined;
  let bottleneckEdge = marked;
  let hidden = 0;
  for (;;) {
    const g = groups.find(x => {
      if (!passesThrough(x)) return false;
      const ins = edges.filter(e => e.to === x.id);
      const outs = edges.filter(e => e.from === x.id);
      return ins.length === 1 && outs.length === 1 && ins[0]!.from !== x.id && (ins[0]!.item === undefined || outs[0]!.item === undefined || ins[0]!.item === outs[0]!.item);
    });
    if (!g) break;
    const a = edges.find(e => e.to === g.id)!;
    const b = edges.find(e => e.from === g.id)!;
    const narrow = a.capacity !== undefined && (b.capacity === undefined || a.capacity < b.capacity) ? a : b;
    const merged: LineEdge = {
      from: a.from, to: b.to, links: Math.max(a.links, b.links), via: [...a.via, ...b.via],
      ...(b.item ?? a.item ? { item: b.item ?? a.item } : {}),
      ...(b.perMin ?? a.perMin) !== undefined ? { perMin: b.perMin ?? a.perMin } : {},
      ...(narrow.capacity !== undefined ? { capacity: narrow.capacity } : {}),
      ...(narrow.perLink !== undefined ? { perLink: narrow.perLink } : {}),
      ...(narrow.slowest ? { slowest: narrow.slowest } : {}),
      ...(a.pipe || b.pipe ? { pipe: true } : {}),
      ...(a.saturated || b.saturated ? { saturated: true } : {}),
      // Full and just enough only when every full part of it is.
      ...((a.saturated || b.saturated) && (!a.saturated || a.exact) && (!b.saturated || b.exact) ? { exact: true } : {}),
    };
    if (bottleneckEdge === a || bottleneckEdge === b) bottleneckEdge = merged;
    edges = edges.filter(e => e !== a && e !== b);
    edges.push(merged);
    groups = groups.filter(x => x !== g);
    hidden++;
  }
  if (hidden === 0) return { line, hidden };
  const bottleneck = line.bottleneck?.kind === 'edge'
    ? (bottleneckEdge ? { kind: 'edge' as const, edge: edges.indexOf(bottleneckEdge), why: line.bottleneck.why } : undefined)
    : line.bottleneck;
  return { line: { ...line, groups, edges, bottleneck }, hidden };
}

/**
 * The logistics groups items pass through on their way in the line: those with edges both in and out (splitters,
 * mergers, pumps, but also fluid buffers and storage between machines). Where items only enter or leave (a storage at
 * the end, a station, a sink) is not among them.
 */
export function throughGroups(line: Pick<ProductionLine, 'groups' | 'edges'>): Set<string> {
  const ins = new Set(line.edges.map(e => e.to));
  const outs = new Set(line.edges.map(e => e.from));
  return new Set(line.groups.filter(g => g.logistics && ins.has(g.id) && outs.has(g.id)).map(g => g.id));
}

/**
 * Only the machines (and where items enter or leave: storage at an end, stations, sinks, unless all their belts carry
 * next to nothing): every logistics group items pass through (`throughGroups`) is left out, and an edge from one into a kept group becomes an edge
 * from each kept group upstream of it that makes the item (through other such groups), the flow split by
 * what each of them makes of it. Capacity and fullness are those of the last belt or pipe into the group (parallel ones
 * added up). A bottleneck edge between two kept groups stays marked. The flows over a manifold are therefore an
 * estimate: the save does not say which machine's items took which way.
 */
export function machinesOnly(line: ProductionLine): ProductionLine {
  const byId = new Map(line.groups.map(g => [g.id, g]));
  const through = throughGroups(line);
  const pass = (id: string) => through.has(id);
  const into = new Map<string, LineEdge[]>();
  for (const e of line.edges) into.set(e.to, [...(into.get(e.to) ?? []), e]);
  /** Kept groups upstream of a pass-through group, through pass-through groups only. */
  const sources = (id: string): string[] => {
    const seen = new Set([id]);
    const out = new Set<string>();
    const queue = [id];
    while (queue.length > 0) {
      for (const e of into.get(queue.shift()!) ?? []) {
        if (seen.has(e.from)) continue;
        seen.add(e.from);
        if (pass(e.from)) queue.push(e.from); else if (byId.has(e.from)) out.add(e.from);
      }
    }
    return [...out];
  };
  const makes = (id: string, item: string | undefined) => {
    const g = byId.get(id)!;
    if (item === undefined) return 1;
    return g.outputs.find(o => o.item === item)?.perMin ?? 0;
  };
  const merged = new Map<string, LineEdge>();
  const marked = line.bottleneck?.kind === 'edge' ? line.edges[line.bottleneck.edge] : undefined;
  let bottleneckKey: string | undefined;
  const add = (from: string, e: LineEdge, share: number) => {
    const key = `${from}>${e.to}>${e.item ?? ''}`;
    const old = merged.get(key);
    const perMin = e.perMin !== undefined ? e.perMin * share : undefined;
    if (!old) {
      merged.set(key, { ...e, from, ...(perMin !== undefined ? { perMin } : {}) });
      return key;
    }
    merged.set(key, {
      ...old,
      ...(old.perMin !== undefined || perMin !== undefined ? { perMin: (old.perMin ?? 0) + (perMin ?? 0) } : {}),
      ...(old.capacity !== undefined || e.capacity !== undefined ? { capacity: (old.capacity ?? 0) + (e.capacity ?? 0) } : {}),
      links: old.links + e.links, via: [...old.via, ...e.via], saturated: Boolean(old.saturated && e.saturated),
      exact: Boolean(old.saturated && e.saturated && old.exact && e.exact),
      ...(old.perLink !== undefined && old.perLink === e.perLink ? {} : { perLink: undefined }),
    });
    return key;
  };
  for (const e of line.edges) {
    if (pass(e.to) || !byId.has(e.to) || !byId.has(e.from)) continue;
    if (!pass(e.from)) {
      const key = add(e.from, e, 1);
      if (e === marked) bottleneckKey = key;
      continue;
    }
    const from = sources(e.from).filter(id => id !== e.to);
    if (from.length === 0) continue;
    const weights = from.map(id => makes(id, e.item));
    const total = weights.reduce((a, b) => a + b, 0);
    from.forEach((id, i) => add(id, e, total > 0 ? weights[i]! / total : 1 / from.length));
  }
  // Storage and stations at an end whose belts all carry next to nothing add only empty boxes: left out too.
  const neck = line.bottleneck?.kind === 'group' ? line.bottleneck.group : undefined;
  const all = [...merged.values()];
  const live = (id: string) => all.some(e => (e.from === id || e.to === id) && (e.perMin ?? 0) >= IDLE_FLOW);
  const groups = line.groups.filter(g => !through.has(g.id) && (!g.logistics || g.id === neck || live(g.id)));
  const kept = new Set(groups.map(g => g.id));
  const edges = all.filter(e => kept.has(e.from) && kept.has(e.to));
  const neckEdge = bottleneckKey ? merged.get(bottleneckKey) : undefined;
  const bottleneck = line.bottleneck?.kind === 'edge'
    ? (neckEdge && edges.includes(neckEdge) ? { kind: 'edge' as const, edge: edges.indexOf(neckEdge), why: line.bottleneck.why } : undefined)
    : line.bottleneck && kept.has(line.bottleneck.group) ? line.bottleneck : undefined;
  return { ...line, groups, edges, bottleneck };
}

/** Below this flow per minute a belt carries nothing worth drawing (`machinesOnly` leaves out ends with only such). */
export const IDLE_FLOW = 0.05;

/** The line's groups top down (by row, then in the line's order): the list a phone shows. */
export function groupsTopDown(line: Pick<ProductionLine, 'groups'>): LineGroup[] {
  return line.groups.map((g, i) => ({ g, i })).sort((a, b) => a.g.stage - b.g.stage || a.i - b.i).map(x => x.g);
}

/** The edge or group the line names as its bottleneck. */
export function bottleneckOf(line: Pick<ProductionLine, 'bottleneck' | 'edges'>): { edge?: LineEdge; edgeIndex?: number; group?: string } {
  const b = line.bottleneck;
  if (!b) return {};
  if (b.kind === 'edge') return { edge: line.edges[b.edge], edgeIndex: b.edge };
  return { group: b.group };
}
