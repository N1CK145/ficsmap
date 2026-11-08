import { readBool, saveTimeFromTicks, shortName } from '../extract.js';
import { extractorLink, isResourceNodeType } from '../resourceNodes.js';
import { flatPolyline, roundUnit, sampleSpline, simplify, toWorld, yawOf, type SplinePoint, type Transform, type Vec3 } from './geometry.js';
import { readConnections } from './connections.js';
import { FLUID_BUFFER_M3, LITRES_PER_M3, MAX_DEPOT_ITEMS, MAX_SLOTS, packStacks } from './inventory.js';
import { encodeGreyPng, toBase64 } from './png.js';
import {
  FACTORY_SNAPSHOT_VERSION, type FactorySnapshot, type SnapshotBuilding, type SnapshotInventory, type SnapshotMarker, type SnapshotProduction,
  type SnapshotCargo, type SnapshotSpline, type SnapshotStation, type SnapshotVehicle,
} from './snapshot.js';

/*
 * Save → factory snapshot (`snapshot.ts`). Everything below was checked against two 1.2 saves (builds 495413 and
 * 517554, parser 4.1.2); property names are the game's (FactoryGame reflection data), shapes as the parser returns them.
 * Player names, player positions and `BuiltBy` handles are never read.
 */

type Prop = { value?: unknown; values?: unknown; flags?: number; [k: string]: unknown };
type Props = Record<string, Prop>;
type Ref = { pathName?: string };

export interface FactoryObject {
  typePath?: string;
  instanceName: string;
  /** `SaveEntity` (actor) or `SaveComponent`. */
  type?: string;
  properties?: Props;
  specialProperties?: { type?: string; [k: string]: unknown };
  transform?: Transform;
  components?: Ref[];
}

/** Structural subset of the parser's save that the factory extraction reads; shared code never imports the parser. */
export interface FactorySaveLike {
  header: { sessionName: string; saveDateTime: string; buildVersion: number; playDurationSeconds?: number };
  levels: Record<string, { objects: FactoryObject[] }>;
}

export interface ExtractFactoryOptions {
  /** Douglas–Peucker tolerance for splines in game units (default 50 = 0.5 m). */
  splineTolerance?: number;
  /** Leave the explored area out (default: included). */
  skipFog?: boolean;
}

// --- Small readers ---------------------------------------------------------------------------------

function num(p: Prop | undefined): number | undefined {
  return typeof p?.value === 'number' && Number.isFinite(p.value) ? p.value : undefined;
}

function refPath(v: unknown): string | null {
  const p = (v as Ref | undefined)?.pathName;
  return typeof p === 'string' && p !== '' ? p : null;
}

/** An ObjectProperty's target path. */
function ref(p: Prop | undefined): string | null {
  return refPath(p?.value);
}

/** A class reference (`/Game/.../Recipe_IronPlate.Recipe_IronPlate_C`) → `Recipe_IronPlate_C`. */
function className(path: string | null | undefined): string | undefined {
  if (!path) return undefined;
  const n = shortName(path);
  return n === '' || n === 'None' ? undefined : n;
}

/** An enum value (`ERepresentationType::RT_Stamp`, also nested as `{ value }`) without the enum prefix. */
function enumMember(p: Prop | undefined): string | undefined {
  let v: unknown = p?.value;
  if (v !== null && typeof v === 'object' && 'value' in v) v = (v as { value: unknown }).value;
  if (typeof v !== 'string' || v === '') return undefined;
  const i = v.lastIndexOf('::');
  return i < 0 ? v : v.slice(i + 2);
}

/** A struct property's nested properties (`{ value: { properties } }` or `{ properties }`). */
function structProps(v: unknown): Props | undefined {
  const o = v as { properties?: Props; value?: { properties?: Props } } | undefined;
  return o?.properties ?? o?.value?.properties;
}

function vec(v: unknown): Vec3 | null {
  const o = v as Partial<Vec3> | undefined;
  return typeof o?.x === 'number' && typeof o.y === 'number' && typeof o.z === 'number' ? { x: o.x, y: o.y, z: o.z } : null;
}

/**
 * The text of a TextProperty when a player typed it; null when it is a localisation table entry (the game's default
 * name, `historyType` 11 with `tableId`/`textKey`) or empty.
 */
function playerText(p: Prop | undefined): string | undefined {
  const v = p?.value as { tableId?: unknown; value?: unknown; sourceString?: unknown } | undefined;
  if (!v || typeof v !== 'object' || v.tableId !== undefined) return undefined;
  const s = typeof v.value === 'string' ? v.value : typeof v.sourceString === 'string' ? v.sourceString : undefined;
  return s && s.trim() !== '' ? s.slice(0, MAX_NAME) : undefined;
}

/** Length caps the server's snapshot schema enforces (names 256, sign texts 32 × 1024). */
const MAX_NAME = 256;
const MAX_TEXTS = 32;
const MAX_TEXT = 1024;

