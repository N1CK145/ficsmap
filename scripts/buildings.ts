import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { byClassName, readDocsFile, type DocsClass } from './game-docs.js';
import { displayName, nativeName } from './machines.js';
import type { BuildingCategory, BuildingEntry, BuildingGap, BuildingsFile, Footprint, FootprintBox, Vec3 } from '../src/shared/buildings.js';

/**
 * The dataset part `buildings` (see src/shared/buildings.ts): every buildable and vehicle class with its footprint,
 * names, category and picture, from the extractor's `buildings-raw.json` (`--buildings-out`: clearance boxes, grid
 * sizes and mesh bounds read from the blueprints in the paks) and the game's Docs (`en-US.json`, `de.json`: names, and a
 * cross-check of the clearance boxes and grid sizes). See data-src/extractor/README.md, "Buildings".
 */

export class BuildingBuildError extends Error {
  constructor(public problems: string[]) {
    super(`Buildings build failed:\n- ${problems.join('\n- ')}`);
    this.name = 'BuildingBuildError';
  }
}

interface RawVec { x: number; y: number; z: number }
interface RawClearance {
  min: RawVec; max: RawVec;
  type: string | null;
  excludeForSnapping: boolean | null;
  transform: { translation: RawVec; rotation: [number, number, number, number]; scale: RawVec } | null;
}
interface RawBuilding {
  asset: string;
  nativeClass: string | null;
  parents: string[];
  descriptor: { class: string; category: string | null; subCategories: string[]; menuPriority: number | null } | null;
  displayName: string | null;
  clearance: RawClearance[] | null;
  grid: { width: number | null; depth: number | null; height: number | null; elevation: number | null; size: RawVec | null } | null;
  mesh: { min: RawVec; max: RawVec; source: string; meshes: string[] } | null;
  refs: string[];
}
export interface RawBuildings {
  gameVersion: string;
  buildings: Record<string, RawBuilding>;
  vehicles: Record<string, RawBuilding>;
  failed?: Record<string, string>;
}

// ---- categories ----

/**
 * Category by the class's native (C++) class. Native classes the game uses for several kinds of buildables
 * (FGBuildable, FGBuildableFactory, poles and passthroughs) are sorted by class name in `BY_NAME` instead.
 */
