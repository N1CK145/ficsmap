/**
 * Resource nodes: the dataset file `resource-nodes.json` (built from the extractor's `default-world.json`),
 * the per-world differences a save import reports, and the filter logic of the map layer.
 */

export type Purity = 'impure' | 'normal' | 'pure';
export const PURITIES: readonly Purity[] = ['impure', 'normal', 'pure'];

/**
 * `node`: an ore, oil or SAM node (miner, oil extractor); `geyser`: a geothermal geyser; `core`: the
 * centre of a resource well (fracking core, no purity of its own); `satellite`: one of a well's extraction points.
 */
export type NodeKind = 'node' | 'geyser' | 'core' | 'satellite';
export const NODE_KINDS: readonly NodeKind[] = ['node', 'geyser', 'core', 'satellite'];

/** Pseudo resource id of geysers: the extractor reports no resource class for them. */
export const GEYSER_RESOURCE = 'Geyser';

/** `core`: the actor name of a satellite's fracking core. Coordinates are world units (cm), rounded. */
export type ResourceNodeTuple = [
  name: string, kind: NodeKind, resource: string, purity: Purity | null, x: number, y: number, z: number, core?: string,
];

/** `/data/<v>/resource-nodes.json`. `resources[].name` is the English display name, a fallback for the UI's own names. */
export interface ResourceNodesFile {
  version: string;
  resources: { id: string; name: string }[];
  nodes: ResourceNodeTuple[];
}

export interface ResourceNode {
  name: string;
  kind: NodeKind;
  resource: string;
  purity: Purity | null;
  x: number;
  y: number;
  z: number;
  core?: string;
  /** Set when the world's last save import changed this node: the default map's values. */
  original?: { resource: string; purity: Purity | null };
}

/**
 * What a save says about one node, where it differs from the level's defaults: the resource descriptor
 * class (`Desc_OreIron_C`) and the purity, each null when the save sets none.
 */
export type ResourceNodeOverride = [name: string, resource: string | null, purity: Purity | null];

/**
 * The world's node randomisation settings as the save stores them (enum member names such as
 * `NRM_BasicReach`, `NPS_AllRandom`); null fields were not in the save, i.e. at their defaults.
 */
export interface NodeSettings { randomization: string | null; purity: string | null; seed: number | null }

/**
 * The members of the game's `ENodeRandomizationMode` and `ENodePuritySettings` in enum order (index = value; SML
 * `FGGameState.h`, CL517554). The first member is the default (`NRM_None`, `NPS_NoChange`).
 */
export const NODE_RANDOMIZATION_MODES = ['NRM_None', 'NRM_Strict', 'NRM_BasicReach', 'NRM_AdvancedRich', 'NRM_FossilFuelRich'] as const;
export const NODE_PURITY_SETTINGS = ['NPS_NoChange', 'NPS_AllPure', 'NPS_AllNormal', 'NPS_AllImpure', 'NPS_AllRandom', 'NPS_Increase', 'NPS_Decrease'] as const;
export type NodeRandomizationMode = typeof NODE_RANDOMIZATION_MODES[number];
export type NodePuritySetting = typeof NODE_PURITY_SETTINGS[number];

/**
 * One node setting that differs from the game's default: `member` is the enum member it names (also when the save
 * holds the enum's value, `'2'` → `NRM_BasicReach`), null for a value this version does not know; `raw` as stored.
 */
export type ChangedNodeSetting =
  | { setting: 'randomization'; member: NodeRandomizationMode | null; raw: string }
  | { setting: 'purity'; member: NodePuritySetting | null; raw: string };

/**
 * The buildings that stand on nodes: miners Mk.1-3 on resource nodes, the oil extractor on oil nodes, the resource
 * well pressurizer on a well's core and well extractors on its satellites, the geothermal generator on geysers, and
 * the portable miner (equipment, several can share a node).
 */
export type ExtractorKind = 'miner1' | 'miner2' | 'miner3' | 'oil' | 'pressurizer' | 'well' | 'geothermal' | 'portable';
export const EXTRACTOR_KINDS: readonly ExtractorKind[] = ['miner1', 'miner2', 'miner3', 'oil', 'pressurizer', 'well', 'geothermal', 'portable'];

/**
 * The game's limits: clock speed up to 250 % with three Power Shards (satisfactory.wiki.gg "Clock speed": 1-250 %,
 * each shard raises the maximum by 50 % up to three times; Docs `Desc_CrystalShard_C.mExtraPotential` 0.5). Not
 * from the buildings' `mMaxPotential` / `mPotentialShardSlots`: in the Docs those are 1.0 and 0 (the base before shards).
 */