/** FGuid as the parser gives it (four uint32) → 32 hex digits, upper case (UE `EGuidFormats::Digits`). */
export function guidHex(v: unknown): string | undefined {
  if (!Array.isArray(v) || v.length !== 4 || !v.every(n => typeof n === 'number')) return undefined;
  if (v.every(n => n === 0)) return undefined;
  return v.map(n => (n >>> 0).toString(16).toUpperCase().padStart(8, '0')).join('');
}

const round = (v: number, step: number) => Math.round(v / step) * step;
const round3 = (v: number) => Math.round(v * 1000) / 1000;

/** Linear colour channel (FLinearColor) → sRGB byte. */
function srgbByte(c: number): number {
  const v = Math.min(1, Math.max(0, c));
  const s = v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
  return Math.round(s * 255);
}

export function linearToHex(c: { r?: unknown; g?: unknown; b?: unknown } | undefined): string {
  const ch = (x: unknown) => srgbByte(typeof x === 'number' ? x : 1).toString(16).padStart(2, '0');
  return `#${ch(c?.r)}${ch(c?.g)}${ch(c?.b)}`;
}

// --- Inventories -----------------------------------------------------------------------------------

interface Slot { item?: string; count: number; allowed?: string; size: number }

/** The slots of an `FGInventoryComponent`: item, count, the slot's allowed item and its fixed size (0 = stack size). */
function slots(inv: FactoryObject | undefined): Slot[] {
  const p = inv?.properties;
  if (!p) return [];
  const stacks = Array.isArray(p.mInventoryStacks?.values) ? (p.mInventoryStacks.values as unknown[]) : [];
  const allowed = Array.isArray(p.mAllowedItemDescriptors?.values) ? (p.mAllowedItemDescriptors.values as unknown[]) : [];
  const sizes = Array.isArray(p.mArbitrarySlotSizes?.values) ? (p.mArbitrarySlotSizes.values as unknown[]) : [];
  const n = Math.max(stacks.length, allowed.length, sizes.length);
  const out: Slot[] = [];
  for (let i = 0; i < n; i++) {
    const sp = structProps(stacks[i]);
    const item = className(refPath((sp?.Item?.value as { itemReference?: Ref } | undefined)?.itemReference));
    const count = num(sp?.NumItems) ?? 0;
    const a = className(refPath(allowed[i]));
    const size = typeof sizes[i] === 'number' ? (sizes[i] as number) : 0;
    out.push({ item: count > 0 ? item : undefined, count, allowed: a === 'FGItemDescriptor' ? undefined : a, size });
  }
  return out;
}

/** The items in an inventory summed per class, most first (empty slots left out). */
export function cargoOf(inv: FactoryObject | undefined): SnapshotCargo[] {
  const per = new Map<string, number>();
  for (const s of slots(inv)) if (s.item && s.count > 0) per.set(s.item, (per.get(s.item) ?? 0) + s.count);
  return [...per].map(([item, count]) => ({ item, count })).sort((a, b) => b.count - a.count || a.item.localeCompare(b.item)).slice(0, MAX_CARGO);
}

/** Length cap of a cargo list (the server's schema enforces it too). */
const MAX_CARGO = 64;

/**
 * An inventory slot by slot (`SnapshotInventory`), or undefined without the component. `keep` picks the slots that
 * count (a machine's slots without an allowed item and without an item are unused spares).
 */
export function inventoryOf(inv: FactoryObject | undefined, keep: (s: Slot) => boolean = () => true): SnapshotInventory | undefined {
  if (!inv?.properties) return undefined;
  const all = slots(inv).filter(keep);
  return { slots: Math.min(all.length, MAX_SLOTS), items: packStacks(all) };
}

/** A machine's input or output slot that is in use: it has an allowed item (the recipe's) or holds something. */
const machineSlot = (s: Slot) => !!s.allowed || !!s.item;

/** The inventory when it holds anything. */
const filled = (inv: SnapshotInventory | undefined) => (inv && inv.items.length > 0 ? inv : undefined);

function countItems(inv: FactoryObject | undefined, cls: string): number {
  return slots(inv).reduce((n, s) => n + (s.item === cls ? s.count : 0), 0);
}

/** The game's stack sizes (`EStackSize`: small, medium, big, huge); fluid slots have a fixed size instead. */
const STACK_SIZES = [50, 100, 200, 500];

/**
 * Whether a slot is (nearly) full. Solid slots: at least 95 % (and at most 2 short) of the smallest game stack size
 * that holds the count; the save does not say an item's stack size, so a count just under a smaller stack size
 * (e.g. 48 of an item that stacks to 100) also counts. Fluid slots have a fixed size (litres, 50 000 in machines):
 * at least 80 %, since a fluid batch is several m³ (fuel: 4 m³) and the machine stops before the last of it.
 */
