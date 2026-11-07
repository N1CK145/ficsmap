import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { COLLECTIBLE_TYPES, classify, typeById } from '../src/shared/collectibleTypes.js';
import { assignBiome, loadEditorBiomes, type BiomeShape } from '../src/shared/biomes.js';
import { cavesToGeojson, type RawCaves } from '../src/shared/caves.js';
import { sampleCaves } from './cave-geometry.js';
import { readHeightGrid, writeHeightTiles } from './heightmap.js';
import { AREA_SNAP, biomesFromAreas, landTest, readMapAreas } from './map-areas.js';
import { UNITS_PER_METER, type Calibration } from '../src/shared/geo.js';
import type { CollectibleTypeId, LocalizedName, WorldBounds } from '../src/shared/types.js';
import type { CrashSites, Dataset, DatasetItemTuple, ItemExtra, PodRequirement } from '../src/shared/dataset.js';

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
  /** descriptor class (Desc_X_C) -> the game's display name in English and German (item-names.json) */
  itemNames: Record<string, LocalizedName>;
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
  items?: { item: string; itemClass?: string; amount: number; pickup?: string; where?: string; inGame?: boolean }[];
  threats?: { name: string; count: number | null }[];
  notes?: string[];
}
const crashSitePods = (raw: unknown): Record<string, RawCrashSite> => (raw as { pods?: Record<string, RawCrashSite> } | undefined)?.pods ?? {};
interface RawMap { id: string; gameVersion?: string; world: WorldBounds }

const DEFAULT_BUILD = 517554;

/**
 * A pod's unlock cost (mUnlockCost). CostType says which field counts: Item (item and amount) or Power. With None, or
 * without mUnlockCost (null: the class default), the pod needs nothing; leftover item or power values in the fields the
 * game ignores do not count. Undefined (unknown) only for a cost type without its value or an unknown cost type.
 */
function podRequirement(raw: RawPod, itemNames: Record<string, LocalizedName>, problems: string[]): PodRequirement | undefined {
  if (raw.costType === 'None' || raw.costType === null) return { item: null, amount: 0, power: 0 };
  if (raw.costType === 'Power') return raw.power > 0 ? { item: null, amount: 0, power: raw.power } : undefined;
  if (raw.costType !== 'Item' || !raw.item || raw.amount <= 0) return undefined;
  const name = itemNames[raw.item];
  if (name === undefined) problems.push(`Pod item ${raw.item} has no entry in item-names.json`);
  return { item: name ?? { en: raw.item, de: raw.item }, amount: raw.amount, power: 0 };
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
        const pod = raw && podRequirement(raw, input.itemNames, problems);
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
    // True only when every drop pod has its requirement from the game data (extras.json).
    podRequirementsKnown: work.every(w => typeById(w.type).details !== 'dropPod' || w.extra?.pod !== undefined),
    biomes: biomes.map(b => ({ id: b.id, name: { en: b.name, de: b.nameDe ?? b.name } })),
    items,
    aliases,
  };
}

/**
 * Per pod of the dataset: the items lying around its crash site (only pickups that exist in the game),
 * threats and notes, from data-src/crash-sites/crash-sites.json. Served as `crash-sites.json`. Items whose class is in
 * `itemNames` get the game's English name (the key that matches pod requirements) and its German name.
 */