export const MAX_CLOCK = 2.5;
export const MAX_SHARDS = 3;

/**
 * One extractor on a node, as a save import reports it: the node's actor name, the building, its clock speed
 * (1 = 100 %) and the Power Shards in it. Clock and shards are null for extractors that cannot be overclocked
 * (portable miner, geothermal generator).
 */
export type NodeExtractor = [node: string, kind: ExtractorKind, clock: number | null, shards: number | null];

/** What a save import reports about resource nodes. `extractors` is missing from older clients. */
export interface SaveResourceNodes { overrides: ResourceNodeOverride[]; settings: NodeSettings | null; extractors?: NodeExtractor[] }

/** The game's purity enum (`EResourcePurity`, with its own spelling `RP_Inpure`), in enum order. */
const GAME_PURITY: readonly string[] = ['RP_Inpure', 'RP_Normal', 'RP_Pure'];

/** `RP_Inpure` / `EResourcePurity::RP_Pure` / the enum's index → purity; anything else (e.g. `RP_MAX`) → null. */
export function purityFromGame(value: unknown): Purity | null {
  if (typeof value === 'number') return Number.isInteger(value) ? (PURITIES[value] ?? null) : null;
  if (typeof value !== 'string') return null;
  const i = GAME_PURITY.indexOf(value.slice(value.lastIndexOf(':') + 1));
  return i < 0 ? null : PURITIES[i]!;
}

export function readResourceNodes(file: ResourceNodesFile): ResourceNode[] {
  return file.nodes.map(([name, kind, resource, purity, x, y, z, core]) => {
    const n: ResourceNode = { name, kind, resource, purity, x, y, z };
    if (core !== undefined) n.core = core;
    return n;
  });
}

/**
 * The nodes as the world has them: the save's resource and purity where it sets one. A well's resource
 * comes from its core, so a resource override on a core also applies to its satellites (unless a
 * satellite has its own). Purity overrides on cores are ignored (cores have none). Names that are not
 * nodes of the dataset are ignored.
 */
export function applyOverrides(nodes: readonly ResourceNode[], overrides: readonly ResourceNodeOverride[]): ResourceNode[] {
  if (overrides.length === 0) return [...nodes];
  const byName = new Map(overrides.map(o => [o[0], o]));
  const coreResource = new Map<string, string>();
  for (const n of nodes) {
    const r = n.kind === 'core' ? byName.get(n.name)?.[1] : null;
    if (r) coreResource.set(n.name, r);
  }
  return nodes.map(n => {
    const o = byName.get(n.name);
    const resource = o?.[1] ?? (n.core !== undefined ? coreResource.get(n.core) : undefined) ?? n.resource;
    const purity = n.kind === 'core' ? null : (o?.[2] ?? n.purity);
    if (resource === n.resource && purity === n.purity) return n;
    return { ...n, resource, purity, original: { resource: n.resource, purity: n.purity } };
  });
}

/** `occupied`: nodes with an extractor on them (from the last save import), `free`: the others. */
export type Occupancy = 'all' | 'occupied' | 'free';
export const OCCUPANCIES: readonly Occupancy[] = ['all', 'occupied', 'free'];

/**
 * Which nodes the layer shows: resources not hidden, purities switched on, and (when `occupancy` is set and not
 * `all`) whether an extractor stands on the node; `occupied` names those nodes.
 */
export interface NodeFilter {
  hiddenResources: ReadonlySet<string>;
  purities: ReadonlySet<Purity>;
  occupancy?: Occupancy;
  occupied?: { has(name: string): boolean };
}

function occupancyPasses(n: ResourceNode, f: NodeFilter): boolean {
  if (!f.occupancy || f.occupancy === 'all') return true;
  return (f.occupied?.has(n.name) ?? false) === (f.occupancy === 'occupied');
}

function passes(n: ResourceNode, f: NodeFilter): boolean {
  return !f.hiddenResources.has(n.resource) && n.purity !== null && f.purities.has(n.purity) && occupancyPasses(n, f);
}

/**
 * The nodes the filter lets through. A core is shown while at least one of its satellites is, and with the
 * `occupied` filter also when a pressurizer stands on it.
 */