export function slotFull(s: Slot): boolean {
  if (s.count <= 0) return false;
  if (s.size > 0) return s.count >= s.size * 0.8;
  const cap = STACK_SIZES.find(n => n >= s.count) ?? s.count;
  return s.count >= cap - Math.max(2, Math.ceil(cap * 0.05));
}

// --- Production ------------------------------------------------------------------------------------

const SHARD = 'Desc_CrystalShard_C';
const SOMERSLOOP = 'Desc_WAT1_C';
/** Productivity at or above this counts as running fully; inventory hints are only reported below it. */
const FULL = 0.99;

interface PowerIndex {
  /** Power connection component path → its circuit is powered (has a generator or a battery, fuse intact). */
  circuitOf: Map<string, boolean>;
}

const POWER_COMPONENT = /\.Power(Input|Connection)\d*$/;
const GENERATOR_CLASS = /Generator|PowerStorage/;

function isProductionBuilding(p: Props): boolean {
  return 'mLastProductivityMeasurementDuration' in p || 'mCurrentRecipe' in p || 'mFuelInventory' in p
    || ('mInputInventory' in p && 'mOutputInventory' in p) || 'mExtractableResource' in p;
}

/**
 * Production data of a building, or undefined when it has none. See the module docs of `snapshot.ts`; the issue
 * rules are documented at `issues` below.
 */
function production(o: FactoryObject, cls: string, byName: Map<string, FactoryObject>, power: PowerIndex): SnapshotProduction | undefined {
  const p = o.properties;
  if (!p || !isProductionBuilding(p)) return undefined;
  const inv = (k: string) => { const r = ref(p[k]); return r ? byName.get(r) : undefined; };
  const pending = num(p.mPendingPotential), current = num(p.mCurrentPotential);
  const out: SnapshotProduction = { clock: round(pending ?? current ?? 1, 0.0001) };
  const recipe = className(ref(p.mCurrentRecipe));
  if (recipe) out.recipe = recipe;
  const window = num(p.mLastProductivityMeasurementDuration);
  if (window !== undefined && window > 0) {
    out.productivity = round3(Math.min(1, Math.max(0, (num(p.mLastProductivityMeasurementProduceDuration) ?? 0) / window)));
    out.windowSec = Math.round(window);
  }
  const producing = readBool(p.mIsProducing);
  out.producing = producing;
  const paused = readBool(p.mIsProductionPaused);
  if (paused) out.paused = true;
  const potential = inv('mInventoryPotential');
  const shards = countItems(potential, SHARD);
  if (shards > 0) out.powerShards = shards;
  const sloops = countItems(potential, SOMERSLOOP);
  if (sloops > 0) out.somersloops = sloops;

  /*
   * Issues, from the state at saving time. "Low" = productivity below 99 % or not producing; inventory hints are
   * only reported for low machines, so a machine running at 100 % with a momentarily empty input is not flagged.
   * - noRecipe: a manufacturer (input and output inventory) without a recipe.
   * - noPower: a consumer whose power connections are in no circuit, or only in circuits without any generator or
   *   battery, or whose circuit's fuse is blown (`mIsFuseTriggered`). Generators are never noPower.
   * - noFuel: a generator whose fuel slot is empty and that is out of burning fuel (`mCurrentFuelAmount` ≤ 0) or low.
   * - starved: a low machine with an empty recipe input slot; a generator with an empty supplemental slot (water)
   *   and none left; or a manufacturer that is not producing although it has a recipe, is not paused, not blocked
   *   and has power (the game then waits for ingredients).
   * - blocked: a low machine with an output slot that is (nearly) full, see `slotFull`.
   */
  const issues = new Set<NonNullable<SnapshotProduction['issues']>[number]>();
  const low = !producing || (out.productivity !== undefined && out.productivity < FULL);
  const isGenerator = 'mFuelInventory' in p || /Generator/.test(cls);
  const isManufacturer = 'mInputInventory' in p && 'mOutputInventory' in p;
  if (isManufacturer && !recipe) issues.add('noRecipe');
  if (!isGenerator) {
    const comps = (o.components ?? []).map(c => c.pathName).filter((c): c is string => !!c && POWER_COMPONENT.test(c));
    if (comps.length > 0 && !comps.some(c => power.circuitOf.get(c) === true)) issues.add('noPower');
  }
  if (isGenerator) {
    const fuel = slots(inv('mFuelInventory'));
    const fuelSlot = fuel[0];
    const burning = num(p.mCurrentFuelAmount) ?? 0;
    if (fuelSlot && fuelSlot.count <= 0 && (burning <= 0 || low)) issues.add('noFuel');
    const supplemental = fuel[1];
    if (supplemental?.allowed && supplemental.count <= 0 && (num(p.mCurrentSupplementalAmount) ?? 0) <= 0) issues.add('starved');
  }
  if (low) {
    const outputs = slots(inv('mOutputInventory')).filter(s => s.allowed || s.item);
    if (outputs.some(slotFull)) issues.add('blocked');
    const inputs = slots(inv('mInputInventory')).filter(s => s.allowed);
    if (inputs.some(s => s.count <= 0)) issues.add('starved');
    if (isManufacturer && recipe && !producing && !paused && !issues.has('blocked') && !issues.has('noPower')) issues.add('starved');
  }
  if (issues.size > 0) out.issues = [...issues];
  return out;
}

