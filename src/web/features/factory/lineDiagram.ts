import type { LineEdge, LineGroup, LineRate, LogisticsKind, ProductionLine } from '../../../shared/factory/lines.js';
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
/** Width of an output or input node (`LineTerminal`) and of a storage, station or sink at an end of the line. */
export const TERMINAL_WIDTH = 208;

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
export function lineGraph(
  line: Pick<ProductionLine, 'groups' | 'edges'>,
  { byproducts = true, terminals = [], ends }: {
    byproducts?: boolean;
    /** Output and input nodes (`withTerminals`): inputs in a row of their own at the top, outputs in one at the bottom. */
    terminals?: readonly LineTerminal[];
    /** Storage, stations and sinks at an end (`lineEnds`), drawn as wide as an output node. */
    ends?: LineEnds;
  } = {},
): LineGraph {
  const stages = [...new Set(line.groups.map(g => g.stage))].sort((a, b) => a - b);
  const shift = terminals.some(t => t.side === 'in') ? 1 : 0;
  const rowOfStage = new Map(stages.map((s, i) => [s, i + shift]));
  const rows = new Map(line.groups.map(g => [g.id, rowOfStage.get(g.stage)!]));
  const last = Math.max(shift - 1, ...rows.values());
  for (const t of terminals) rows.set(t.id, t.side === 'in' ? 0 : last + 1);
  const byId = new Map(line.groups.map(g => [g.id, g]));
  const atEnd = (id: string) => Boolean(ends?.receivers.has(id) || ends?.sources.has(id));
  const nodes: GraphNode[] = [
    ...terminals.filter(t => t.side === 'in').map(t => ({ id: t.id, row: 0, width: TERMINAL_WIDTH })),
    ...line.groups.map(g => ({ id: g.id, row: rows.get(g.id)!, width: atEnd(g.id) ? TERMINAL_WIDTH : g.logistics ? LOGISTICS_WIDTH : NODE_WIDTH })),
    ...terminals.filter(t => t.side === 'out').map(t => ({ id: t.id, row: last + 1, width: TERMINAL_WIDTH })),
  ];
  const links: LineLink[] = [];
  line.edges.forEach((e, edge) => {
    if (!rows.has(e.from) || !rows.has(e.to) || e.from === e.to) return;
    const from = byId.get(e.from);
    const back = rows.get(e.to)! <= rows.get(e.from)!;
    const byproduct = from !== undefined && !from.logistics && e.item !== undefined && from.outputs.length > 1 && mainOutput(from) !== e.item;
    // A by-product leaving the line stays: folding it would cut its output node off.
    if (byproduct && !back && !byproducts && !isTerminal(e.to)) return;
    links.push({ from: e.from, to: e.to, edge, kind: back ? 'loop' : byproduct ? 'byproduct' : 'flow' });
  });
  return { nodes, links, rows };
}

/**
 * Where the line's items end up or come from, as nodes of their own: an output ("Ausgang", `out:<item>`) for each
 * product (`ProductionLine.products`) with the storage, stations and sinks taking it and the part that has no belt or
 * pipe at all; an input ("Eingang", `in:<item>`) for what storage or stations at the start give.
 */
export interface LineTerminal {
  /** Node id: `out:<item>` or `in:<item>` (group ids are building ids, so they never clash). */
  id: string;
  side: 'in' | 'out';
  item: string;
  /** Per minute: an output the line's product (the whole of it), an input what its places give. */
  perMin: number;
  fluid?: boolean;
  /** The storage, stations and sinks taking it (outputs) or giving it (inputs), most first. */
  places: TerminalPlace[];
  /** Outputs: the part per minute with no belt or pipe to leave by ("not connected"), and the machine groups making it. */
  unlinked: number;
  makers: string[];
}

/** A storage, station or sink at an end of the line (one of its groups) with what it takes or gives of one item. */
export interface TerminalPlace { group: string; cls: string; kind?: LogisticsKind; members: string[]; perMin: number }

