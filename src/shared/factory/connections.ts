import { readBool, shortName } from '../extract.js';
import type { FactoryObject } from './extract.js';
import type { SnapshotCircuit, SnapshotLink } from './snapshot.js';

/*
 * Save → `FactorySnapshot.links` and `circuits`. Checked against the 1.2 saves of two worlds (parser 4.1.2):
 *
 * - Belts: every port is an `FGFactoryConnectionComponent` (instance `<building>.<port>`) whose `mConnectedComponent`
 *   names the port at the other end; both ends store it. Belts and lifts have `ConveyorAny0` (where items enter) and
 *   `ConveyorAny1` (where they leave). Machines, splitters, mergers, storage and stations have `Input*`/`Output*`;
 *   splitters and mergers on lifts `TopConnection`/`BottomConnection`, whose direction is the lift end they meet.
 *   Supports (`SnapOnly0`) connect nothing.
 * - Pipes: `FGPipeConnectionComponent` (pipes `PipelineConnection0/1`, junctions `Connection0..3`, pumps and valves
 *   `Connection0` in / `Connection1` out, fluid buffers `ConnectionAny0/1`) and `FGPipeConnectionFactory` on machines
 *   (`PipeInputFactory*`, `PipeOutputFactory*`; extractors and generators have one port named
 *   `FGPipeConnectionFactory`). Pipes have no direction in the save; see `orientPipes`. `mPipeNetworkID` on a port
 *   names its network; `FGPipeNetwork.mFluidDescriptor` the fluid in it (saved only for some networks).
 * - Items on belts: `FGConveyorChainActor*` (special properties): `beltsInChain` with each belt's or lift's
 *   `startsAtLength`/`endsAtLength` along the chain and `items` with their `position` on the same scale.
 * - Power: `FGPowerCircuit` (`mCircuitID`, `mComponents` = power connection ports, `mIsFuseTriggered`).
 */

type Prop = { value?: unknown; values?: unknown; flags?: number };

const FACTORY_PORT = '/Script/FactoryGame.FGFactoryConnectionComponent';
const PIPE_PORTS = new Set(['/Script/FactoryGame.FGPipeConnectionComponent', '/Script/FactoryGame.FGPipeConnectionFactory']);
const CHAIN = /^\/Script\/FactoryGame\.FGConveyorChainActor/;
const PIPE_NETWORK = '/Script/FactoryGame.FGPipeNetwork';
const CIRCUIT = '/Script/FactoryGame.FGPowerCircuit';

/** Belts and lifts with their tier (the Mk number in the class name). */
const CONVEYOR = /^Build_Conveyor(?:Belt|Lift)Mk(\d+)_C$/;
/** Pipelines: `Build_Pipeline_C` (Mk.1), `Build_PipelineMK2_C`, and their clean variants. */
const PIPELINE = /^Build_Pipeline(MK2)?(?:_NoIndicator)?_C$/;
/** Machines whose single fluid port (`FGPipeConnectionFactory`) is an output: extractors. Other such ports are inputs. */
const FLUID_EXTRACTOR = /^Build_(WaterPump|OilPump|FrackingExtractor)_C$/;
const PUMP_OR_VALVE = /^Build_(PipelinePump(Mk2)?|Valve)_C$/;
/** Power poles, wall outlets and towers only carry the grid; they are left out of `circuits`. */
const POLE = /^Build_Power(Pole|Tower)/;

/** Longest walk along belts or pipes (guards against a corrupt save with a cycle of belts). */
const MAX_HOPS = 10_000;

const ownerOf = (port: string) => port.slice(0, port.lastIndexOf('.'));
const portOf = (port: string) => port.slice(port.lastIndexOf('.') + 1);

function refPath(v: unknown): string | null {
  const p = (v as { pathName?: unknown } | undefined)?.pathName;
  return typeof p === 'string' && p !== '' ? p : null;
}
const num = (p: Prop | undefined) => (typeof p?.value === 'number' && Number.isFinite(p.value) ? p.value : undefined);

export interface Connections {
  links: SnapshotLink[];
  circuits: SnapshotCircuit[];
}

/**
 * The belt and pipe links between the snapshot's buildings and the power circuits. `buildings` are the snapshot's
 * building ids; links whose ends are not among them (or that end in a loose belt) are left out.
 */