const BY_NATIVE: Record<string, BuildingCategory> = {
  // production
  FGBuildableManufacturer: 'production',
  FGBuildableManufacturerVariablePower: 'production',
  FGBuildableAutomatedWorkBench: 'production',
  // extraction
  FGBuildableResourceExtractor: 'extraction',
  FGBuildableWaterPump: 'extraction',
  FGBuildableFrackingExtractor: 'extraction',
  FGBuildableFrackingActivator: 'extraction',
  // power
  FGBuildableGeneratorFuel: 'power-gen',
  FGBuildableGeneratorNuclear: 'power-gen',
  FGBuildableGeneratorGeoThermal: 'power-gen',
  FGBuildablePowerBooster: 'power-gen',
  FGBuildablePowerStorage: 'power-storage',
  FGBuildablePowerPole: 'power-pole',
  FGBuildableWire: 'power-pole',
  FGBuildableCircuitSwitch: 'power-pole',
  FGBuildablePriorityPowerSwitch: 'power-pole',
  // belts
  FGBuildableConveyorBelt: 'logistics-belt',
  FGBuildableConveyorLift: 'logistics-belt',
  FGBuildableAttachmentMerger: 'logistics-belt',
  FGBuildableAttachmentSplitter: 'logistics-belt',
  FGBuildableMergerPriority: 'logistics-belt',
  FGBuildableSplitterSmart: 'logistics-belt',
  FGBuildableConveyorMonitor: 'logistics-belt',
  FGBuildablePoleConveyor: 'logistics-belt',
  // pipes
  FGBuildablePipeline: 'logistics-pipe',
  FGBuildablePipelineJunction: 'logistics-pipe',
  FGBuildablePipelinePump: 'logistics-pipe',
  FGBuildablePipelineFlowIndicator: 'logistics-pipe',
  // storage (incl. fluid buffers and the dimensional depot uploader)
  FGBuildableStorage: 'storage',
  FGBuildablePipeReservoir: 'storage',
  FGCentralStorageContainer: 'storage',
  // transport: stations, rails, vehicle paths, the personnel elevator
  FGBuildableDockingStation: 'transport',
  FGBuildableDroneStation: 'transport',
  FGBuildableRailroadStation: 'transport',
  FGBuildableTrainPlatformCargo: 'transport',
  FGBuildableTrainPlatformEmpty: 'transport',
  FGBuildableRailroadTrack: 'transport',
  FGBuildableRailroadSignal: 'transport',
  FGBuildableRailroadSwitchControl: 'transport',
  FGBuildableRailroadAttachment: 'transport',
  FGVehiclePathSegment: 'transport',
  FGVehiclePathNode: 'transport',
  FGStandaloneVehiclePathNode: 'transport',
  FGBuildableElevator: 'transport',
  FGBuildableElevatorFloorStop: 'transport',
  // hypertubes
  FGBuildablePipeHyper: 'hypertube',
  FGBuildablePipeHyperJunction: 'hypertube',
  FGPipeHyperStart: 'hypertube',
  FGBuildablePassthroughPipeHyper: 'hypertube',
  // structure
  FGBuildableFoundation: 'structure',
  FGBuildableFoundationLightweight: 'structure',
  FGBuildableWall: 'structure',
  FGBuildableWallLightweight: 'structure',
  FGBuildableCornerWall: 'structure',
  FGBuildableCornerWallLightweight: 'structure',
  FGBuildableRampLightweight: 'structure',
  FGBuildablePillarLightweight: 'structure',
  FGBuildableWalkway: 'structure',
  FGBuildableWalkwayLightweight: 'structure',
  FGBuildableStair: 'structure',
  FGBuildableBeam: 'structure',
  FGBuildableFactoryBuilding: 'structure', // beam connectors and supports
  FGBuildableDoor: 'structure',
  FGBuildableBarrierCorner: 'structure',
  FGBuildableLadder: 'structure',
  // special: HUB, space elevator, MAM, sink, radar, jump pads, portals
  FGBuildableTradingPost: 'special',
  FGBuildableHubTerminal: 'special',
  FGBuildableSpaceElevator: 'special',
  FGBuildableMAM: 'special',
  FGBuildableResourceSink: 'special',
  FGBuildableResourceSinkShop: 'special',
  FGBuildableRadarTower: 'special',
  FGBuildableJumppad: 'special',
  FGBuildablePortal: 'special',
  FGBuildablePortalSatellite: 'special',
  // signs
  FGBuildableWidgetSign: 'sign',
  FGBuildableSignSupport: 'sign',
};

/** Native classes shared by several kinds: the class name decides (first match), else `other`. */
const SHARED_NATIVES = new Set(['FGBuildable', 'FGBuildableFactory', 'FGBuildablePoleStackable', 'FGBuildablePolePipe', 'FGBuildablePassthrough', 'FGBuildablePoleBase']);
const BY_NAME: [RegExp, BuildingCategory][] = [
  [/Hyper/i, 'hypertube'], // hypertube supports, wall holes and wall supports
  [/Pipe/i, 'logistics-pipe'], // pipe supports and passthroughs
  [/Conveyor|Lift/i, 'logistics-belt'], // conveyor poles, wall holes, ceiling mounts, lift passthroughs
  [/JumpPad|LandingPad|LookoutTower/i, 'special'],
  [/PowerSource/i, 'power-gen'],
];

/** The category of a class from its native class and name (vehicles are `transport`). */
export function buildingCategory(cls: string, nativeClass: string | null, vehicle = false): BuildingCategory {
  if (vehicle) return 'transport';
  if (nativeClass && SHARED_NATIVES.has(nativeClass)) return BY_NAME.find(([re]) => re.test(cls))?.[1] ?? 'other';
  return (nativeClass && BY_NATIVE[nativeClass]) || 'other';
}

// ---- geometry ----