function powerIndex(objects: readonly FactoryObject[], byName: Map<string, FactoryObject>): PowerIndex {
  const circuitOf = new Map<string, boolean>();
  for (const o of objects) {
    if (o.typePath !== '/Script/FactoryGame.FGPowerCircuit') continue;
    const comps = Array.isArray(o.properties?.mComponents?.values) ? (o.properties.mComponents.values as Ref[]) : [];
    const paths = comps.map(c => refPath(c)).filter((c): c is string => c !== null);
    const hasSource = paths.some(c => GENERATOR_CLASS.test(shortName(c.slice(0, c.lastIndexOf('.'))))
      || GENERATOR_CLASS.test(byName.get(c.slice(0, c.lastIndexOf('.')))?.typePath ?? ''));
    const powered = hasSource && !readBool(o.properties?.mIsFuseTriggered);
    for (const c of paths) circuitOf.set(c, powered || circuitOf.get(c) === true);
  }
  return { circuitOf };
}

// --- Inventories -----------------------------------------------------------------------------------

/** Splitters and mergers buffer an item or two in a storage inventory; that is no storage. */
const NOT_STORAGE = /^Build_ConveyorAttachment/;

/**
 * What a building holds (see `SnapshotBuilding.inv`, `in`, `out`, `fuel`): storage its storage inventory (also when
 * empty), a fluid buffer its fluid (`mFluidBox`, m³, as litres of its pipe network's fluid), a machine its input,
 * output and fuel inventories when they hold anything. Stations keep theirs on `SnapshotStation`.
 */
function readInventories(o: FactoryObject, cls: string, b: SnapshotBuilding, byName: Map<string, FactoryObject>, fluidOfNet: Map<number, string>): void {
  const p = o.properties ?? {};
  const inv = (k: string) => { const r = ref(p[k]); return r ? byName.get(r) : undefined; };
  if ('mStorageInventory' in p && !NOT_STORAGE.test(cls)) {
    const storage = inventoryOf(inv('mStorageInventory'));
    if (storage) b.inv = storage;
  }
  if (cls in FLUID_BUFFER_M3) {
    // `mFluidBox` is a struct (FFluidBox) whose only field is the content in m³; the parser gives it as `{ value }`.
    const box = p.mFluidBox?.value;
    const m3 = (typeof box === 'number' ? box : num(box as Prop | undefined)) ?? 0;
    let fluid: string | undefined;
    for (const c of o.components ?? []) {
      const net = num(byName.get(c.pathName ?? '')?.properties?.mPipeNetworkID);
      fluid ??= net === undefined ? undefined : fluidOfNet.get(net);
    }
    const litres = Math.round(m3 * LITRES_PER_M3);
    b.inv = { slots: 1, items: fluid && litres > 0 ? [[fluid, litres]] : [] };
  }
  if (b.prod) {
    const input = filled(inventoryOf(inv('mInputInventory'), machineSlot));
    if (input) b.in = input;
    const output = filled(inventoryOf(inv('mOutputInventory'), machineSlot));
    if (output) b.out = output;
    const fuel = filled(inventoryOf(inv('mFuelInventory')));
    if (fuel) b.fuel = fuel;
  }
}

/** Pipe network id → its fluid (`FGPipeNetwork.mFluidDescriptor`, saved only for some networks). */
function pipeFluids(objects: readonly FactoryObject[]): Map<number, string> {
  const out = new Map<number, string>();
  for (const o of objects) {
    if (o.typePath !== '/Script/FactoryGame.FGPipeNetwork') continue;
    const net = num(o.properties?.mPipeNetworkID), fluid = className(ref(o.properties?.mFluidDescriptor));
    if (net !== undefined && fluid) out.set(net, fluid);
  }
  return out;
}

/** The Dimensional Depot's contents (`FGCentralStorageSubsystem.mStoredItems`): item and amount, empty ones left out. */
function readDepot(o: FactoryObject): [string, number][] {
  const list = o.properties?.mStoredItems?.values;
  const out: [string, number][] = [];
  if (!Array.isArray(list)) return out;
  for (const e of list) {
    const ep = structProps(e);
    const item = className(ref(ep?.ItemClass));
    const amount = num(ep?.Amount) ?? 0;
    if (item && amount > 0 && out.length < MAX_DEPOT_ITEMS) out.push([item, Math.round(amount)]);
  }
  return out;
}

