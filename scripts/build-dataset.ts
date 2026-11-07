import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { COLLECTIBLE_TYPES, classify, typeById } from '../src/shared/collectibleTypes.js';
import { assignBiome, loadEditorBiomes, type BiomeShape } from '../src/shared/biomes.js';
import { cavesToGeojson, type RawCaves } from '../src/shared/caves.js';
import { sampleCaves } from './cave-geometry.js';
import { readHeightGrid, writeHeightTiles } from './heightmap.js';
import { AREA_SNAP, biomesFromAreas, readMapAreas, SEA_LEVEL } from './map-areas.js';
import { UNITS_PER_METER, type Calibration } from '../src/shared/geo.js';
import type { CollectibleTypeId, WorldBounds } from '../src/shared/types.js';
import type { CrashSites, Dataset, DatasetItemTuple, ItemExtra, PodRequirement } from '../src/shared/dataset.js';
import { GEYSER_RESOURCE, purityFromGame, type NodeKind, type Purity, type ResourceNodesFile, type ResourceNodeTuple } from '../src/shared/resourceNodes.js';

export class BuildError extends Error {
  constructor(public problems: string[]) {
    super(`Dataset build failed:\n- ${problems.join('\n- ')}`);
    this.name = 'BuildError';
  }
}

export interface BuildInput {
  collectibles: unknown;
  extras: unknown;
  map: unknown;
  biomesGeojson: unknown;
  calibration: Calibration;
  /** descriptor class (Desc_X_C) -> English display name; used for both locales */
  itemNames: Record<string, string>;
  snapUnits: number;
  build: number;
  /** data-src/crash-sites/crash-sites.json (Steam guide + game pickups), optional. */
  crashSites?: unknown;
  /** Names of the items that lie in a cave (from sampleCaves), optional. They get `extra.cave`. */
  itemsInCaves?: ReadonlySet<string>;
  /** Biomes from the game's map areas (biomesFromAreas), optional; replace the editor polygons when given. */
  biomeAreas?: { biomes: BiomeShape[]; assign: (x: number, y: number) => number };
}

interface RawEntry { name: string; class: string; location: [number, number, number] }
interface RawPod { costType: string | null; item: string | null; amount: number; power: number }
interface RawShrine { name: string; attachedTo: string }
interface RawCrashSite {
  requirement?: { type: string };
  items?: { item: string; amount: number; pickup?: string; where?: string; inGame?: boolean }[];
  threats?: { name: string; count: number | null }[];
  notes?: string[];
}
const crashSitePods = (raw: unknown): Record<string, RawCrashSite> => (raw as { pods?: Record<string, RawCrashSite> } | undefined)?.pods ?? {};
interface RawMap { id: string; gameVersion?: string; world: WorldBounds }

const DEFAULT_BUILD = 513885;

function podRequirement(raw: RawPod, itemNames: Record<string, string>, problems: string[]): PodRequirement | undefined {
  const hasItem = !!raw.item && raw.amount > 0;
  const hasPower = raw.power > 0;
  let useItem: boolean;
  let usePower: boolean;
  if (raw.costType === 'Item') { useItem = hasItem; usePower = false; }
  else if (raw.costType === 'Power') { useItem = false; usePower = hasPower; }
  else if (raw.costType === 'None') { useItem = hasItem; usePower = hasPower; }
  else return undefined; // no mUnlockCost: requirement unknown
  if (!useItem && !usePower) return undefined;
  let item: PodRequirement['item'] = null;
  if (useItem) {
    const en = itemNames[raw.item!];
    if (en === undefined) problems.push(`Pod item ${raw.item} has no entry in item-names.json`);
    item = { en: en ?? raw.item!, de: en ?? raw.item! };
  }
  return { item, amount: useItem ? raw.amount : 0, power: usePower ? raw.power : 0 };
}