export function buildCrashSites(raw: unknown, ds: Dataset, itemNames: Record<string, LocalizedName> = {}): CrashSites {
  const pods = new Set(ds.items.filter(i => i[1] === 'hard_drive').map(i => i[0]));
  const out: CrashSites = {};
  for (const [name, site] of Object.entries(crashSitePods(raw))) {
    if (!pods.has(name)) continue;
    out[name] = {
      items: (site.items ?? []).filter(i => i.pickup !== undefined && i.inGame !== false).map(i => {
        const known = i.itemClass === undefined ? undefined : itemNames[i.itemClass];
        return { item: known?.en ?? i.item, ...(known && { de: known.de }), amount: i.amount, ...(i.where ? { where: i.where } : {}) };
      }),
      threats: (site.threats ?? []).map(t => ({ name: t.name, count: t.count })),
      notes: site.notes ?? [],
    };
  }
  return out;
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
  // Entries are { en, de }; a plain string (older copies of the file) serves both locales.
  const itemNames: Record<string, LocalizedName> = {};
  for (const [k, v] of Object.entries(rawNames)) {
    if (k.startsWith('_')) continue;
    if (typeof v === 'string') itemNames[k] = { en: v, de: v };
    else if (v && typeof v === 'object') itemNames[k] = v as LocalizedName;
  }
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
      // The game's map areas (`--map-areas-out`); default: inside --extractor. They tell land from sea for the
      // biomes, and are the biomes themselves when there is no biome raster.
      'map-areas': { type: 'string' },
      // The biomes as a raster in the map-areas format (scripts/wiki-biomes.ts, from the wiki's biome map);
      // default: <data-src>/biomes/wiki-raster. First choice for the biomes.
      'biome-raster': { type: 'string' },
      build: { type: 'string', default: String(DEFAULT_BUILD) },
    },
  });
  if (!v.extractor || !v.out) {
    throw new Error('usage: npm run dataset -- --extractor <dir> --out <dir> [--data-src <dir>] [--caves <caves.json>] [--cave-geometry <dir>] [--heightmap <dir>] [--map-areas <dir>] [--biome-raster <dir>] [--snap-m 100] [--build N]');
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
  const gameAreas = readMapAreas(resolve(v['map-areas'] ?? join(resolve(v.extractor), 'map-areas')));
  const biomeRaster = readMapAreas(resolve(v['biome-raster'] ?? join(src, 'biomes', 'wiki-raster')));
  const mapAreas = biomeRaster ?? gameAreas;
  const heightGrid = readHeightGrid(resolve(v.heightmap ?? join(resolve(v.extractor), 'heightmap')));
  let biomeSummary = 'editor polygons (--data-src)';
  const biomeSource = biomeRaster ? 'biome raster (wiki biome map)' : 'game map areas';
  if (mapAreas) {
    // Land without a biome joins the nearest biome (landTest: everything but the open sea). The biome raster from
    // the wiki map comes already filled (scripts/wiki-biomes.ts, with a land mask from the map image).
    const isLand = biomeRaster ? undefined : landTest(heightGrid);
    const world = (input.map as { world: WorldBounds }).world;
    const areas = biomesFromAreas(mapAreas, world, AREA_SNAP, isLand);
    input.biomeAreas = areas;
    const pxArea = ((world.maxX - world.minX) / mapAreas.width / 100) ** 2;
    biomeSummary = `${biomeSource}, ${areas.biomes.length} biomes, ${areas.biomes.reduce((n, b) => n + b.rings.reduce((m, r) => m + r.length, 0), 0)} outline points, `
      + (isLand ? `${(areas.filled * pxArea / 1e6).toFixed(2)} km² of land without a biome joined to the nearest one` : 'no land fill');
  }
  const cavesPath = resolve(v.caves ?? join(resolve(v.extractor), 'caves.json'));
  const geometryDir = resolve(v['cave-geometry'] ?? join(resolve(v.extractor), 'cave-geometry'));
  let caveLayer: ReturnType<typeof sampleCaves> | undefined;
  if (existsSync(cavesPath) && existsSync(join(geometryDir, 'index.json'))) {
    console.log('Sampling caves ...');
    const coll = input.collectibles as { pickups: RawEntry[]; dropPods: RawEntry[] };
    const points = [...coll.pickups, ...coll.dropPods].map(e => ({ name: e.name, x: e.location[0], y: e.location[1], z: e.location[2] }));
    // The landscape alone (`landscape.f32` next to the height grid): items far under it lie in a cave.
    const landscape = readHeightGrid(resolve(v.heightmap ?? join(resolve(v.extractor), 'heightmap')), 'landscape.f32');
    caveLayer = sampleCaves(geometryDir, readJson(cavesPath) as RawCaves, points, line => console.log(line), landscape);
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
  if (input.crashSites !== undefined) writeFileSync(join(out, 'crash-sites.json'), JSON.stringify(buildCrashSites(input.crashSites, ds, input.itemNames)));
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
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