// --- Classification --------------------------------------------------------------------------------

const BUILD_PREFIX = /^build_/i;
/** Path nodes go into `pathNetworks`, flow indicators are part of their pipe. */
const NOT_A_BUILDING = /^Build_VehiclePathNode_|^Build_PipelineFlowIndicator_C$/;
const STATION_CLASSES = /^Build_(TruckStation|TrainStation|TrainDockingStation|TrainDockingStationLiquid|DroneStation)_C$/;
/** Stations that load or unload; `mIsInLoadMode` is saved only when it differs from the default (load). */
const MODE_STATIONS = /^Build_(TruckStation|TrainDockingStation|TrainDockingStationLiquid)_C$/;
const VEHICLE_PATH = /\/Buildable\/Vehicle\//;
const DRONE_CLASS = 'BP_DroneTransport_C';
const LIFT_TOP = 'mTopTransform';

function splinePoints(p: Props | undefined): SplinePoint[] | null {
  const arr = p?.mSplineData?.values ?? p?.mSplinePoints?.values;
  if (!Array.isArray(arr) || arr.length < 2) return null;
  const out: SplinePoint[] = [];
  for (const e of arr) {
    const sp = structProps(e);
    const location = vec(sp?.Location?.value), arrive = vec(sp?.ArriveTangent?.value), leave = vec(sp?.LeaveTangent?.value);
    if (!location) return null;
    out.push({ location, arrive: arrive ?? { x: 0, y: 0, z: 0 }, leave: leave ?? { x: 0, y: 0, z: 0 } });
  }
  return out;
}

function swatchOf(p: Props): number | undefined {
  const c = structProps(p.mCustomizationData);
  const path = ref(c?.SwatchDesc);
  const m = path ? /SwatchDesc_Slot(\d+)_C$/.exec(path) : null;
  const n = m ? Number(m[1]) : undefined;
  return n ? n : undefined; // slot 0 (the default) left out
}

function signTexts(p: Props): string[] | undefined {
  const arr = p.mPrefabTextElementSaveData?.values;
  if (!Array.isArray(arr)) return undefined;
  const texts = arr.map(e => structProps(e)?.Text?.value).filter((t): t is string => typeof t === 'string' && t.trim() !== '');
  return texts.length > 0 ? texts.slice(0, MAX_TEXTS).map(t => t.slice(0, MAX_TEXT)) : undefined;
}

function heightOf(p: Props): number | undefined {
  const top = structProps(p[LIFT_TOP]);
  const z = vec(top?.Translation?.value)?.z ?? num(p.mHeight);
  return z !== undefined && Math.round(z) !== 0 ? roundUnit(z) : undefined;
}

function wirePoints(o: FactoryObject, byName: Map<string, FactoryObject>): number[] | null {
  const wires = o.properties?.mWireInstances?.values;
  const first = Array.isArray(wires) ? structProps(wires[0]) : undefined;
  const locs = first?.Locations as unknown;
  if (Array.isArray(locs) && locs.length >= 2) {
    const a = vec((locs[0] as Prop).value), b = vec((locs[1] as Prop).value);
    if (a && b) return [a.x, a.y, a.z, b.x, b.y, b.z].map(roundUnit);
  }
  // Older saves: the connected buildings' positions.
  const sp = o.specialProperties as { source?: Ref; target?: Ref } | undefined;
  const end = (r: Ref | undefined) => {
    const path = refPath(r);
    const owner = path ? byName.get(path.slice(0, path.lastIndexOf('.'))) : undefined;
    return owner?.transform?.translation;
  };
  const a = end(sp?.source), b = end(sp?.target);
  return a && b ? [a.x, a.y, a.z, b.x, b.y, b.z].map(roundUnit) : null;
}

// --- Extraction ------------------------------------------------------------------------------------

function saveTimeOf(raw: string): number {
  const n = Number(raw);
  // parser 4.1.2 already converts the header's ticks to unix ms; accept raw ticks too.
  return n > 1e15 ? saveTimeFromTicks(raw) : n;
}

const FOG_CHANNEL = 2;

/**
 * The explored area: `FGMapManager.mFogOfWarRawData` is width × height RGBA bytes (512 × 512 in 1.2), row-major with
 * rows along y (north first) and columns along x over the map's world bounds (checked against building positions);
 * byte 2 of each pixel is how explored it is (0 = never seen, 255 = explored), the others are constant.
 */
export function fogPng(raw: ArrayLike<number>): string | undefined {
  const n = Math.floor(raw.length / 4);
  const side = Math.round(Math.sqrt(n));
  if (side === 0 || side * side !== n) return undefined;
  const px = new Uint8Array(n);
  for (let i = 0; i < n; i++) px[i] = raw[i * 4 + FOG_CHANNEL]!;
  return toBase64(encodeGreyPng(px, side, side));
}