export function buildDataset(input: BuildInput): Dataset {
  const problems: string[] = [];
  const coll = input.collectibles as { pickups: RawEntry[]; dropPods: RawEntry[] };
  const extras = input.extras as { dropPods: Record<string, RawPod>; shrines: RawShrine[] };
  const map = input.map as RawMap;
  const biomes: BiomeShape[] = input.biomeAreas?.biomes ?? loadEditorBiomes(input.biomesGeojson, input.calibration);
  const biomeAt = input.biomeAreas?.assign ?? ((x: number, y: number) => assignBiome(x, y, biomes, input.snapUnits));
  const order = new Map(COLLECTIBLE_TYPES.map((t, i) => [t.id, i]));

  interface Work { name: string; type: CollectibleTypeId; x: number; y: number; z: number; biome: number; extra?: ItemExtra }
  const work: Work[] = [];
  const seen = new Set<string>();
  for (const source of ['pickups', 'dropPods'] as const) {
    for (const e of coll[source]) {
      const type = classify(source, e.class);
      if (!type) continue;
      if (seen.has(e.name)) { problems.push(`Duplicate item name ${e.name}`); continue; }
      seen.add(e.name);
      const [x, y, z] = e.location;
      const biome = biomeAt(x, y);
      if (biome < 0) {
        problems.push(`Item ${e.name} (${type}, x=${x}, y=${y}) is outside every biome beyond the snap distance`);
      }
      const w: Work = { name: e.name, type, x, y, z, biome };
      const t = typeById(type);
      if (t.powerShards !== undefined) w.extra = { shards: t.powerShards };
      if (t.details === 'dropPod') {
        const raw = extras.dropPods[e.name];
        let pod = raw && podRequirement(raw, input.itemNames, problems);
        // The game data has no cost for some pods; where the crash-site guide says none is needed, trust it.
        if (!pod && crashSitePods(input.crashSites)[e.name]?.requirement?.type === 'none') pod = { item: null, amount: 0, power: 0 };
        if (pod) w.extra = { pod };
      }
      if (input.itemsInCaves?.has(e.name)) w.extra = { ...w.extra, cave: true };
      work.push(w);
    }
  }

  for (const t of COLLECTIBLE_TYPES) {
    if (!work.some(w => w.type === t.id)) problems.push(`Type ${t.id} has 0 items`);
  }

  // Shrine -> sphere aliases (exact, via attachedTo)
  const aliases: Record<string, string> = {};
  const shrineCount = new Map<string, string[]>();
  const spheres = new Set(work.filter(w => w.type === 'mercer_sphere').map(w => w.name));
  for (const s of extras.shrines) {
    if (!spheres.has(s.attachedTo)) {
      problems.push(`Shrine ${s.name} is attached to ${s.attachedTo}, which is not a Mercer Sphere item`);
      continue;
    }
    shrineCount.set(s.attachedTo, [...(shrineCount.get(s.attachedTo) ?? []), s.name]);
    aliases[s.name] = s.attachedTo;
  }
  for (const [sphere, shrines] of shrineCount) {
    if (shrines.length > 1) problems.push(`Sphere ${sphere} has ${shrines.length} shrines: ${shrines.join(', ')}`);
  }
  if (extras.shrines.length > 0) {
    for (const sphere of spheres) {
      if (!shrineCount.has(sphere)) problems.push(`Sphere ${sphere} has no shrine`);
    }
  }

  if (problems.length > 0) throw new BuildError(problems);

  // seq per biome: (type order, x, y), numbered from 1
  const items: DatasetItemTuple[] = [];
  for (let b = 0; b < biomes.length; b++) {
    const inBiome = work
      .filter(w => w.biome === b)
      .sort((a, c) => order.get(a.type)! - order.get(c.type)! || a.x - c.x || a.y - c.y);
    inBiome.forEach((w, i) => {
      const tuple: DatasetItemTuple = [w.name, w.type, w.x, w.y, w.z, b, i + 1];
      if (w.extra) tuple.push(w.extra);
      items.push(tuple);
    });
  }

  return {
    version: map.gameVersion ?? (coll as { gameVersion?: string }).gameVersion ?? '',
    build: input.build,
    bounds: map.world,
    mapId: map.id,
    podRequirementsKnown: Object.keys(extras.dropPods).length > 0,
    biomes: biomes.map(b => ({ id: b.id, name: { en: b.name, de: b.nameDe ?? b.name } })),
    items,
    aliases,
  };
}