export function filterNodes(nodes: readonly ResourceNode[], f: NodeFilter): ResourceNode[] {
  const shown = nodes.filter(n => n.kind !== 'core' && passes(n, f));
  const cores = new Set(shown.flatMap(n => (n.core === undefined ? [] : [n.core])));
  const coreShown = (n: ResourceNode) =>
    !f.hiddenResources.has(n.resource) && (cores.has(n.name) || (f.occupancy === 'occupied' && (f.occupied?.has(n.name) ?? false)));
  return nodes.filter(n => (n.kind === 'core' ? coreShown(n) : passes(n, f)));
}

export interface NodeCounts {
  /** Extraction points per resource that match the purity and occupancy filters. */
  byResource: Map<string, number>;
  /** Extraction points per purity among the resources that are not hidden, under the occupancy filter. */
  byPurity: Record<Purity, number>;
  /** Extraction points with and without an extractor, under the resource and purity filters. */
  byOccupancy: Record<Occupancy, number>;
}

/** Counts per resource, purity and occupancy (faceted: each ignores its own filter). Cores are not counted. */
export function countNodes(nodes: readonly ResourceNode[], f: NodeFilter): NodeCounts {
  const byResource = new Map<string, number>();
  const byPurity: Record<Purity, number> = { impure: 0, normal: 0, pure: 0 };
  const byOccupancy: Record<Occupancy, number> = { all: 0, occupied: 0, free: 0 };
  for (const n of nodes) {
    if (n.kind === 'core' || n.purity === null) continue;
    const resourceOk = !f.hiddenResources.has(n.resource);
    const purityOk = f.purities.has(n.purity);
    const occupancyOk = occupancyPasses(n, f);
    if (purityOk && occupancyOk) byResource.set(n.resource, (byResource.get(n.resource) ?? 0) + 1);
    if (resourceOk && occupancyOk) byPurity[n.purity]++;
    if (resourceOk && purityOk) {
      byOccupancy.all++;
      byOccupancy[f.occupied?.has(n.name) ? 'occupied' : 'free']++;
    }
  }
  return { byResource, byPurity, byOccupancy };
}

// --- Extractors on nodes ---------------------------------------------------------------------------

export interface ExtractorInfo { kind: ExtractorKind; clock: number | null; shards: number | null }

/** Buildings before the portable miner, then by kind order; the first is the one the map's badge names. */
function extractorOrder(a: ExtractorInfo, b: ExtractorInfo): number {
  return EXTRACTOR_KINDS.indexOf(a.kind) - EXTRACTOR_KINDS.indexOf(b.kind);
}

/** The extractors per node name, for the nodes in `nodes` only (a save may name nodes this dataset lacks). */
export function extractorsByNode(nodes: readonly ResourceNode[], list: readonly NodeExtractor[]): Map<string, ExtractorInfo[]> {
  const known = new Set(nodes.map(n => n.name));
  const out = new Map<string, ExtractorInfo[]>();
  for (const [node, kind, clock, shards] of list) {
    if (!known.has(node)) continue;
    const l = out.get(node) ?? [];
    l.push({ kind, clock, shards });
    out.set(node, l);
  }
  for (const l of out.values()) l.sort(extractorOrder);
  return out;
}

export interface ExtractorSummary {
  /** Extractors per kind (kinds without any are left out), in kind order. */
  byKind: [kind: ExtractorKind, count: number][];
  /** Power Shards in all of them. */
  shards: number;
  /** Nodes with at least one extractor. */
  nodes: number;
}

export function summarizeExtractors(byNode: ReadonlyMap<string, readonly ExtractorInfo[]>): ExtractorSummary {
  const counts = new Map<ExtractorKind, number>();
  let shards = 0;
  for (const l of byNode.values()) {
    for (const e of l) {
      counts.set(e.kind, (counts.get(e.kind) ?? 0) + 1);
      shards += e.shards ?? 0;
    }
  }
  return { byKind: EXTRACTOR_KINDS.flatMap(k => (counts.has(k) ? [[k, counts.get(k)!] as [ExtractorKind, number]] : [])), shards, nodes: byNode.size };
}

// --- Save ----------------------------------------------------------------------------------------

type Prop = { value?: unknown; values?: unknown };
/** Structural subset of the parser's save; shared code never imports the parser. */
export interface SaveNodesLike {
  levels: Record<string, { objects: { typePath?: string; instanceName: string; properties?: Record<string, Prop> }[] }>;
}

/**
 * The node actor classes in a save. Seen in saves of builds 493833 and 495413: one object per node in
 * `Persistent_Level` (459 nodes, 31 geysers, 17 cores, 118 satellites), instance name = the extractor's name.
 */