/** The id of an output or input node. */
export const terminalId = (side: LineTerminal['side'], item: string) => `${side}:${item}`;
/** An output or input node, not a group of the line. */
export const isTerminal = (id: string) => id.startsWith('out:') || id.startsWith('in:');
/** A drawn connection from a machine to its output that no belt or pipe carries ("not connected"). */
export const isUnlinked = (e: Pick<LineEdge, 'links'>) => e.links === 0;

/** Two lists of rates added up per item, most first. */
function sumRates(a: readonly LineRate[], b: readonly LineRate[]): LineRate[] {
  const sum = new Map<string, LineRate>();
  for (const r of [...a, ...b]) sum.set(r.item, { ...r, perMin: (sum.get(r.item)?.perMin ?? 0) + r.perMin });
  return [...sum.values()].sort((x, y) => y.perMin - x.perMin);
}

/** The items on an edge with their flow: its `items` when it carries several, else its one item (none without one). */
export function edgeItems(e: Pick<LineEdge, 'item' | 'items' | 'perMin'>): LineRate[] {
  if (e.items && e.items.length > 0) return e.items;
  return e.item !== undefined ? [{ item: e.item, perMin: e.perMin ?? 0 }] : [];
}

/**
 * The line's ends: storage, stations and sinks (any logistics group that does not just pass items on) where items
 * only arrive (`receivers`; a station or sink also when it sends some on) or only leave (`sources`).
 */
export interface LineEnds { receivers: ReadonlySet<string>; sources: ReadonlySet<string> }

export function lineEnds(line: Pick<ProductionLine, 'groups' | 'edges'>): LineEnds {
  const ins = new Set(line.edges.map(e => e.to));
  const outs = new Set(line.edges.map(e => e.from));
  const receivers = new Set<string>(), sources = new Set<string>();
  for (const g of line.groups) {
    if (!g.logistics || passesThrough(g)) continue;
    if (ins.has(g.id) && (!outs.has(g.id) || g.kind === 'station' || g.kind === 'sink')) receivers.add(g.id);
    else if (outs.has(g.id) && !ins.has(g.id)) sources.add(g.id);
  }
  return { receivers, sources };
}

/** What arrives at a group (`in`) or leaves it (`out`) per item over the line's edges, most first. */
export function flowsAt(line: Pick<ProductionLine, 'edges'>, id: string, side: 'in' | 'out'): LineRate[] {
  const sum = new Map<string, LineRate>();
  for (const e of line.edges) {
    if ((side === 'in' ? e.to : e.from) !== id) continue;
    for (const r of edgeItems(e)) {
      const old = sum.get(r.item);
      sum.set(r.item, { ...r, ...(e.pipe ? { fluid: true } : {}), perMin: (old?.perMin ?? 0) + r.perMin });
    }
  }
  return [...sum.values()].sort((a, b) => b.perMin - a.perMin);
}

/**
 * Every output and input of a line, read from the line with all its logistics (`compactLine`'s): outputs in the order
 * of its products (then whatever else reaches its ends), each with the ends taking it and the part with no way out
 * (the product less what reaches its ends; credited to its makers without a belt or pipe for it, else to all of them);
 * inputs from the storage and stations at its start. Nothing below `IDLE_FLOW`.
 */