const round = (n: number): number => Math.round(n * 10) / 10 + 0; // + 0: no -0

/** Rotates v by the unit quaternion (x, y, z, w). */
function rotate([qx, qy, qz, qw]: readonly number[], [x, y, z]: Vec3): Vec3 {
  // v' = v + 2w (u x v) + 2 u x (u x v)
  const cx = qy! * z - qz! * y, cy = qz! * x - qx! * z, cz = qx! * y - qy! * x;
  const dx = qy! * cz - qz! * cy, dy = qz! * cx - qx! * cz, dz = qx! * cy - qy! * cx;
  return [x + 2 * (qw! * cx + dx), y + 2 * (qw! * cy + dy), z + 2 * (qw! * cz + dz)];
}

/**
 * A clearance entry as an axis-aligned box in the actor's frame: its box scaled, rotated and moved by its relative
 * transform (the bounding box of the eight corners when the rotation is not a multiple of 90° about z).
 */
export function clearanceBox(c: RawClearance): FootprintBox {
  const t = c.transform;
  const corners: Vec3[] = [];
  for (const x of [c.min.x, c.max.x]) for (const y of [c.min.y, c.max.y]) for (const z of [c.min.z, c.max.z]) {
    if (!t) { corners.push([x, y, z]); continue; }
    const r = rotate(t.rotation, [x * t.scale.x, y * t.scale.y, z * t.scale.z]);
    corners.push([r[0] + t.translation.x, r[1] + t.translation.y, r[2] + t.translation.z]);
  }
  const box: FootprintBox = {
    min: [0, 1, 2].map(i => round(Math.min(...corners.map(p => p[i]!)))) as Vec3,
    max: [0, 1, 2].map(i => round(Math.max(...corners.map(p => p[i]!)))) as Vec3,
  };
  if (c.type === 'CT_Soft') box.soft = true;
  return box;
}

/** The Docs' `mClearanceData` text: the untransformed boxes, for the cross-check with the extractor. */
export function docsClearanceBoxes(value: string | undefined): number[][] {
  const num = '(-?[\\d.]+)';
  const re = new RegExp(`ClearanceBox=\\(Min=\\(X=${num},Y=${num},Z=${num}\\),Max=\\(X=${num},Y=${num},Z=${num}\\)`, 'g');
  return [...(value ?? '').matchAll(re)].map(m => m.slice(1, 7).map(Number));
}

// ---- build ----

export interface BuildingSummary {
  total: number;
  vehicles: number;
  bySource: Record<'clearance' | 'mesh' | 'none', number>;
  withIcon: number;
  nameGaps: string[];
  perCategory: Partial<Record<BuildingCategory, number>>;
}