const NODE_CLASS_SUFFIXES = ['.BP_ResourceNode_C', '.BP_ResourceNodeGeyser_C', '.BP_FrackingCore_C', '.BP_FrackingSatellite_C'];
/** The game state (`AFGGameState`); it holds the world's node randomisation settings. */
const GAME_STATE_SUFFIX = '.BP_GameState_C';

/**
 * Property names and types from the game's reflection data (FactoryGame module, 1.2.5.0), all flagged SaveGame:
 * - `AFGResourceNode.mPurityOverride`: ByteProperty with enum `EResourcePurity` (a plain C++ enum, so the save
 *   holds the bare member name `RP_Pure`). The constructor sets it to `RP_MAX` (no override), and the save only
 *   writes properties that differ from the default, so it is present exactly on nodes with an override.
 * - `AFGResourceNodeBase.mResourceClassOverride`: class reference (default none), saved as an ObjectProperty
 *   whose `pathName` is the descriptor class (`/Game/.../Desc_Coal.Desc_Coal_C`).
 * - `AFGGameState.mNodeRandomization`, `.mNodePuritySettings` (EnumProperty, `ENodeRandomizationMode::NRM_*`,
 *   `ENodePuritySettings::NPS_*`), `.mNodeRandomizationSeed` (IntProperty); absent while left at the defaults
 *   `NRM_None`, `NPS_NoChange` and 0 (SML `FGGameState.h`, CL517554).
 * The node's own `mPurity` and `mResourceClass` are not SaveGame: a save without overrides says nothing about
 * purity, and the dataset's values stand. Saves of worlds without randomisation contain none of these properties;
 * a randomised save has not been seen yet, so the readers also accept the other forms the parser can produce.
 * A randomised save may hold the settings and seed but no per-node overrides: the game can derive the layout from
 * the seed (SML `FGResourceNodeManager.h`: "just a seed is the only thing that needs to be saved"). The UI then
 * says so and keeps the default map.
 */
const PURITY_OVERRIDE = 'mPurityOverride';
const RESOURCE_OVERRIDE = 'mResourceClassOverride';
const SETTING_PROPS = { randomization: 'mNodeRandomization', purity: 'mNodePuritySettings', seed: 'mNodeRandomizationSeed' } as const;

/** The part after the last `sep`; the whole string without one (`'RP_Pure'` stays `'RP_Pure'`). */
function lastSegment(s: string, sep: string): string {
  const i = s.lastIndexOf(sep);
  return i < 0 ? s : s.slice(i + sep.length);
}

/**
 * The enum member of an EnumProperty/ByteProperty value as the parser returns it: `{ value: 'E::X' }` (EnumProperty),
 * `{ type: 'E', value: 'X' }` (ByteProperty with an enum), `{ type: 'None', value: 2 }` (plain byte), or bare.
 */
function enumValue(p: Prop | undefined): string | number | null {
  let v: unknown = p?.value;
  if (v !== null && typeof v === 'object' && 'value' in v) v = (v as { value: unknown }).value;
  if (typeof v === 'number') return v;
  return typeof v === 'string' && v !== '' ? lastSegment(v, '::') : null;
}

/** A class reference (`/Game/.../Desc_OreIron.Desc_OreIron_C`) → `Desc_OreIron_C`; empty → null. */
function classValue(p: Prop | undefined): string | null {
  const v = p?.value as { pathName?: unknown } | string | undefined;
  const path = typeof v === 'string' ? v : typeof v?.pathName === 'string' ? v.pathName : '';
  const name = lastSegment(path, '.');
  return /^[A-Za-z0-9_]{1,64}$/.test(name) && name !== 'None' ? name : null;
}

/**
 * Extractor buildings by class (the last segment of `typePath`). Seen in saves of builds 493833 and 495413:
 * `Build_MinerMk1_C`, `Build_MinerMk2_C` and `BP_PortableMiner_C`; the others are the game's asset names
 * (`FactoryGame-Windows.utoc`), not yet seen in a save. Their target nodes (oil node, fracking core, fracking
 * satellite, geyser) follow SML (CL517554) and satisfactory-calculator's save code.
 */