export function lineTerminals(line: ProductionLine): LineTerminal[] {
  const { receivers, sources } = lineEnds(line);
  const byId = new Map(line.groups.map(g => [g.id, g]));
  // Storage that also sends items on can still be where a product goes (a storage the line was cut at, `buildLines`).
  const through = throughGroups(line);
  const buffers = new Set(line.groups.filter(g => through.has(g.id) && !passesThrough(g) && !receivers.has(g.id)).map(g => g.id));
  const placesOf = (ids: ReadonlySet<string>, side: 'in' | 'out') => {
    const per = new Map<string, TerminalPlace[]>();
    const fluid = new Set<string>();
    for (const id of ids) {
      const g = byId.get(id)!;
      for (const r of flowsAt(line, id, side === 'out' ? 'in' : 'out')) {
        if (r.perMin < IDLE_FLOW) continue;
        if (r.fluid) fluid.add(r.item);
        per.set(r.item, [...(per.get(r.item) ?? []), { group: id, cls: g.cls, ...(g.kind ? { kind: g.kind } : {}), members: g.members, perMin: r.perMin }]);
      }
    }
    for (const list of per.values()) list.sort((a, b) => b.perMin - a.perMin);
    return { per, fluid };
  };
  const total = (list: readonly TerminalPlace[] | undefined) => (list ?? []).reduce((s, p) => s + p.perMin, 0);
  const out = placesOf(receivers, 'out');
  const buffered = placesOf(buffers, 'out');
  const items = [...line.products.filter(p => p.perMin >= IDLE_FLOW).map(p => p.item)];
  for (const [item, list] of [...out.per].sort((a, b) => total(b[1]) - total(a[1]))) if (!items.includes(item) && total(list) >= IDLE_FLOW) items.push(item);
  const outputs = items.map((item): LineTerminal => {
    const product = line.products.find(p => p.item === item);
    let places = out.per.get(item) ?? [];
    // More of the product than reaches the ends: it went into storage on the way.
    if (product && product.perMin - total(places) >= IDLE_FLOW) places = [...places, ...(buffered.per.get(item) ?? [])];
    const perMin = product?.perMin ?? total(places);
    const rest = perMin - total(places);
    const makers = line.groups.filter(g => !g.logistics && g.outputs.some(o => o.item === item && o.perMin > 0));
    // The part without a way out comes from makers with no belt or pipe for it, where there are such (at most what they make).
    const loose = makers.filter(g => !line.edges.some(e => e.from === g.id && edgeItems(e).some(r => r.item === item)));
    const looseMade = loose.reduce((s, g) => s + (g.outputs.find(o => o.item === item)?.perMin ?? 0), 0);
    const unlinked = rest < IDLE_FLOW ? 0 : loose.length > 0 ? Math.min(rest, looseMade) : rest;
    const fluid = product?.fluid ?? (out.fluid.has(item) || undefined);
    return {
      id: terminalId('out', item), side: 'out', item, perMin, ...(fluid ? { fluid } : {}), places, unlinked,
      makers: (unlinked > 0 && loose.length > 0 ? loose : makers).map(g => g.id),
    };
  });
  const inp = placesOf(sources, 'in');
  const inputs = [...inp.per].map(([item, places]): LineTerminal => {
    const given = line.inputs.find(r => r.item === item);
    const fluid = given?.fluid ?? (inp.fluid.has(item) || undefined);
    return { id: terminalId('in', item), side: 'in', item, perMin: total(places), ...(fluid ? { fluid } : {}), places, unlinked: 0, makers: [] };
  }).filter(t => t.perMin >= IDLE_FLOW).sort((a, b) => b.perMin - a.perMin);
  return [...inputs, ...outputs];
}

/**
 * The line as the diagram draws it, with its outputs and inputs (`lineTerminals` of `base`, the line with all its
 * logistics):
 * - all logistics (`onlyMachines` false): storage, stations and sinks stay as they are (the page draws those at an end
 *   as outputs and inputs); only what has no belt or pipe gets an output node, with a connection from its makers;
 * - machines only: the storage, stations and sinks at the ends make way for one output node per item (where it goes,
 *   how much) and one input node per item coming in; the edges into them are added up per maker and item (a belt
 *   carrying several items is split by item, without a capacity of its own then). The bottleneck follows its edge.
 */
