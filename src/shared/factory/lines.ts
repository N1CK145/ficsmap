/**
 * Production lines ("Produktionsstränge"): the factory's machines grouped by how they are really connected (belts and
 * pipes from `FactorySnapshot.links`), with what flows on each connection and how efficient each part is. One contract
 * for the map (hover a machine → its line lights up) and the line diagram (like the planner's top-down diagram).
 *
 * Implemented by `buildLines` (this file); the UI only reads these types.
 */
import type { Band, MachineState, Reason } from './analysis.js';

export interface ProductionLine {
  /** Stable within a snapshot: the id of its most downstream machine. */
  id: string;
  /** What the line makes: its final products (items leaving to storage, stations, sinks or nowhere), most first. */
  products: LineRate[];
  /** What comes in from outside the line (extractors are part of the line; this is what arrives by station/storage). */
  inputs: LineRate[];
  /** Every building in the line (machines and logistics nodes). */
  buildings: string[];
  /** The machines among them (with productivity). */
  machines: string[];
  /** Groups of parallel machines doing the same recipe on the same stage, for the diagram ("4× Konstruktor"). */
  groups: LineGroup[];
  /** Connections between groups (and logistics nodes), aggregated from links. */
  edges: LineEdge[];
  /** Mean productivity of its machines, 0..1 (plain mean, like the Fabrik page). */
  productivity: number;
  /** Nominal and actual output of its final products per minute (sum over products, items and m³ kept apart). */
  nominal: number;
  actual: number;
  /** The weakest point: the group or edge that limits the line, with the reason. */
  bottleneck?: LineBottleneck;
}

export interface LineRate { item: string; perMin: number; fluid?: boolean }

export interface LineGroup {
  id: string;
  /** Building class of the group (all members share it) or a logistics kind. */
  cls: string;
  recipe?: string;
  /** Member building ids. */
  members: string[];
  /** Stage from the start of the line (0 = extractors / inputs), for the top-down layout. */
  stage: number;
  /** Outputs and inputs per minute for the whole group (actual), and its nominal output. */
  outputs: LineRate[];
  inputs: LineRate[];
  nominal: LineRate[];
  productivity: number;
  state: MachineState;
  band?: Band;
  /** Reasons present in the group, with how many members have each. */
  reasons: { reason: Reason; count: number }[];
  /** Logistics nodes (splitter, merger, storage, station) are groups too, with `logistics: true`. */
  logistics?: boolean;
}

export interface LineEdge {
  from: string; // group id
  to: string; // group id
  item?: string;
  /** Actual flow per minute (from the producing side's actual rate, split over its outgoing links). */
  perMin?: number;
  /** Capacity per minute of the slowest belt/pipe on the way (summed over parallel links). */
  capacity?: number;
  /** Class of that slowest belt/pipe. */
  slowest?: string;
  /** Number of physical links aggregated. */
  links: number;
  /** All spline/lift ids of the aggregated links (for drawing on the map). */
  via: string[];
  /** Flow is at or near capacity (≥ 95 %). */
  saturated?: boolean;
}

export type LineBottleneck =
  | { kind: 'edge'; edge: number /* index in edges */; why: 'capacity' }
  | { kind: 'group'; group: string; why: Reason | 'demand' };

/** Which line every building belongs to (building id → line id), for the map's hover. */
export type LineIndex = ReadonlyMap<string, string>;