const vec = (v: RawVec): number[] => [v.x, v.y, v.z];
const close = (a: number, b: number) => Math.abs(a - b) <= 0.05;
const docsNum = (c: DocsClass | undefined, key: string): number | null => {
  const s = c?.[key];
  if (s === undefined || s.trim() === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};
/** Docs `mSize` "(X=400.000000,Y=400.000000,Z=400.000000)". */
const docsSize = (c: DocsClass | undefined): number[] | null => {
  const m = /X=(-?[\d.]+),Y=(-?[\d.]+),Z=(-?[\d.]+)/.exec(c?.mSize ?? '');
  return m ? m.slice(1, 4).map(Number) : null;
};

/**
 * `buildings.json` from the extractor's raw data and the Docs (en, de). `iconClasses`: the descriptor classes that have
 * a picture (the extractor's icon index); without it no entry gets an `icon`. Fails on what does not fit together: a
 * Docs buildable the extractor did not find, clearance boxes or grid sizes that differ between the two sources, a
 * class missing in de.json.
 */
export function buildBuildingData(raw: RawBuildings, enDocs: readonly DocsClass[], deDocs: readonly DocsClass[], iconClasses?: ReadonlySet<string>): BuildingsFile {
  const problems: string[] = [];
  if (!raw || typeof raw !== 'object' || !raw.buildings || !raw.vehicles) throw new BuildingBuildError(['buildings-raw.json has no buildings/vehicles']);
  const en = byClassName(enDocs);
  const de = byClassName(deDocs);
  const all = new Map<string, { raw: RawBuilding; vehicle: boolean }>();
  for (const [cls, b] of Object.entries(raw.buildings)) all.set(cls, { raw: b, vehicle: false });
  for (const [cls, b] of Object.entries(raw.vehicles)) all.set(cls, { raw: b, vehicle: true });

  // Every buildable of the Docs must be in the raw data (the Docs list what the game can build).
  for (const c of enDocs) {
    if (/^Build_/i.test(c.ClassName) && !all.has(c.ClassName)) problems.push(`${c.ClassName} (${nativeName(c)}) is in the Docs but not in buildings-raw.json`);
  }

  // Who places whom: classes that no descriptor builds are parts of the classes that name them.
  const owners = new Map<string, string[]>();
  for (const [cls, { raw: b }] of all) {
    for (const r of b.refs ?? []) {
      if (r === cls || !all.has(r) || all.get(r)!.raw.descriptor) continue;
      owners.set(r, [...(owners.get(r) ?? []), cls]);
    }
  }

  const name = (c: DocsClass | undefined) => (c?.mDisplayName ? displayName(c.mDisplayName) : '');
  const out: Record<string, BuildingEntry> = {};
  for (const [cls, { raw: b, vehicle }] of [...all].sort(([a], [c]) => (a < c ? -1 : a > c ? 1 : 0))) {
    const missing: BuildingGap[] = [];
    // Names: the class in the Docs, else its descriptor in the Docs, else the blueprint's own (English only).
    const docsCls = en.has(cls) ? cls : b.descriptor && en.has(b.descriptor.class) ? b.descriptor.class : undefined;
    let names: { en: string; de: string };
    if (docsCls && name(en.get(docsCls))) {
      const deName = name(de.get(docsCls));
      if (!de.has(docsCls)) problems.push(`${docsCls} is in en-US.json but not in de.json`);
      names = { en: name(en.get(docsCls)), de: deName || name(en.get(docsCls)) };
      if (!deName) missing.push('nameDe');
    } else if (b.displayName) {
      names = { en: displayName(b.displayName), de: displayName(b.displayName) };
      missing.push('nameDe');
    } else {
      names = { en: cls, de: cls };
      missing.push('name');
    }

    const partOf = b.descriptor ? undefined : owners.get(cls)?.sort();
    let category = buildingCategory(cls, b.nativeClass, vehicle);
    if (partOf) {
      const ownerCats = new Set(partOf.map(o => buildingCategory(o, all.get(o)!.raw.nativeClass, all.get(o)!.vehicle)));
      if (ownerCats.size === 1) category = [...ownerCats][0]!;
    }

    // Footprint: clearance boxes, cross-checked with the Docs; else the mesh bounds.
    const docs = en.get(cls);
    if (docs) {
      const d = docsClearanceBoxes(docs.mClearanceData);
      const r = (b.clearance ?? []).map(c => [...vec(c.min), ...vec(c.max)]);
      if (d.length !== r.length || d.some((box, i) => box.some((v, j) => !close(v, r[i]![j]!)))) {
        problems.push(`${cls}: clearance boxes differ between the Docs (${JSON.stringify(d)}) and the paks (${JSON.stringify(r)})`);
      }
    }
    let footprint: Footprint | undefined;
    if (b.clearance && b.clearance.length > 0) footprint = { boxes: b.clearance.map(clearanceBox), source: 'clearance' };
    else if (b.mesh) footprint = { boxes: [{ min: vec(b.mesh.min).map(round) as Vec3, max: vec(b.mesh.max).map(round) as Vec3 }], source: 'mesh' };

    const entry: BuildingEntry = { name: names, category };
    if (footprint) entry.footprint = footprint;

    // Grid size of structural pieces: the paks' value, else the Docs' (the Docs resolve C++ defaults); both must agree.
    if (category === 'structure') {
      const pick = (field: string, rawValue: number | null | undefined): number | undefined => {
        const docsValue = docsNum(docs, field);
        if (rawValue != null && docsValue != null && !close(rawValue, docsValue)) problems.push(`${cls}: ${field} is ${rawValue} in the paks but ${docsValue} in the Docs`);
        const v = rawValue ?? docsValue;
        return v != null && v > 0 ? round(v) : undefined;
      };
      const g = b.grid;
      const rawSize = g?.size ? vec(g.size) : null;
      const dSize = docsSize(docs);
      if (rawSize && dSize && rawSize.some((v, i) => !close(v, dSize[i]!))) problems.push(`${cls}: mSize differs between the paks and the Docs`);
      const s = rawSize ?? dSize;
      const size = {
        w: s ? round(s[0]!) : pick('mWidth', g?.width),
        d: s ? round(s[1]!) : pick('mDepth', g?.depth),
        h: s ? round(s[2]!) : pick('mHeight', g?.height),
        elevation: pick('mElevation', g?.elevation),
      };
      const present = Object.fromEntries(Object.entries(size).filter(([, v]) => v !== undefined && v > 0));
      if (Object.keys(present).length > 0) entry.size = present;
    }

    if (b.descriptor && iconClasses?.has(b.descriptor.class)) entry.icon = b.descriptor.class;
    if (partOf) entry.partOf = partOf;
    if (vehicle) entry.vehicle = true;
    if (missing.length > 0) entry.missing = missing;
    out[cls] = entry;
  }
  if (problems.length > 0) throw new BuildingBuildError(problems);
  return { version: raw.gameVersion, buildings: out };
}

export function buildingSummary(file: BuildingsFile): BuildingSummary {
  const entries = Object.entries(file.buildings);
  const perCategory: Partial<Record<BuildingCategory, number>> = {};
  for (const [, b] of entries) perCategory[b.category] = (perCategory[b.category] ?? 0) + 1;
  return {
    total: entries.length,
    vehicles: entries.filter(([, b]) => b.vehicle).length,
    bySource: {
      clearance: entries.filter(([, b]) => b.footprint?.source === 'clearance').length,
      mesh: entries.filter(([, b]) => b.footprint?.source === 'mesh').length,
      none: entries.filter(([, b]) => !b.footprint).length,
    },
    withIcon: entries.filter(([, b]) => b.icon).length,
    nameGaps: entries.filter(([, b]) => b.missing?.includes('name')).map(([c]) => c),
    perCategory,
  };
}

/** One line for the build log. */
export function buildingSummaryLine(file: BuildingsFile, bytes: number): string {
  const s = buildingSummary(file);
  return `${s.total} classes (${s.vehicles} vehicles): footprint from clearance ${s.bySource.clearance}, mesh ${s.bySource.mesh}, none ${s.bySource.none}; `
    + `${s.withIcon} with a picture; ${s.nameGaps.length} without a name in the game files; ${(bytes / 1e3).toFixed(0)} KB`;
}

/** Builds and writes `<outDir>/buildings.json`. */
export function writeBuildings(rawPath: string, docsDir: string, outDir: string, iconClasses?: ReadonlySet<string>): { file: BuildingsFile; bytes: number } {
  const file = buildBuildingsFromFiles(rawPath, docsDir, iconClasses);
  const json = JSON.stringify(file);
  writeFileSync(join(outDir, 'buildings.json'), json);
  return { file, bytes: Buffer.byteLength(json) };
}

export function buildBuildingsFromFiles(rawPath: string, docsDir: string, iconClasses?: ReadonlySet<string>): BuildingsFile {
  const raw = JSON.parse(readFileSync(rawPath, 'utf8')) as RawBuildings;
  return buildBuildingData(raw, readDocsFile(join(docsDir, 'en-US.json')), readDocsFile(join(docsDir, 'de.json')), iconClasses);
}

/** The descriptor classes whose pictures the buildings use (for the `icons` part). */
export function buildingIconClasses(file: BuildingsFile): Set<string> {
  return new Set(Object.values(file.buildings).flatMap(b => (b.icon ? [b.icon] : [])));
}