/** The factory snapshot of a parsed save. Pure: reads the save, never changes it. */
export function extractFactory(save: FactorySaveLike, opts: ExtractFactoryOptions = {}): FactorySnapshot {
  const tolerance = opts.splineTolerance ?? 50;
  const objects: FactoryObject[] = [];
  for (const level of Object.values(save.levels)) for (const o of level.objects) objects.push(o);
  const byName = new Map<string, FactoryObject>();
  for (const o of objects) byName.set(o.instanceName, o);
  const power = powerIndex(objects, byName);
  const fluidOfNet = pipeFluids(objects);

  const snap: FactorySnapshot = {
    v: FACTORY_SNAPSHOT_VERSION,
    meta: {
      sessionName: save.header.sessionName.slice(0, 255),
      saveTime: saveTimeOf(save.header.saveDateTime),
      build: save.header.buildVersion,
      inventories: true,
    },
    buildings: [], lightweight: [], splines: [], powerLines: [], pathNetworks: [], stations: [], vehicles: [],
    markers: [], crates: [],
  };
  if (typeof save.header.playDurationSeconds === 'number') snap.meta.playTimeSec = Math.round(save.header.playDurationSeconds);

  const stationObjs: { o: FactoryObject; b: SnapshotBuilding }[] = [];
  const vehicleObjs: FactoryObject[] = [];
  const pathNodes: FactoryObject[] = [];
  const pathSegments: FactoryObject[] = [];
  const identifiers: FactoryObject[] = [];
  const trains: FactoryObject[] = [];

  for (const o of objects) {
    const tp = o.typePath ?? '';
    const cls = shortName(tp);
    const p = o.properties ?? {};
    switch (cls) {
      case 'FGLightweightBuildableSubsystem': readLightweight(o, snap); continue;
      case 'FGMapManager': readMapManager(o, snap, opts); continue;
      case 'BP_GamePhaseManager_C': {
        const phase = className(ref(p.mCurrentGamePhase));
        if (phase) snap.meta.gamePhase = phase;
        continue;
      }
      case 'BP_SchematicManager_C': {
        const s = p.mPurchasedSchematics?.values;
        if (Array.isArray(s)) snap.meta.schematics = s.length;
        continue;
      }
      case 'BP_Crate_C': {
        const t = o.transform?.translation;
        if (!t) continue;
        const crate: FactorySnapshot['crates'][number] = {
          id: shortName(o.instanceName), x: roundUnit(t.x), y: roundUnit(t.y), z: roundUnit(t.z), kind: enumMember(p.mCrateType) ?? 'unknown',
        };
        const inv = inventoryOf(byName.get(`${o.instanceName}.inventory`));
        if (inv) crate.inv = inv;
        snap.crates.push(crate);
        continue;
      }
      case 'FGCentralStorageSubsystem':
        snap.depot = readDepot(o);
        continue;
      case 'FGDockingStationIdentifier': case 'FGTrainStationIdentifier': case 'FGWheeledVehicleIdentifier':
        identifiers.push(o);
        continue;
      case 'FGTrain': trains.push(o); continue;
    }
    if (o.type === 'SaveComponent' || !o.transform) continue;
    if (cls === DRONE_CLASS || (VEHICLE_PATH.test(tp) && !BUILD_PREFIX.test(cls))) {
      vehicleObjs.push(o);
      continue;
    }
    if (!BUILD_PREFIX.test(cls)) continue;
    if (cls.startsWith('Build_VehiclePathNode_')) { pathNodes.push(o); continue; }
    const id = shortName(o.instanceName);
    if (o.specialProperties?.type === 'PowerLineSpecialProperties' || 'mWireInstances' in p) {
      const seg = wirePoints(o, byName);
      if (seg) snap.powerLines.push(...seg);
      continue;
    }
    const sp = splinePoints(p);
    if (sp) {
      if ('mSplinePoints' in p) pathSegments.push(o);
      const world = sampleSpline(sp).map(v => toWorld(o.transform!, v));
      snap.splines.push({ id, cls, pts: flatPolyline(simplify(world, tolerance)) } satisfies SnapshotSpline);
      continue;
    }
    if (NOT_A_BUILDING.test(cls)) continue;
    const t = o.transform;
    const b: SnapshotBuilding = { id, cls, x: roundUnit(t.translation.x), y: roundUnit(t.translation.y), z: roundUnit(t.translation.z), yaw: yawOf(t.rotation) };
    const swatch = swatchOf(p);
    if (swatch !== undefined) b.swatch = swatch;
    const prod = production(o, cls, byName, power);
    if (prod) b.prod = prod;
    if (!STATION_CLASSES.test(cls)) readInventories(o, cls, b, byName, fluidOfNet);
    const texts = signTexts(p);
    if (texts) b.texts = texts;
    const height = heightOf(p);
    if (height !== undefined) b.height = height;
    const link = extractorLink(p);
    const target = link ? byName.get(link) : undefined;
    if (link && target && isResourceNodeType(target.typePath)) b.node = shortName(link);
    snap.buildings.push(b);
    if (STATION_CLASSES.test(cls)) stationObjs.push({ o, b });
  }

  readPathNetworks(pathNodes, pathSegments, snap);
  readStationsAndVehicles(stationObjs, vehicleObjs, identifiers, trains, byName, snap);
  const { links, circuits } = readConnections(objects, new Set(snap.buildings.map(b => b.id)));
  snap.links = links;
  snap.circuits = circuits;
  return snap;
}