export function withTerminals(base: ProductionLine, shown: ProductionLine, onlyMachines: boolean): { line: ProductionLine; terminals: LineTerminal[] } {
  const all = lineTerminals(base);
  const kept = new Set(shown.groups.map(g => g.id));
  const outputOf = new Map(all.filter(t => t.side === 'out').map(t => [t.item, t]));
  const unlinkedEdges = (terminals: readonly LineTerminal[]): LineEdge[] => terminals.flatMap(t => {
    if (t.unlinked <= 0) return [];
    const makers = t.makers.filter(id => kept.has(id)).map(id => shown.groups.find(g => g.id === id)!);
    const made = makers.map(g => g.outputs.find(o => o.item === t.item)?.perMin ?? 0);
    const sum = made.reduce((a, b) => a + b, 0);
    return makers.map((g, i): LineEdge => ({
      from: g.id, to: t.id, item: t.item, perMin: t.unlinked * (sum > 0 ? made[i]! / sum : 1 / makers.length), links: 0, via: [],
      ...(t.fluid ? { pipe: true } : {}),
    }));
  });
  if (!onlyMachines) {
    const terminals = all.filter(t => t.side === 'out' && t.unlinked > 0).map(t => ({ ...t, perMin: t.unlinked, places: [] }));
    return { line: { ...shown, edges: [...shown.edges, ...unlinkedEdges(terminals)] }, terminals };
  }
  const { receivers, sources } = lineEnds(shown);
  const merged = new Map<string, LineEdge>();
  const marked = shown.bottleneck?.kind === 'edge' ? shown.edges[shown.bottleneck.edge] : undefined;
  let neck: LineEdge | string | undefined = marked;
  const add = (from: string, to: string, e: LineEdge, part: LineRate, whole: boolean) => {
    const key = `${from}>${to}`;
    const old = merged.get(key);
    const own: LineEdge = {
      from, to, item: part.item, perMin: part.perMin, links: e.links, via: e.via, ...(e.pipe ? { pipe: true } : {}),
      // A belt carrying several items has no capacity of its own for one of them.
      ...(whole ? {
        ...(e.capacity !== undefined ? { capacity: e.capacity } : {}), ...(e.perLink !== undefined ? { perLink: e.perLink } : {}),
        ...(e.slowest ? { slowest: e.slowest } : {}), ...(e.saturated ? { saturated: true } : {}), ...(e.exact ? { exact: true } : {}),
      } : {}),
    };
    merged.set(key, old ? {
      ...old, perMin: (old.perMin ?? 0) + part.perMin, links: old.links + e.links, via: [...old.via, ...e.via],
      ...(old.capacity !== undefined && own.capacity !== undefined ? { capacity: old.capacity + own.capacity } : { capacity: undefined }),
      ...(old.perLink !== undefined && old.perLink === own.perLink ? {} : { perLink: undefined }),
      saturated: Boolean(old.saturated && own.saturated), exact: Boolean(old.saturated && own.saturated && old.exact && own.exact),
    } : own);
    if (e === marked) neck = key;
  };
  const edges: LineEdge[] = [];
  for (const e of shown.edges) {
    const into = receivers.has(e.to), outOf = sources.has(e.from);
    if (into && (outOf || receivers.has(e.from))) continue;
    if (!into && !outOf) { edges.push(e); continue; }
    const parts = edgeItems(e);
    for (const part of parts) {
      if (into && outputOf.has(part.item)) add(e.from, terminalId('out', part.item), e, part, parts.length === 1);
      else if (outOf && !into && part.perMin >= IDLE_FLOW) add(terminalId('in', part.item), e.to, e, part, parts.length === 1);
    }
  }
  // What reaches an output's places through storage the diagram left out (storage on the way): from its makers, by
  // what each makes (with no capacity of its own then).
  for (const x of all) {
    if (x.side !== 'out' || x.places.length === 0) continue;
    const drawn = [...merged.values()].filter(e => e.to === x.id).reduce((s, e) => s + (e.perMin ?? 0), 0);
    const missing = x.perMin - x.unlinked - drawn;
    if (missing < IDLE_FLOW) continue;
    const makers = shown.groups.filter(g => !g.logistics && g.outputs.some(o => o.item === x.item && o.perMin > 0));
    const made = makers.map(g => g.outputs.find(o => o.item === x.item)!.perMin);
    const sum = made.reduce((a, b) => a + b, 0);
    makers.forEach((g, i) => {
      const key = `${g.id}>${x.id}`;
      const old = merged.get(key);
      const perMin = missing * made[i]! / sum;
      merged.set(key, old
        ? { ...old, perMin: (old.perMin ?? 0) + perMin, capacity: undefined, perLink: undefined, saturated: false, exact: false }
        : { from: g.id, to: x.id, item: x.item, perMin, links: 1, via: [], ...(x.fluid ? { pipe: true } : {}) });
    });
  }
  const linked = new Set([...merged.values()].map(e => (isTerminal(e.from) ? e.from : e.to)));
  // Every output stays (it is what the line makes); an input only with a connection into the line.
  const terminals = all.filter(t => t.side === 'out' || linked.has(t.id));
  const groups = shown.groups.filter(g => !receivers.has(g.id) && !sources.has(g.id));
  const allEdges = [...edges, ...merged.values(), ...unlinkedEdges(terminals)];
  const neckEdge = typeof neck === 'string' ? merged.get(neck) : neck;
  const b = shown.bottleneck;
  const bottleneck = b?.kind === 'edge'
    ? (neckEdge && allEdges.includes(neckEdge) ? { ...b, edge: allEdges.indexOf(neckEdge) } : undefined)
    : b && groups.some(g => g.id === b.group) ? b : undefined;
  return { line: { ...shown, groups, edges: allEdges, bottleneck }, terminals };
}

