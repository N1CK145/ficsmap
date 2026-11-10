/**
 * The factory as one save describes it: a compact snapshot of everything built, extracted from the save in the
 * browser (save worker) and stored per world and save on the server, so the map can show the factory as a 2D
 * sketch and step through older saves on a timeline.
 *
 * Conventions:
 * - Positions are game units (cm, `UNITS_PER_METER` = 100) rounded to whole units, in the game's frame (x east,
 *   y south, z up), like the rest of `src/shared`.
 * - `yaw` is the rotation about z in degrees, rounded to 0.1, 0 = facing +x.
 * - Classes are the buildable's class name without path (`Build_ConstructorMk1_C`); names, sizes, categories and
 *   pictures come from the dataset (`buildings.json`), never from the save.
 * - Flat number arrays keep large lists small in JSON.
 * - Players: their in-game names and where their characters stand (`players`, asked for by the user on 2026-11-10;
 *   earlier snapshots had none), and the game's statistics per player (`stats`). `builtBy` handles are left out.
 *
 * Versioned: a breaking change bumps `v`; readers ignore snapshots with a newer `v` than they know.
 */

export const FACTORY_SNAPSHOT_VERSION = 1;

export interface FactorySnapshot {
  v: typeof FACTORY_SNAPSHOT_VERSION;
  meta: SnapshotMeta;
  /** Every placed buildable with its own actor and a transform (machines, logistics nodes, storage, poles, ...). */
  buildings: SnapshotBuilding[];
  /**
   * Lightweight buildables (foundations, walls, ramps, pillars, ...), grouped by class: `xyzYaw` holds x, y, z, yaw
   * per instance, one after another.
   */
  lightweight: { cls: string; xyzYaw: number[] }[];
  /** Belts, pipes, hypertubes and vehicle paths as polylines (splines sampled and simplified, see `pts`). */
  splines: SnapshotSpline[];
  /** Power lines as straight segments: x1, y1, z1, x2, y2, z2 per line. */
  powerLines: number[];
  /** Vehicle path networks (1.2 roads): their nodes and which path segments (spline ids) belong to them. */
  pathNetworks: { id: number; nodes: number /* count */ ; segments: string[] }[];
  stations: SnapshotStation[];
  vehicles: SnapshotVehicle[];
  /**
   * How buildings are connected by belts and pipes, collapsed to links between "nodes": machines and logistics nodes
   * (splitters, mergers, storage, stations, pumps, valves, tanks, junctions, sinks). Belts, lifts and pipes in between
   * are listed in `via`. Missing in snapshots extracted before connections were read.
   */
  links?: SnapshotLink[];
  /** Power circuits: which buildings share one grid (by circuit id). Missing in older snapshots. */
  circuits?: SnapshotCircuit[];
  /** The players' own map markers and stamps. */
  markers: SnapshotMarker[];
  /** Death crates and other crates left in the world. */
  crates: SnapshotCrate[];
  /**
   * What lies in the Dimensional Depot (`FGCentralStorageSubsystem`): item class and amount, items with an amount of 0
   * left out, in the save's order. Missing in snapshots extracted before inventories were read.
   */
  depot?: [item: string, amount: number][];
  /**
   * The explored area (fog of war) as a base64 PNG, one channel (grey = how explored, 0 = never seen), in the map's
   * square at the save's resolution (512 × 512 in 1.2). Rows run along y (first row = the map's north edge, minY),
   * columns along x (minX first), covering the dataset's world bounds (`map.json` `world`). Missing when the save
   * has none.
   */
  fog?: string;
  /** The players the save knows (missing in snapshots extracted before players were read). */
  players?: SnapshotPlayer[];
  /**
   * Creature spawners (`BP_CreatureSpawner_C`, actor name as in the dataset's `creatures.json`) whose creatures were
   * killed at least once: times killed over all its spawn points, and how many of them are dead right now (they come
   * back later), and the game day of the last kill (missing in snapshots before it was read). Spawners without a kill
   * are left out. Missing in older snapshots.
   */
  spawners?: [name: string, kills: number, dead: number, lastDay?: number][];
  /** The game's own statistics (`FGStatisticsSubsystem`); missing in older snapshots and saves without them. */
  stats?: SnapshotStats;
}

export interface SnapshotPlayer {
  /** The player state's actor name (`BP_PlayerState_C_…`), what `stats` refers to; it changes between saves, the name does not. */
  id: string;
  /** In-game name: the character's cached name, else the game state's player info cache. */
  name?: string;
  /** Where the character is (it stays in the world while the player is offline); missing without a character. */
  pos?: [x: number, y: number, z: number];
}

/**
 * `FGStatisticsSubsystem` as the save has it (SaveGame properties in the game's `FGStatisticsSubsystem.h`). Counts per
 * class: items (`Desc_…`), creatures (`Char_…`), buildables (`Build_…`, also vehicles and equipment). `player` is a
 * `SnapshotPlayer.id`.
 */