/**
 * Per pod of the dataset: the items lying around its crash site (only pickups that exist in the game),
 * threats and notes, from data-src/crash-sites/crash-sites.json. Served as `crash-sites.json`.
 */
export function buildCrashSites(raw: unknown, ds: Dataset): CrashSites {
  const pods = new Set(ds.items.filter(i => i[1] === 'hard_drive').map(i => i[0]));
  const out: CrashSites = {};
  for (const [name, site] of Object.entries(crashSitePods(raw))) {
    if (!pods.has(name)) continue;
    out[name] = {
      items: (site.items ?? []).filter(i => i.pickup !== undefined && i.inGame !== false)
        .map(i => (i.where ? { item: i.item, amount: i.amount, where: i.where } : { item: i.item, amount: i.amount })),
      threats: (site.threats ?? []).map(t => ({ name: t.name, count: t.count })),
      notes: site.notes ?? [],
    };
  }
  return out;
}

interface RawNodeEntry { name?: unknown; location?: unknown; resource?: unknown; purity?: unknown }
interface RawDefaultWorld {
  gameVersion?: string;
  resourceNodes?: RawNodeEntry[];
  geysers?: RawNodeEntry[];
  frackingCores?: (RawNodeEntry & { satellites?: RawNodeEntry[] })[];
}

/**
 * `resource-nodes.json` from the extractor's `default-world.json`: every resource node, geyser, fracking
 * core and satellite with resource, purity and position. Satellites take their core's resource; geysers get
 * the pseudo resource `Geyser`. Fails on unknown purities, resources without a name in item-names.json,
 * duplicate names and bad positions.
 */
export function buildResourceNodes(raw: unknown, itemNames: Record<string, string>, version: string): ResourceNodesFile {
  const w = raw as RawDefaultWorld;
  const problems: string[] = [];
  const nodes: ResourceNodeTuple[] = [];
  const seen = new Set<string>();
  const used = new Set<string>();
  const add = (e: RawNodeEntry, kind: NodeKind, resource: unknown, core?: string) => {
    const name = typeof e.name === 'string' ? e.name : '';
    if (!/^[A-Za-z0-9_]{1,128}$/.test(name)) { problems.push(`Resource node with a bad name: ${JSON.stringify(e.name)}`); return; }
    if (seen.has(name)) { problems.push(`Duplicate resource node name ${name}`); return; }
    seen.add(name);
    const loc = e.location;
    if (!Array.isArray(loc) || loc.length !== 3 || !loc.every(v => typeof v === 'number' && Number.isFinite(v))) {
      problems.push(`Resource node ${name} has no valid location`);
      return;
    }
    if (typeof resource !== 'string' || !/^[A-Za-z0-9_]{1,64}$/.test(resource)) { problems.push(`Resource node ${name} has no resource`); return; }
    let purity: Purity | null = null;
    if (kind !== 'core') {
      purity = purityFromGame(e.purity);
      if (purity === null) { problems.push(`Resource node ${name} has an unknown purity ${JSON.stringify(e.purity)}`); return; }
    }
    used.add(resource);
    const [x, y, z] = (loc as number[]).map(Math.round) as [number, number, number];
    const t: ResourceNodeTuple = [name, kind, resource, purity, x, y, z];
    if (core !== undefined) t.push(core);
    nodes.push(t);
  };
  for (const e of w.resourceNodes ?? []) add(e, 'node', e.resource);
  for (const e of w.geysers ?? []) add(e, 'geyser', GEYSER_RESOURCE);
  for (const c of w.frackingCores ?? []) {
    const before = nodes.length;
    add(c, 'core', c.resource);
    if (nodes.length === before) continue;
    const core = nodes[nodes.length - 1]![0];
    if (!c.satellites?.length) problems.push(`Fracking core ${core} has no satellites`);
    for (const s of c.satellites ?? []) add(s, 'satellite', c.resource, core);
  }
  for (const r of used) if (r !== GEYSER_RESOURCE && itemNames[r] === undefined) problems.push(`Resource ${r} has no entry in item-names.json`);
  if (nodes.length === 0) problems.push('default-world.json has no resource nodes');
  if (problems.length > 0) throw new BuildError(problems);
  const resources = [...used].sort().map(id => ({ id, name: id === GEYSER_RESOURCE ? 'Geyser' : itemNames[id]! }));
  return { version: w.gameVersion ?? version, resources, nodes };
}