export function readConnections(objects: readonly FactoryObject[], buildings: ReadonlySet<string>): Connections {
  const classOf = new Map<string, string>();
  const belt = new Map<string, string>();
  const pipe = new Map<string, string>();
  const netOf = new Map<string, number>();
  const fluidOf = new Map<number, string>();
  const chains: FactoryObject[] = [];
  const circuitObjs: FactoryObject[] = [];
  for (const o of objects) {
    const tp = o.typePath ?? '';
    if (o.type !== 'SaveComponent' && tp.includes('/Buildable/')) classOf.set(o.instanceName, shortName(tp));
    const p = o.properties as Record<string, Prop> | undefined;
    if (tp === FACTORY_PORT || PIPE_PORTS.has(tp)) {
      const to = refPath(p?.mConnectedComponent?.value);
      const map = tp === FACTORY_PORT ? belt : pipe;
      if (to) { map.set(o.instanceName, to); if (!map.has(to)) map.set(to, o.instanceName); }
      const net = num(p?.mPipeNetworkID);
      if (net !== undefined) netOf.set(o.instanceName, net);
    } else if (CHAIN.test(tp)) chains.push(o);
    else if (tp === PIPE_NETWORK) {
      const net = num(p?.mPipeNetworkID), fluid = refPath(p?.mFluidDescriptor?.value);
      if (net !== undefined && fluid) fluidOf.set(net, shortName(fluid));
    } else if (tp === CIRCUIT) circuitObjs.push(o);
  }
  const cls = (owner: string) => classOf.get(owner) ?? shortName(owner).replace(/_\d+$/, '');
  const known = (owner: string) => buildings.has(shortName(owner));

  const items = beltItems(chains);
  const links: SnapshotLink[] = [];

  // Belts: from every output port of a building along belts and lifts to the next building's port.
  for (const [start, next] of belt) {
    const owner = ownerOf(start);
    if (CONVEYOR.test(cls(owner)) || portOf(start).startsWith('SnapOnly')) continue;
    const nextIsConveyor = CONVEYOR.test(cls(ownerOf(next)));
    const out = nextIsConveyor ? portOf(next) === 'ConveyorAny0' : /^Output/.test(portOf(start));
    if (!out) continue;
    const via: string[] = [];
    let cur: string | undefined = next;
    while (cur && CONVEYOR.test(cls(ownerOf(cur))) && via.length < MAX_HOPS) {
      const c = ownerOf(cur);
      via.push(shortName(c));
      cur = belt.get(`${c}.${portOf(cur) === 'ConveyorAny0' ? 'ConveyorAny1' : 'ConveyorAny0'}`);
    }
    if (!cur || CONVEYOR.test(cls(ownerOf(cur))) || !known(owner) || !known(ownerOf(cur))) continue;
    const link: SnapshotLink = { from: shortName(owner), to: shortName(ownerOf(cur)), fromPort: portOf(start), toPort: portOf(cur), kind: 'belt', via };
    const slowest = slowestOf(via, CONVEYOR);
    if (slowest) link.slowest = slowest;
    const seen = sumItems(via, items);
    if (seen) link.items = seen;
    links.push(link);
  }

  links.push(...pipeLinks(pipe, netOf, fluidOf, cls, known));
  links.sort((a, b) => a.from.localeCompare(b.from) || (a.fromPort ?? '').localeCompare(b.fromPort ?? '') || a.to.localeCompare(b.to));

  const circuits: SnapshotCircuit[] = [];
  for (const o of circuitObjs) {
    const p = (o.properties ?? {}) as Record<string, Prop>;
    const id = num(p.mCircuitID);
    const comps = Array.isArray(p.mComponents?.values) ? (p.mComponents.values as unknown[]) : [];
    const ids = new Set<string>();
    for (const c of comps) {
      const path = refPath(c);
      if (!path) continue;
      const owner = ownerOf(path);
      if (known(owner) && !POLE.test(cls(owner))) ids.add(shortName(owner));
    }
    if (id === undefined || ids.size === 0) continue;
    const circuit: SnapshotCircuit = { id, buildings: [...ids].sort() };
    if (readBool(p.mIsFuseTriggered)) circuit.fuseTriggered = true;
    circuits.push(circuit);
  }
  circuits.sort((a, b) => a.id - b.id);
  return { links, circuits };
}