export interface SnapshotStats {
  /** Nuts, berries, medkits and other consumables eaten or used (the world's total). */
  consumed: [item: string, count: number][];
  /** Creatures killed (the world's total). */
  killed: [creature: string, count: number][];
  /** Items produced (`mItemsProduced`; empty in 1.2 saves). */
  produced: [item: string, count: number][];
  /** Items crafted by hand, per player. */
  crafted: [player: string, item: string, count: number][];
  /** Items picked up in the world (placed items, not dropped ones), per player. */
  pickedUp: [player: string, item: string, count: number][];
  /** Per class: built in total, dismantled in total, in the world now, most ever at once; built and dismantled per player. */
  built: SnapshotBuiltStat[];
}

export interface SnapshotBuiltStat {
  cls: string;
  total: number;
  dismantled: number;
  current: number;
  max: number;
  by: [player: string, built: number, dismantled: number][];
}

export interface SnapshotMeta {
  sessionName: string;
  /** Unix ms of the save. */
  saveTime: number;
  build: number;
  /** Play time in seconds, when the save header has it. */
  playTimeSec?: number;
  /** Current game phase class (e.g. `GP_Project_Assembly_Phase_2`). */
  gamePhase?: string;
  /** Number of purchased schematics (milestones, MAM, shop). */
  schematics?: number;
  /**
   * The snapshot carries inventories (`SnapshotBuilding.inv`/`in`/`out`/`fuel`, station, vehicle and crate `inv`,
   * `depot`): a machine without `in` then has an empty input. Missing in snapshots extracted before they were read.
   */
  inventories?: boolean;
}

export interface SnapshotBuilding {
  /** Stable id of the actor in this save (the instance name's last part, e.g. `Build_ConstructorMk1_C_2146937711`). */
  id: string;
  cls: string;
  x: number; y: number; z: number;
  yaw: number;
  /** Swatch/paint slot, for drawing in the player's colours later (optional). */
  swatch?: number;
  /** Production, extraction and generators (anything with a productivity measurement). */
  prod?: SnapshotProduction;
  /** Signs: their visible texts. */
  texts?: string[];
  /** Conveyor lifts and similar: the height in game units. */
  height?: number;
  /**
   * Smart and programmable splitters (also the lift ones): their sort rules as the game stores them, item class and
   * output index (`splitterOutput` names the output). Filter items like `Desc_Wildcard_C` (any), `Desc_None_C`,
   * `Desc_Overflow_C` and `Desc_AnyUndefined_C` are kept as they are. Always present for those splitters (also empty),
   * so a missing list means an older snapshot.
   */
  sort?: [item: string, output: number][];
  /** Extractors: the resource node it stands on (node id as in `resource-nodes.json`), when known. */
  node?: string;
  /**
   * Storage (containers, storage boxes, Dimensional Depot uploaders, fluid buffers): what lies in it. Always present
   * for storage once `meta.inventories` is set, also when empty (`items` empty), so the slots are known. A fluid
   * buffer has one slot holding its fluid in litres (the fluid of its pipe network; empty when the save names none).
   */
  inv?: SnapshotInventory;
  /** Machines: the input, output and fuel inventories (a generator's fuel and supplemental slot); left out when empty. */
  in?: SnapshotInventory;
  out?: SnapshotInventory;
  fuel?: SnapshotInventory;
}

/**
 * A run of slots in an inventory: the item class, the count in each slot (fluids in litres, as inventories store
 * them) and how many slots in a row hold exactly that (left out when 1). `["Desc_SteelPlate_C", 200, 48]` is 48
 * full slots of steel plates.
 */
export type SnapshotStack = [item: string, count: number, times?: number];

/**
 * An inventory as the save has it: its number of slots and the filled ones in slot order, consecutive equal slots as
 * one run (`SnapshotStack`). Empty slots are left out (the filled ones are packed), so `slots` minus the filled ones
 * are the free slots.
 */
export interface SnapshotInventory {
  slots: number;
  items: SnapshotStack[];
}

/** A crate left in the world (a death crate holds what the player carried). */
export interface SnapshotCrate {
  /** Instance id (missing in older snapshots). */
  id?: string;
  x: number; y: number; z: number;
  /** `CT_DeathCrate`, ... without the enum prefix. */
  kind: string;
  /** What lies in it (missing in older snapshots). */
  inv?: SnapshotInventory;
}