/** GeoJSON in world coordinates: one feature per biome; all rings under even-odd fill. */
export function biomesToGeojson(biomes: BiomeShape[]) {
  return {
    type: 'FeatureCollection',
    features: biomes.map((b, idx) => ({
      type: 'Feature',
      properties: { idx, id: b.id, name: b.name },
      geometry: { type: 'Polygon', coordinates: b.rings.map(r => [...r, r[0]!]) },
    })),
  };
}

const readJson = (p: string): unknown => JSON.parse(readFileSync(p, 'utf8'));

export interface LoadOptions {
  biomes?: string;
  calibration?: string;
  itemNames?: string;
  crashSites?: string;
  snapMeters?: number;
  build?: number;
}

/** Reads collectibles.json, extras.json, map/map.json from `dir`; biomes, calibration and item names from options (default: inside `dir`). */
export function loadExtractorDir(dir: string, opts: LoadOptions = {}): BuildInput {
  const itemNamesPath = opts.itemNames ?? join(dir, 'item-names.json');

  const rawNames = existsSync(itemNamesPath) ? (readJson(itemNamesPath) as Record<string, unknown>) : {};
  const itemNames: Record<string, string> = {};
  for (const [k, v] of Object.entries(rawNames)) if (!k.startsWith('_') && typeof v === 'string') itemNames[k] = v;
  return {
    collectibles: readJson(join(dir, 'collectibles.json')),
    extras: readJson(join(dir, 'extras.json')),
    map: readJson(join(dir, 'map', 'map.json')),
    biomesGeojson: readJson(opts.biomes ?? join(dir, 'biomes.geojson')),
    calibration: readJson(opts.calibration ?? join(dir, 'calibration.json')) as Calibration,
    itemNames,
    snapUnits: (opts.snapMeters ?? 100) * UNITS_PER_METER,
    build: opts.build ?? DEFAULT_BUILD,
    ...(opts.crashSites && existsSync(opts.crashSites) ? { crashSites: readJson(opts.crashSites) } : {}),
  };
}