const EXTRACTOR_CLASSES: ReadonlyMap<string, ExtractorKind> = new Map([
  ['Build_MinerMk1_C', 'miner1'],
  ['Build_MinerMk2_C', 'miner2'],
  ['Build_MinerMk3_C', 'miner3'],
  ['Build_OilPump_C', 'oil'],
  ['Build_FrackingSmasher_C', 'pressurizer'],
  ['Build_FrackingExtractor_C', 'well'],
  ['Build_GeneratorGeoThermal_C', 'geothermal'],
  ['BP_PortableMiner_C', 'portable'],
]);
/**
 * Property names (game reflection data, all SaveGame; shapes as the parser returns them for 1.2 saves):
 * - `mExtractableResource` (`AFGBuildableResourceExtractorBase`, `AFGBuildableGeneratorGeoThermal`): ObjectProperty,
 *   `pathName` = the node's instance name (`Persistent_Level:PersistentLevel.BP_ResourceNode586`).
 *   `mExtractResourceNode` is the portable miner's link (and an older name on the buildings).
 * - `mPendingPotential` / `mCurrentPotential` (`AFGBuildableFactory`): FloatProperty, 1 = 100 %; absent at the
 *   default 1. Pending is the clock speed the player set; current can lag behind it (seen: current absent,
 *   pending 1.125 on a miner), so pending wins.
 * - `mInventoryPotential`: ObjectProperty to the building's `FGInventoryComponent` (`<building>.InventoryPotential`),
 *   whose `mInventoryStacks` hold the Power Shards (`Desc_CrystalShard_C`, one per slot, absent when empty).
 *   The shards are counted there, not derived from the clock: a building may hold more shards than its clock needs.
 */
const LINK_PROPS = ['mExtractableResource', 'mExtractResourceNode'] as const;
/**
 * Extractors that cannot be overclocked: the portable miner (equipment), the geothermal generator (Docs
 * `Build_GeneratorGeoThermal_C.mCanChangePotential` False) and the Resource Well Extractor (Docs say True, but in
 * the game its clock speed is set at the Resource Well Pressurizer for the whole well; satisfactory.wiki.gg
 * Resource_Well_Pressurizer, Resource_Well_Extractor "Overclockable: No"). Whatever potential properties a save may
 * hold for them, they report no clock speed and no Power Shards; the well's clock and shards show on its pressurizer.
 */
const NO_POTENTIAL: ReadonlySet<ExtractorKind> = new Set(['portable', 'geothermal', 'well']);
const SHARD_SUFFIX = '.Desc_CrystalShard_C';
const INVENTORY_TYPE = '/Script/FactoryGame.FGInventoryComponent';

/** An object reference's `pathName`, or null. */
function refPath(p: Prop | undefined): string | null {
  const v = p?.value as { pathName?: unknown } | undefined;
  return typeof v?.pathName === 'string' && v.pathName !== '' ? v.pathName : null;
}

function finite(p: Prop | undefined): number | null {
  return typeof p?.value === 'number' && Number.isFinite(p.value) ? p.value : null;
}

/** Power Shards in a potential inventory component: the `NumItems` of its `Desc_CrystalShard_C` stacks. */
function countShards(inventory: { properties?: Record<string, Prop> } | undefined): number {
  const stacks = inventory?.properties?.mInventoryStacks?.values;
  if (!Array.isArray(stacks)) return 0;
  let n = 0;
  for (const st of stacks as { properties?: Record<string, Prop> }[]) {
    const item = st?.properties?.Item?.value as { itemReference?: { pathName?: unknown } } | undefined;
    const path = item?.itemReference?.pathName;
    const count = st?.properties?.NumItems?.value;
    if (typeof path === 'string' && path.endsWith(SHARD_SUFFIX) && typeof count === 'number' && Number.isInteger(count) && count > 0) n += count;
  }
  return n;
}

/** Rounded to a millionth (the save holds float32), within the game's range. */
function clockValue(v: number): number {
  return Math.round(Math.min(MAX_CLOCK, Math.max(0, v)) * 1e6) / 1e6;
}

type SaveObject = SaveNodesLike['levels'][string]['objects'][number];

