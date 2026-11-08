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
 * - The snapshot holds no player names and no player positions (the user's choice); `builtBy` handles are left out.
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
  /** The players' own map markers and stamps. */
  markers: SnapshotMarker[];
  /** Death crates and other crates left in the world. */
  crates: { x: number; y: number; z: number; kind: string }[];
  /**
   * The explored area (fog of war) as a base64 PNG, one channel (grey = how explored, 0 = never seen), in the map's
   * square at the save's resolution (512 × 512 in 1.2). Missing when the save has none.
   */
  fog?: string;
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
  /** Extractors: the resource node it stands on (node id as in `resource-nodes.json`), when known. */
  node?: string;
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
}

export interface SnapshotVehicle {
  id: string;
  /** Vehicle class (`BP_Truck_C`, `BP_Tractor_C`, ...). */
  cls: string;
  name?: string;
  x: number; y: number; z: number; yaw: number;
  autopilot: boolean;
  /** Fuel item class and the amount in its fuel slot (MJ as the save stores it). */
  fuel?: { item: string; amount?: number };
  /** The route: station ids in order (unknown waypoints left out). */
  route: string[];
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
}