function main(): void {
  const { values: v } = parseArgs({
    options: {
      extractor: { type: 'string' },
      out: { type: 'string' },
      // Folder with the maintainer data: biomes/ and crash-sites/ (not in the public repo).
      'data-src': { type: 'string', default: 'data-src' },
      'snap-m': { type: 'string', default: '100' },
      biomes: { type: 'string' },
      calibration: { type: 'string' },
      'item-names': { type: 'string' },
      'crash-sites': { type: 'string' },
      // caves.json and the cave geometry dir from the extractor (`--caves-out`, `--cave-geometry-out`);
      // default: inside --extractor. Without both there is no cave layer.
      caves: { type: 'string' },
      'cave-geometry': { type: 'string' },
      // The extractor's height grid (`--heightmap-out`); default: inside --extractor. Without it there are no heights.
      heightmap: { type: 'string' },
      // The game's map areas (`--map-areas-out`); default: inside --extractor. When present they are the biomes,
      // instead of the editor polygons in --data-src.
      'map-areas': { type: 'string' },
      // Resource nodes, geysers and fracking wells (`--out` of the extractor); default: inside --extractor.
      // Without it the dataset has no resource node layer.
      'default-world': { type: 'string' },
      build: { type: 'string', default: String(DEFAULT_BUILD) },
    },
  });
  if (!v.extractor || !v.out) {
    throw new Error('usage: npm run dataset -- --extractor <dir> --out <dir> [--data-src <dir>] [--caves <caves.json>] [--cave-geometry <dir>] [--heightmap <dir>] [--map-areas <dir>] [--default-world <default-world.json>] [--snap-m 100] [--build N]');
  }
  const src = resolve(v['data-src']!);
  const firstExisting = (...paths: string[]) => paths.find(p => existsSync(p)) ?? paths[0]!;
  const input = loadExtractorDir(resolve(v.extractor), {
    biomes: resolve(v.biomes ?? join(src, 'biomes', 'biomes.editor.geojson')),
    calibration: resolve(v.calibration ?? join(src, 'biomes', 'calibration.json')),
    // item-names.json ships with the repo; a data folder may carry its own copy.
    itemNames: resolve(v['item-names'] ?? firstExisting(join(src, 'extractor', 'item-names.json'), 'data-src/extractor/item-names.json')),
    crashSites: resolve(v['crash-sites'] ?? join(src, 'crash-sites', 'crash-sites.json')),
    snapMeters: Number(v['snap-m']), build: Number(v.build),
  });
  const mapAreas = readMapAreas(resolve(v['map-areas'] ?? join(resolve(v.extractor), 'map-areas')));
  const heightGrid = readHeightGrid(resolve(v.heightmap ?? join(resolve(v.extractor), 'heightmap')));
  let biomeSummary = 'editor polygons (--data-src)';
  if (mapAreas) {
    // Land the game names no area joins the nearest biome; land is told from the height grid.
    const isLand = heightGrid ? (x: number, y: number) => {
      const { meta, top } = heightGrid;
      const i = Math.floor((x - meta.minX) / meta.cell), j = Math.floor((y - meta.minY) / meta.cell);
      return i >= 0 && j >= 0 && i < meta.width && j < meta.height && top[j * meta.width + i]! > SEA_LEVEL;
    } : undefined;
    const world = (input.map as { world: WorldBounds }).world;
    const areas = biomesFromAreas(mapAreas, world, AREA_SNAP, isLand);
    input.biomeAreas = areas;
    const pxArea = ((world.maxX - world.minX) / mapAreas.width / 100) ** 2;
    biomeSummary = `game map areas, ${areas.biomes.length} biomes, ${areas.biomes.reduce((n, b) => n + b.rings.reduce((m, r) => m + r.length, 0), 0)} outline points, `
      + (isLand ? `${(areas.filled * pxArea / 1e6).toFixed(2)} km² of land without an area joined to the nearest biome` : 'no height grid, land without an area stays without a biome');
  }
  const cavesPath = resolve(v.caves ?? join(resolve(v.extractor), 'caves.json'));
  const geometryDir = resolve(v['cave-geometry'] ?? join(resolve(v.extractor), 'cave-geometry'));
  let caveLayer: ReturnType<typeof sampleCaves> | undefined;
  if (existsSync(cavesPath) && existsSync(join(geometryDir, 'index.json'))) {
    console.log('Sampling caves ...');
    const coll = input.collectibles as { pickups: RawEntry[]; dropPods: RawEntry[] };
    const points = [...coll.pickups, ...coll.dropPods].map(e => ({ name: e.name, x: e.location[0], y: e.location[1], z: e.location[2] }));
    caveLayer = sampleCaves(geometryDir, readJson(cavesPath) as RawCaves, points, line => console.log(line));
    input.itemsInCaves = caveLayer.itemsInCaves;
  }
  let ds: Dataset;
  try { ds = buildDataset(input); } catch (e) {
    if (e instanceof BuildError) { console.error(e.message); process.exit(1); }
    throw e;
  }
  const out = resolve(v.out);
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'collectibles.min.json'), JSON.stringify(ds));
  if (input.crashSites !== undefined) writeFileSync(join(out, 'crash-sites.json'), JSON.stringify(buildCrashSites(input.crashSites, ds)));
  const shapes = input.biomeAreas?.biomes ?? loadEditorBiomes(input.biomesGeojson, input.calibration);
  writeFileSync(join(out, 'biomes.geojson'), JSON.stringify(biomesToGeojson(shapes)));
  let caveSummary = 'no caves.json / cave geometry, no cave layer';
  if (caveLayer) {
    writeFileSync(join(out, 'caves.geojson'), JSON.stringify(cavesToGeojson(caveLayer.caves)));
    const entrances = caveLayer.caves.reduce((sum, c) => sum + c.entrances.length, 0);
    caveSummary = `${caveLayer.caves.length} caves, ${entrances} entrances, ${ds.items.filter(i => i[7]?.cave).length} items in caves`;
  }
  let heightSummary = 'no height grid';
  if (heightGrid) {
    const { meta, bytes } = writeHeightTiles(heightGrid, join(out, 'height'));
    heightSummary = `${meta.width}x${meta.height} cells of ${meta.cell / 100} m, ${(bytes / 1e6).toFixed(1)} MB in tiles of ${meta.tile} cells`;
  }
  const defaultWorldPath = resolve(v['default-world'] ?? join(resolve(v.extractor), 'default-world.json'));
  let nodeSummary = 'no default-world.json, no resource node layer';
  if (existsSync(defaultWorldPath)) {
    let nodes: ResourceNodesFile;
    try { nodes = buildResourceNodes(readJson(defaultWorldPath), input.itemNames, ds.version); } catch (e) {
      if (e instanceof BuildError) { console.error(e.message); process.exit(1); }
      throw e;
    }
    writeFileSync(join(out, 'resource-nodes.json'), JSON.stringify(nodes));
    const perKind = new Map<string, number>();
    for (const n of nodes.nodes) perKind.set(n[1], (perKind.get(n[1]) ?? 0) + 1);
    nodeSummary = `${[...perKind].map(([k, c]) => `${c} ${k}`).join(', ')}; ${nodes.resources.length} resources`;
  }
  const mapDir = join(resolve(v.extractor), 'map');
  cpSync(join(mapDir, 'map.json'), join(out, 'map.json'));
  cpSync(join(mapDir, 'tiles'), join(out, 'tiles'), { recursive: true });
  if (existsSync(join(mapDir, 'icons'))) cpSync(join(mapDir, 'icons'), join(out, 'icons'), { recursive: true });

  const perType = new Map<string, number>();
  const perBiome = new Map<number, number>();
  for (const it of ds.items) {
    perType.set(it[1], (perType.get(it[1]) ?? 0) + 1);
    perBiome.set(it[5], (perBiome.get(it[5]) ?? 0) + 1);
  }
  console.log(`Dataset ${ds.version} (build ${ds.build}): ${ds.items.length} items, ${Object.keys(ds.aliases).length} aliases`);
  for (const t of COLLECTIBLE_TYPES) console.log(`  ${t.id}: ${perType.get(t.id) ?? 0}`);
  ds.biomes.forEach((b, i) => console.log(`  biome ${b.name.en}: ${perBiome.get(i) ?? 0}`));
  console.log(`  biomes: ${biomeSummary}`);
  console.log(`  caves: ${caveSummary}`);
  console.log(`  heights: ${heightSummary}`);
  console.log(`  resource nodes: ${nodeSummary}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