/** The extractor buildings that stand on one of `nodes` (instance names of the save's node actors). */
function extractExtractors(objects: readonly SaveObject[], nodes: ReadonlyMap<string, string>, inventories: ReadonlyMap<string, SaveObject>): NodeExtractor[] {
  const out: NodeExtractor[] = [];
  for (const o of objects) {
    const kind = EXTRACTOR_CLASSES.get(lastSegment(o.typePath ?? '', '.'));
    const props = o.properties;
    if (!kind || !props) continue;
    const link = LINK_PROPS.map(k => refPath(props[k])).find(p => p !== null);
    const node = link ? nodes.get(link) : undefined;
    if (node === undefined) continue;
    if (NO_POTENTIAL.has(kind)) {
      out.push([node, kind, null, null]);
      continue;
    }
    const pending = finite(props.mPendingPotential);
    const current = finite(props.mCurrentPotential);
    const inventory = refPath(props.mInventoryPotential);
    if (inventory === null && pending === null && current === null) {
      // A building that cannot be overclocked (no potential inventory): nothing to report but its place.
      out.push([node, kind, null, null]);
      continue;
    }
    const shards = inventory === null ? null : Math.min(MAX_SHARDS, countShards(inventories.get(inventory)));
    out.push([node, kind, clockValue(pending ?? current ?? 1), shards]);
  }
  return out.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : EXTRACTOR_KINDS.indexOf(a[1]) - EXTRACTOR_KINDS.indexOf(b[1])));
}

/**
 * Resource and purity overrides of the save's node actors, the game state's randomisation settings if stored, and
 * the extractors standing on nodes (building, clock speed, Power Shards).
 */
export function extractResourceNodes(save: SaveNodesLike): SaveResourceNodes {
  const overrides: ResourceNodeOverride[] = [];
  const settings: NodeSettings = { randomization: null, purity: null, seed: null };
  let hasSettings = false;
  /** Node instance name → actor name. */
  const nodes = new Map<string, string>();
  const inventories = new Map<string, SaveObject>();
  const buildings: SaveObject[] = [];
  for (const level of Object.values(save.levels)) {
    for (const o of level.objects) {
      if (o.typePath && EXTRACTOR_CLASSES.has(lastSegment(o.typePath, '.'))) {
        buildings.push(o);
        continue;
      }
      if (o.typePath === INVENTORY_TYPE) {
        inventories.set(o.instanceName, o);
        continue;
      }
      const isNode = !!o.typePath && NODE_CLASS_SUFFIXES.some(s => o.typePath!.endsWith(s));
      if (isNode) nodes.set(o.instanceName, lastSegment(o.instanceName, '.'));
      const props = o.properties;
      if (!props) continue;
      if (isNode) {
        const resource = classValue(props[RESOURCE_OVERRIDE]);
        const purity = purityFromGame(enumValue(props[PURITY_OVERRIDE]));
        if (resource !== null || purity !== null) overrides.push([lastSegment(o.instanceName, '.'), resource, purity]);
        continue;
      }
      if (!o.typePath?.endsWith(GAME_STATE_SUFFIX)) continue;
      for (const key of ['randomization', 'purity'] as const) {
        const v = enumValue(props[SETTING_PROPS[key]]);
        if (v !== null && settings[key] === null) { settings[key] = String(v); hasSettings = true; }
      }
      const seed = props[SETTING_PROPS.seed]?.value;
      if (typeof seed === 'number' && Number.isInteger(seed) && settings.seed === null) { settings.seed = seed; hasSettings = true; }
    }
  }
  overrides.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return { overrides, settings: hasSettings ? settings : null, extractors: extractExtractors(buildings, nodes, inventories) };
}

/** The enum member a stored value names: the member itself, `E::Member`, or the enum's value as a string. */
function enumMember<T extends string>(raw: string, members: readonly T[]): T | null {
  const name = lastSegment(raw, '::');
  if (/^\d+$/.test(name)) return members[Number(name)] ?? null;
  return members.includes(name as T) ? (name as T) : null;
}

/**
 * The node settings that differ from the game's defaults, randomisation first. The seed alone changes nothing:
 * with both settings at their defaults the game does not randomise.
 */
export function changedNodeSettings(s: NodeSettings | null): ChangedNodeSetting[] {
  const out: ChangedNodeSetting[] = [];
  if (!s) return out;
  if (s.randomization !== null) {
    const member = enumMember(s.randomization, NODE_RANDOMIZATION_MODES);
    if (member !== NODE_RANDOMIZATION_MODES[0]) out.push({ setting: 'randomization', member, raw: s.randomization });
  }
  if (s.purity !== null) {
    const member = enumMember(s.purity, NODE_PURITY_SETTINGS);
    if (member !== NODE_PURITY_SETTINGS[0]) out.push({ setting: 'purity', member, raw: s.purity });
  }
  return out;
}

/** Whether the settings say the world's nodes were randomised (resource layout or purities). */
export function isRandomized(s: NodeSettings | null): boolean {
  return changedNodeSettings(s).length > 0;
}