/**
 * The class of the slowest belt/lift or pipe among `via`: the lowest Mk number in the class name (`Build_ConveyorBeltMk2_C`,
 * `Build_PipelineMK2_C`; a pipe without "MK2" is Mk.1). The extraction runs in the save worker without the dataset,
 * so it does not know the rates; within belts and within pipes a higher Mk is never slower.
 */
function slowestOf(via: readonly string[], kind: RegExp): string | undefined {
  let best: string | undefined;
  let bestMk = Infinity;
  for (const id of via) {
    const c = id.replace(/_\d+$/, '');
    const m = kind.exec(c);
    if (!m) continue;
    const mk = kind === PIPELINE ? (m[1] ? 2 : 1) : Number(m[1]);
    if (mk < bestMk) { bestMk = mk; best = c; }
  }
  return best;
}

/** Items lying on each belt or lift (id → item class → count), from the conveyor chain actors. */
export function beltItems(chains: readonly FactoryObject[]): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>();
  for (const ch of chains) {
    const sp = ch.specialProperties as { beltsInChain?: unknown; items?: unknown } | undefined;
    const belts = (Array.isArray(sp?.beltsInChain) ? (sp.beltsInChain as { beltRef?: unknown; startsAtLength?: unknown; endsAtLength?: unknown }[]) : [])
      .map(b => ({ id: refPath(b.beltRef), start: Number(b.startsAtLength), end: Number(b.endsAtLength) }))
      .filter((b): b is { id: string; start: number; end: number } => b.id !== null && Number.isFinite(b.start) && Number.isFinite(b.end))
      .sort((a, b) => a.start - b.start);
    if (belts.length === 0 || !Array.isArray(sp?.items)) continue;
    for (const it of sp.items as { item?: { itemReference?: unknown }; position?: unknown }[]) {
      const item = refPath(it.item?.itemReference);
      const pos = Number(it.position);
      if (!item || !Number.isFinite(pos)) continue;
      // The last belt starting at or before the item (items just past the chain's end belong to its last belt).
      let lo = 0, hi = belts.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (belts[mid]!.start <= pos) lo = mid; else hi = mid - 1;
      }
      const id = shortName(belts[lo]!.id);
      let per = out.get(id);
      if (!per) out.set(id, (per = new Map()));
      const cls = shortName(item);
      per.set(cls, (per.get(cls) ?? 0) + 1);
    }
  }
  return out;
}

function sumItems(via: readonly string[], items: ReadonlyMap<string, ReadonlyMap<string, number>>): Record<string, number> | undefined {
  let out: Record<string, number> | undefined;
  for (const id of via) {
    for (const [item, n] of items.get(id) ?? []) {
      out ??= {};
      out[item] = (out[item] ?? 0) + n;
    }
  }
  return out;
}

type Role = 'in' | 'out' | 'any';

/**
 * Pipe links: from every fluid port of a building along pipelines to the next building's port, each pair once.
 * Direction: a link that ends at a producing port (`PipeOutputFactory*`, an extractor, a pump's or valve's
 * `Connection1`) starts there; one that ends at a consuming port (`PipeInputFactory*`, a generator, a pump's or valve's
 * `Connection0`) goes there. Between junctions and fluid buffers (no direction of their own) the fluid flows away
 * from the producers: the end nearer to a producer (hops through the pipe graph, following fixed directions) is
 * upstream; when that ties, the end farther from a consumer; else the order in the save.
 */