function readLightweight(o: FactoryObject, snap: FactorySnapshot): void {
  const list = (o.specialProperties as { buildables?: unknown } | undefined)?.buildables;
  if (!Array.isArray(list)) return;
  for (const e of list as { typeReference?: Ref; instances?: { transform?: Transform }[] }[]) {
    const cls = className(refPath(e.typeReference));
    if (!cls || !Array.isArray(e.instances) || e.instances.length === 0) continue;
    const xyzYaw: number[] = [];
    for (const inst of e.instances) {
      const t = inst.transform;
      if (!t?.translation || !t.rotation) continue;
      xyzYaw.push(roundUnit(t.translation.x), roundUnit(t.translation.y), roundUnit(t.translation.z), yawOf(t.rotation));
    }
    if (xyzYaw.length > 0) snap.lightweight.push({ cls, xyzYaw });
  }
}

function readMapManager(o: FactoryObject, snap: FactorySnapshot, opts: ExtractFactoryOptions): void {
  const p = o.properties ?? {};
  const markers = p.mMapMarkers?.values;
  if (Array.isArray(markers)) {
    for (const m of markers) {
      const mp = structProps(m);
      if (!mp) continue;
      const loc = structProps(mp.Location);
      const x = num(loc?.X), y = num(loc?.Y), z = num(loc?.Z);
      if (x === undefined || y === undefined) continue;
      const marker: SnapshotMarker = {
        name: typeof mp.Name?.value === 'string' ? mp.Name.value.slice(0, MAX_NAME) : '',
        x: roundUnit(x), y: roundUnit(y), z: roundUnit(z ?? 0),
        kind: enumMember(mp.MapMarkerType) ?? 'RT_MapMarker',
        iconId: num(mp.IconID) ?? 0,
        color: linearToHex(mp.Color?.value as { r?: number } | undefined),
        scale: round(num(mp.Scale) ?? 1, 0.01),
      };
      snap.markers.push(marker);
    }
  }
  const fog = p.mFogOfWarRawData?.values as ArrayLike<number> | undefined;
  if (!opts.skipFog && fog && typeof fog.length === 'number' && fog.length > 0) {
    const png = fogPng(fog);
    if (png) snap.fog = png;
  }
}

function readPathNetworks(nodes: readonly FactoryObject[], segments: readonly FactoryObject[], snap: FactorySnapshot): void {
  const netOfNode = new Map<string, number>();
  const nets = new Map<number, { id: number; nodes: number; segments: string[] }>();
  for (const n of nodes) {
    const id = num(n.properties?.mPathNetworkID);
    if (id === undefined) continue;
    netOfNode.set(n.instanceName, id);
    let net = nets.get(id);
    if (!net) nets.set(id, (net = { id, nodes: 0, segments: [] }));
    net.nodes++;
  }
  for (const s of segments) {
    const start = ref(s.properties?.mStartNode), end = ref(s.properties?.mEndNode);
    const id = (start ? netOfNode.get(start) : undefined) ?? (end ? netOfNode.get(end) : undefined);
    if (id !== undefined) nets.get(id)!.segments.push(shortName(s.instanceName));
  }
  snap.pathNetworks = [...nets.values()].sort((a, b) => a.id - b.id);
}