/**
 * Where the line's products go, for the summary above the diagram: its ends taking them by building class (a station
 * by its own id, so it can be named), with how many there are, and whether some of it has no belt or pipe at all.
 */
export function lineTargets(terminals: readonly LineTerminal[]): { places: { cls: string; group?: string; count: number }[]; unlinked: boolean } {
  const groups = new Map<string, TerminalPlace>();
  for (const t of terminals) if (t.side === 'out') for (const p of t.places) groups.set(p.group, p);
  const byKey = new Map<string, { cls: string; group?: string; count: number }>();
  for (const p of groups.values()) {
    const key = p.kind === 'station' ? p.group : p.cls;
    const old = byKey.get(key);
    byKey.set(key, { cls: p.cls, ...(p.kind === 'station' ? { group: p.group } : {}), count: (old?.count ?? 0) + p.members.length });
  }
  return { places: [...byKey.values()].sort((a, b) => b.count - a.count), unlinked: terminals.some(t => t.side === 'out' && t.unlinked > 0) };
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
 * what each of them makes of it (a belt carrying several items item by item). Capacity and fullness are those of the last belt or pipe into the group (parallel ones
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
  /** Adds an edge from a kept group; `items`: its part of a belt carrying several items (split per item). */
  const add = (from: string, e: LineEdge, share: number, items?: LineRate[]) => {
    const perMin = items ? items.reduce((s, r) => s + r.perMin, 0) : e.perMin !== undefined ? e.perMin * share : undefined;
    const own: LineEdge = {
      ...e, from, ...(perMin !== undefined ? { perMin } : {}),
      ...(items ? { item: items[0]!.item, items: items.length > 1 ? items : undefined } : {}),
    };
    const key = `${from}>${e.to}>${own.item ?? ''}`;
    const old = merged.get(key);
    if (!old) {
      merged.set(key, own);
      return key;
    }
    const mixed = (old.items?.length ?? 0) > 1 || (own.items?.length ?? 0) > 1;
    merged.set(key, {
      ...old,
      ...(old.perMin !== undefined || perMin !== undefined ? { perMin: (old.perMin ?? 0) + (perMin ?? 0) } : {}),
      ...(mixed ? { items: sumRates(edgeItems(old), edgeItems(own)) } : {}),
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
    /** Each source's share of an item: by what it makes of it, evenly when none of them makes it. */
    const shares = (item: string | undefined) => {
      const weights = from.map(id => makes(id, item));
      const total = weights.reduce((a, b) => a + b, 0);
      return weights.map(w => (total > 0 ? w / total : 1 / from.length));
    };
    if (e.items && e.items.length > 1) {
      // A belt carrying several items: each item goes back to the sources making it.
      const per = e.items.map(r => shares(r.item));
      from.forEach((id, i) => {
        const items = e.items!.map((r, k) => ({ ...r, perMin: r.perMin * per[k]![i]! })).filter(r => r.perMin > 0).sort((a, b) => b.perMin - a.perMin);
        if (items.length > 0) add(id, e, 1, items);
      });
      continue;
    }
    const share = shares(e.item);
    from.forEach((id, i) => add(id, e, share[i]!));
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