export interface SnapshotProduction {
  /** Recipe class (e.g. `Recipe_IngotIron_C`); missing when none is set. */
  recipe?: string;
  /** Clock speed as a fraction (1 = 100 %). */
  clock: number;
  /** Productivity of the last measurement window as the game shows it, 0..1 (`mLastProductivityMeasurement*`). */
  productivity?: number;
  /** Length of that window in seconds (normally 300). */
  windowSec?: number;
  /** Was it producing at the moment of saving. */
  producing?: boolean;
  /** Paused by the player (standby). */
  paused?: boolean;
  powerShards?: number;
  somersloops?: number;
  /**
   * What held it back at saving time, read from its inventories: inputs missing (`starved`), output full
   * (`blocked`), no fuel (generators), no power. Several may apply.
   */
  issues?: ('starved' | 'blocked' | 'noFuel' | 'noPower' | 'noRecipe')[];
}

export interface SnapshotSpline {
  /** Instance id, unique in the save. */
  id: string;
  cls: string;
  /** Polyline: x, y, z per point after simplification (tolerance about 0.5 m). */
  pts: number[];
}

export interface SnapshotStation {
  id: string;
  /** Building class: truck station, train station, drone port, ... */
  cls: string;
  /** The player's name for it; missing when it still has the game's default name. */
  name?: string;
  x: number; y: number; z: number; yaw: number;
  /** Path node GUID (hex) that vehicle routes refer to. */
  nodeGuid?: string;
  /** Loading (true) or unloading (false), when the station has a mode. */
  loading?: boolean;
  /** Per vehicle that uses it, as the station tracks it. */
  traffic: { vehicle: string; avgSecBetweenDocks?: number; avgItemsPerDock?: number; capacityStacks?: number; capacityFluid?: number }[];
  /** What lay in the station's own inventory when saved, per item (missing in older snapshots and when empty). */
  cargo?: SnapshotCargo[];
  /** The same inventory slot by slot (missing in older snapshots; empty `items` when empty). */
  inv?: SnapshotInventory;
}

/** Items of one class in an inventory: the count (fluids in litres, as inventories store them). Most first. */
export interface SnapshotCargo { item: string; count: number }

export interface SnapshotVehicle {
  id: string;
  /** Vehicle class (`BP_Truck_C`, `BP_Tractor_C`, ...). */
  cls: string;
  name?: string;
  x: number; y: number; z: number; yaw: number;
  autopilot: boolean;
  /**
   * Fuel item class and the number of items in its fuel slot (fluids in litres, as inventories store them); when the
   * slot is empty, the vehicle's chosen fuel type with amount 0.
   */
  fuel?: { item: string; amount?: number };
  /** The route: station ids in order (unknown waypoints left out). */
  route: string[];
  /** What its storage held when saved, per item (missing in older snapshots and when empty). */
  cargo?: SnapshotCargo[];
  /** Slots of its storage (missing in older snapshots). */
  slots?: number;
  /** Its storage slot by slot (missing in older snapshots; empty `items` when empty). */
  inv?: SnapshotInventory;
}

export interface SnapshotMarker {
  name: string;
  x: number; y: number; z: number;
  /** `RT_MapMarker`, `RT_Stamp`, ... without the enum prefix. */
  kind: string;
  iconId: number;
  /** sRGB hex `#rrggbb`. */
  color: string;
  scale: number;
}

/** What the server keeps next to a snapshot for the timeline list (computed from the snapshot when stored). */
export interface SnapshotSummary {
  id: number;
  saveTime: number;
  sessionName: string;
  importedAt: number;
  importedBy: string;
  buildings: number;
  machines: number;
  /** Mean productivity over machines that have one, 0..1. */
  avgProductivity: number | null;
  /** Machines with productivity below 1 % (standing still). */
  idle: number;
  bytes: number;
  /**
   * Ids of the death crates in the save (`CT_DeathCrate`); missing for snapshots stored before they were recorded.
   * The world's deaths are the distinct ids over its saves (`countDeaths`).
   */
  deathCrates?: string[];
}

/** One belt or pipe connection from an upstream node's output to a downstream node's input. */
export interface SnapshotLink {
  /** Upstream building id (where the items come from). */
  from: string;
  /** Downstream building id (where they go). */
  to: string;
  /** Connector names on both ends as the save has them (e.g. `Output0`, `Input1`, `PipeOutputFactory`), when known. */
  fromPort?: string;
  toPort?: string;
  kind: 'belt' | 'pipe';
  /** Spline and lift ids along the way, upstream first (empty for a direct connection). */
  via: string[];
  /**
   * Class of the slowest belt/lift or pipe on the way (`Build_ConveyorBeltMk2_C`, `Build_PipelineMK2_C`); its rate
   * comes from the dataset (`recipes.json` belts) — the link's capacity.
   */
  slowest?: string;
  /** Items seen on the belt at saving time (class → count), from the conveyor chain actors, when readable. */
  items?: Record<string, number>;
  /** For pipes: the fluid in the pipe network, when known. */
  fluid?: string;
}

export interface SnapshotCircuit {
  id: number;
  /** Building ids with a power connection on this circuit. */
  buildings: string[];
  /** Fuse blown at saving time. */
  fuseTriggered?: boolean;
}