function pipeLinks(
  pipe: ReadonlyMap<string, string>, netOf: ReadonlyMap<string, number>, fluidOf: ReadonlyMap<number, string>,
  cls: (owner: string) => string, known: (owner: string) => boolean,
): SnapshotLink[] {
  const roleOf = (port: string): Role => {
    const name = portOf(port), c = cls(ownerOf(port));
    if (/^PipeOutput/.test(name)) return 'out';
    if (/^PipeInput/.test(name)) return 'in';
    if (name === 'FGPipeConnectionFactory') return FLUID_EXTRACTOR.test(c) ? 'out' : 'in';
    if (PUMP_OR_VALVE.test(c)) return name === 'Connection1' ? 'out' : name === 'Connection0' ? 'in' : 'any';
    return 'any';
  };
  interface Raw { a: string; b: string; via: string[] }
  const raws: Raw[] = [];
  const seen = new Set<string>();
  for (const [start, next] of pipe) {
    const owner = ownerOf(start);
    if (PIPELINE.test(cls(owner)) || portOf(start).startsWith('SnapOnly')) continue;
    const via: string[] = [];
    let cur: string | undefined = next;
    while (cur && PIPELINE.test(cls(ownerOf(cur))) && via.length < MAX_HOPS) {
      const c = ownerOf(cur);
      via.push(shortName(c));
      cur = pipe.get(`${c}.${portOf(cur) === 'PipelineConnection0' ? 'PipelineConnection1' : 'PipelineConnection0'}`);
    }
    if (!cur || PIPELINE.test(cls(ownerOf(cur))) || !known(owner) || !known(ownerOf(cur))) continue;
    const key = start < cur ? `${start}|${cur}` : `${cur}|${start}`;
    if (seen.has(key)) continue;
    seen.add(key);
    raws.push(start < cur ? { a: start, b: cur, via } : { a: cur, b: start, via: via.reverse() });
  }
  raws.sort((x, y) => x.a.localeCompare(y.a));

  // Hop distances from producers (downstream) and to consumers (upstream) over the building graph.
  const fixed = (r: Raw): [string, string] | null => {
    const ra = roleOf(r.a), rb = roleOf(r.b);
    if (ra === 'out' || rb === 'in') return [r.a, r.b];
    if (rb === 'out' || ra === 'in') return [r.b, r.a];
    return null;
  };
  const fwd = new Map<string, string[]>(), back = new Map<string, string[]>();
  const edge = (m: Map<string, string[]>, u: string, v: string) => { const l = m.get(u); if (l) l.push(v); else m.set(u, [v]); };
  const producers: string[] = [], consumers: string[] = [];
  for (const r of raws) {
    const f = fixed(r);
    const u = ownerOf(f?.[0] ?? r.a), v = ownerOf(f?.[1] ?? r.b);
    edge(fwd, u, v); edge(back, v, u);
    if (!f) { edge(fwd, v, u); edge(back, u, v); }
    for (const p of [r.a, r.b]) {
      const role = roleOf(p), c = cls(ownerOf(p));
      if (PUMP_OR_VALVE.test(c)) continue;
      if (role === 'out') producers.push(ownerOf(p));
      if (role === 'in') consumers.push(ownerOf(p));
    }
  }
  const fromProducer = hops(producers, fwd), toConsumer = hops(consumers, back);

  return raws.map(r => {
    let [from, to] = fixed(r) ?? [r.a, r.b];
    if (!fixed(r)) {
      const pa = fromProducer.get(ownerOf(r.a)) ?? Infinity, pb = fromProducer.get(ownerOf(r.b)) ?? Infinity;
      const ca = toConsumer.get(ownerOf(r.a)) ?? Infinity, cb = toConsumer.get(ownerOf(r.b)) ?? Infinity;
      if (pb < pa || (pb === pa && cb > ca)) [from, to] = [r.b, r.a];
    }
    const via = from === r.a ? r.via : [...r.via].reverse();
    const link: SnapshotLink = { from: shortName(ownerOf(from)), to: shortName(ownerOf(to)), fromPort: portOf(from), toPort: portOf(to), kind: 'pipe', via };
    const slowest = slowestOf(via, PIPELINE);
    if (slowest) link.slowest = slowest;
    const net = netOf.get(from) ?? netOf.get(to);
    const fluid = net !== undefined ? fluidOf.get(net) : undefined;
    if (fluid) link.fluid = fluid;
    return link;
  });
}

function hops(starts: readonly string[], next: ReadonlyMap<string, readonly string[]>): Map<string, number> {
  const dist = new Map<string, number>();
  let frontier = [...new Set(starts)];
  for (const s of frontier) dist.set(s, 0);
  for (let d = 1; frontier.length > 0; d++) {
    const n: string[] = [];
    for (const u of frontier) for (const v of next.get(u) ?? []) if (!dist.has(v)) { dist.set(v, d); n.push(v); }
    frontier = n;
  }
  return dist;
}