function readStationsAndVehicles(
  stationObjs: readonly { o: FactoryObject; b: SnapshotBuilding }[], vehicleObjs: readonly FactoryObject[],
  identifiers: readonly FactoryObject[], trains: readonly FactoryObject[], byName: Map<string, FactoryObject>, snap: FactorySnapshot,
): void {
  /** Station building path → its identifier; identifier path → station id; path node GUID → station id. */
  const identOfStation = new Map<string, FactoryObject>();
  const stationOfIdent = new Map<string, string>();
  const vehicleIdent = new Map<string, FactoryObject>();
  for (const i of identifiers) {
    const p = i.properties ?? {};
    const station = ref(p.mStation);
    if (station) { identOfStation.set(station, i); stationOfIdent.set(i.instanceName, shortName(station)); }
    const vehicle = ref(p.mOwnerVehicle);
    if (vehicle) vehicleIdent.set(vehicle, i);
  }
  const stationOfGuid = new Map<string, string>();
  for (const { o, b } of stationObjs) {
    const p = o.properties ?? {};
    const ident = identOfStation.get(o.instanceName);
    const s: SnapshotStation = { id: b.id, cls: b.cls, x: b.x, y: b.y, z: b.z, yaw: b.yaw, traffic: [] };
    const name = playerText(ident?.properties?.mStationName);
    if (name) s.name = name;
    const dockNode = ref(p.mDockingPathNode);
    const guid = guidHex(ident?.properties?.mPathNodeGUID?.value) ?? guidHex(dockNode ? byName.get(dockNode)?.properties?.mPathNodeGUID?.value : undefined);
    if (guid) { s.nodeGuid = guid; stationOfGuid.set(guid, s.id); }
    if (MODE_STATIONS.test(b.cls)) s.loading = 'mIsInLoadMode' in p ? readBool(p.mIsInLoadMode) : true;
    const tracking = p.mVehicleTracking?.values;
    if (Array.isArray(tracking)) {
      for (const t of tracking) {
        const tp = structProps(t);
        const vehicle = ref(tp?.OwnerVehicle);
        if (!tp || !vehicle) continue;
        const entry: SnapshotStation['traffic'][number] = { vehicle: shortName(vehicle) };
        const avgSec = num(tp.AverageTimeBetweenDocks), avgItems = num(tp.AverageItemsTransferredPerDock);
        const stacks = num(tp.VehicleInventorySizeLinear), fluid = num(tp.VehicleFluidSlotCapacity);
        if (avgSec !== undefined && avgSec > 0) entry.avgSecBetweenDocks = round(avgSec, 0.1);
        if (avgItems !== undefined) entry.avgItemsPerDock = round(avgItems, 0.1);
        if (stacks) entry.capacityStacks = stacks;
        if (fluid) entry.capacityFluid = fluid;
        s.traffic.push(entry);
      }
    }
    // The station's storage is its component `inventory` (truck stations, checked in 1.2 saves); other kinds may name it
    // differently, then there is no cargo.
    const store = byName.get(`${o.instanceName}.inventory`) ?? byName.get(`${o.instanceName}.Inventory`);
    const cargo = cargoOf(store);
    if (cargo.length > 0) s.cargo = cargo;
    const inv = inventoryOf(store);
    if (inv) s.inv = inv;
    snap.stations.push(s);
  }

  // Trains (not seen in a save yet): FGTrain's timetable stops refer to station identifiers; the route goes on the
  // train's first vehicle.
  const trainOfVehicle = new Map<string, FactoryObject>();
  for (const tr of trains) {
    const first = ref(tr.properties?.FirstVehicle);
    if (first) trainOfVehicle.set(first, tr);
  }

  for (const o of vehicleObjs) {
    const t = o.transform!;
    const p = o.properties ?? {};
    const v: SnapshotVehicle = {
      id: shortName(o.instanceName), cls: shortName(o.typePath ?? ''),
      x: roundUnit(t.translation.x), y: roundUnit(t.translation.y), z: roundUnit(t.translation.z), yaw: yawOf(t.rotation),
      autopilot: false, route: [],
    };
    const ident = vehicleIdent.get(o.instanceName);
    const train = trainOfVehicle.get(o.instanceName);
    if (ident) {
      const ip = ident.properties ?? {};
      const name = playerText(ip.mVehicleName);
      if (name) v.name = name;
      v.autopilot = readBool(ip.mIsAutopilotEnabled);
      const route = ip.mVehicleRoute?.values;
      if (Array.isArray(route)) {
        for (const g of route) {
          const station = stationOfGuid.get(guidHex(g) ?? '');
          if (station) v.route.push(station);
        }
      }
    } else if (train) {
      const tp = train.properties ?? {};
      const name = playerText(tp.mTrainName);
      if (name) v.name = name;
      v.autopilot = readBool(tp.mIsSelfDrivingEnabled);
      const table = byName.get(ref(tp.TimeTable) ?? '');
      const stops = table?.properties?.mStops?.values;
      if (Array.isArray(stops)) {
        for (const st of stops) {
          const station = stationOfIdent.get(ref(structProps(st)?.Station) ?? '');
          if (station) v.route.push(station);
        }
      }
    }
    const fuelSlot = slots(byName.get(`${o.instanceName}.FuelInventory`))[0];
    const fuelType = className(ref(ident?.properties?.mFuelTypeDescriptor));
    if (fuelSlot?.item) v.fuel = { item: fuelSlot.item, amount: fuelSlot.count };
    else if (fuelSlot && fuelType) v.fuel = { item: fuelType, amount: 0 };
    const storage = byName.get(`${o.instanceName}.StorageInventory`);
    if (storage) {
      const cargo = cargoOf(storage);
      if (cargo.length > 0) v.cargo = cargo;
      const n = slots(storage).length;
      if (n > 0) v.slots = n;
      const inv = inventoryOf(storage);
      if (inv) v.inv = inv;
    }
    snap.vehicles.push(v);
  }
}
