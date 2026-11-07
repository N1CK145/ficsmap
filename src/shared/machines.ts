/**
 * The machine and vehicle wiki: one entry per production building, extractor, generator, other powered
 * machine and vehicle, as stored in a dataset's optional `machines.json` (built by `scripts/machines.ts`
 * from the game's `CommunityResources/Docs/*.json`). Every value comes from the game data; what the
 * Docs do not have is left out (or, for a vehicle's or station's fluid tank, marked as not in the data).
 *
 * Units: MW, seconds, items per minute; fluids (liquids and gases) in m³ (the game stores litres).
 * `Names`, `ItemAmount` and `WikiRecipe` have the same shape as `Names`, `ItemAmount` and `GameRecipe`
 * of the production planner's `src/shared/recipes.ts`, so the two can be merged into one.
 */

export interface Names { en: string; de: string }
export type Lang = keyof Names;
export type ItemForm = 'solid' | 'liquid' | 'gas';

/** An amount of an item (fluids in m³): per cycle in recipes, per minute in fuel use, per build in build costs. */
export interface ItemAmount { item: string; amount: number }

export interface WikiItem { name: Names; form: ItemForm }

/** A recipe that runs in a production building (same shape as the planner's `GameRecipe`). */
export interface WikiRecipe {
  id: string;
  name: Names;
  alternate: boolean;
  /** The building it runs in (a `MachineEntry` id). */
  machine: string;
  /** Seconds per cycle at 100 % clock speed. */
  duration: number;
  ingredients: ItemAmount[];
  /** First entry is the main product, the rest are by-products. */
  products: ItemAmount[];
  /** Only for buildings with variable power: MW over a cycle, from `min` to `max`. */
  power?: { min: number; max: number };
}

export const MACHINE_CATEGORIES = ['production', 'extraction', 'power', 'logistics', 'special', 'vehicles'] as const;
export type MachineCategory = (typeof MACHINE_CATEGORIES)[number];

/** How a build recipe is unlocked: the schematic's `mType` (`EST_Milestone`, `EST_MAM`, ...). */
export type UnlockKind = 'milestone' | 'tutorial' | 'mam' | 'alternate' | 'hardDrive' | 'shop' | 'other';
export interface Unlock { kind: UnlockKind; name: Names; tier: number }

/** Where an entry is made: placed with the Build Gun, or crafted in the Equipment Workshop (Factory Cart). */
export type BuildPlace = 'buildGun' | 'workshop';
export interface BuildCost { place: BuildPlace; ingredients: ItemAmount[] }

/** One fuel of a generator at 100 % clock speed, per minute. */
export interface FuelUse {
  item: string;
  /**
   * Fuel per minute (fluids in m³) from the fuel's energy value; Alien Power Augmenter: 60 / the fuel's
   * `mBoostDuration`. Absent when the game data has neither.
   */
  perMinute?: number;
  /** Alien Power Augmenter: extra grid boost of the fuel, as a share (0.2 = 20 %) [the fuel's mBoostPercentage]. */
  boost?: number;
  /** E.g. water for the coal generator and the nuclear power plant. */
  supplement?: ItemAmount;
  /** E.g. nuclear waste. */
  byproduct?: ItemAmount;
}

/** Each field is optional: an entry has only what its Docs class gives. Docs field names in brackets. */
export interface MachineStats {
  /** MW at 100 % [mPowerConsumption]. */
  powerUse?: number;
  /** Variable power in MW [mEstimatedMininum/MaximumPowerConsumption; locomotive mPowerConsumption (Min, Max)]. */
  powerUseRange?: { min: number; max: number };
  /** MW at 100 % [mPowerProduction; Alien Power Augmenter mBasePowerProduction]. */
  powerProduction?: number;
  /**
   * Fluctuating production (geothermal): MW on average on a normal geyser [mVariablePowerProductionFactor; the
   * game's description gives the same average] and the length of one cycle in s [mVariablePowerProductionCycleLength].
   */
  powerVariable?: { average: number; cycleSeconds: number };
  /** Extra power as a share of the grid's production (0.1 = 10 %) [mBaseBoostPercentage]. */
  gridBoost?: number;
  /**
   * Clock speed range without Power Shards, as fractions (0.01..1) [mMinPotential, mMaxPotential; only if
   * mCanChangePotential, and not for the Alien Power Augmenter, Drone Port and Resource Well Extractor, whose
   * clock speed the game does not let you change although their Docs say so].
   */
  clock?: { min: number; max: number };
  /** Power at clock speed c is `powerUse * c^powerExponent` [mPowerConsumptionExponent]. */
  powerExponent?: number;
  /**
   * [round(1 / mProductionShardBoostMultiplier), only if mCanChangeProductionBoost: 1.0 -> 1, 0.5 -> 2, 0.25 -> 4.
   * mProductionShardSlotSize is only set where mOverrideProductionShardSlotSize is True; the Smelter has 0 there.]
   */
  somersloopSlots?: number;
  /** Default rate at 100 % [mItemsPerCycle / mExtractCycleTime]; fluids in m³. */
  extractionPerMinute?: number;
  extractionFluid?: boolean;
  /** The rate is for a normal resource node: every extractor but the Water Extractor (FGBuildableWaterPump). */
  extractionNode?: boolean;
  /** Resources it is limited to [mAllowedResources, if mOnlyAllowCertainResources]. */
  resources?: string[];
  /** Resource forms it extracts when not limited [mAllowedResourceForms]. */
  resourceForms?: ItemForm[];
  fuels?: FuelUse[];
  /** Solid inventory slots [vehicles mInventorySize; truck stations mStorageInventorySize]. */
  inventorySlots?: number;
  /**
   * Storage size in slots [Drone Port and Freight Platform mStorageSizeX × mStorageSizeY]. The Drone Port has
   * two inventories (outgoing and incoming); the Docs give only this one size.
   */
  storageSlots?: number;
  /** Holds fluid instead of items [mIsFluidStorageInventory, FCT_Liquid]; the capacity is not in the Docs. */
  fluidStorage?: boolean;
  /** [mFuelInventorySize; drone port mFuelStorageSizeX × Y]. */
  fuelSlots?: number;
  /** Vehicle fuel burn in MW while driven [mManualFuelConsumption]. */
  fuelBurn?: number;
  /** MWh [mPowerStoreCapacity]. */
  storageCapacity?: number;
  /** MW [mPowerInputCapacity]. */
  maxCharge?: number;
  /** Seconds to load / unload a docked freight car [mTimeToCompleteLoad, mTimeToCompleteUnload]. */
  loadSeconds?: number;
  unloadSeconds?: number;
}

export interface MachineEntry {
  /** Building class (`Build_ConstructorMk1_C`) or, for vehicles, descriptor class (`Desc_Truck_C`). */
  id: string;
  category: MachineCategory;
  name: Names;
  /** The game's own description text [mDescription]. */
  description: Names;
  /** Title of the matching page on satisfactory.wiki.gg (derived from the English name). */
  wikiPage: string;
  stats: MachineStats;
  build?: BuildCost;
  unlockedBy: Unlock[];
}

export interface MachineData {
  format: 1;
  /** Where the data came from, for the record (file names, not paths). */
  source: string;
  /** Every item the entries refer to (build costs, recipes, fuels, resources). */
  items: Record<string, WikiItem>;
  /** Grouped by category in `MACHINE_CATEGORIES` order, in build-menu order within a category. */
  machines: MachineEntry[];
  recipes: WikiRecipe[];
}

export const WIKI_BASE = 'https://satisfactory.wiki.gg/wiki/';

/** The page title the wiki uses for an English display name: "Coal-Powered Generator" -> "Coal-Powered_Generator". */
export function wikiTitle(englishName: string): string {
  return englishName.replace(/™/g, '').trim().replace(/\s+/g, '_');
}

export function wikiUrl(page: string): string {
  return WIKI_BASE + encodeURIComponent(page).replace(/%2F/g, '/');
}

/** Units per minute of a per-cycle amount at 100 % clock speed. */
export function perMinute(amount: number, durationSeconds: number): number {
  return round(amount * 60 / durationSeconds);
}

/** Rounds away float noise (0.1 + 0.2); the game's numbers have few decimals. */
export function round(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase();

/** Whether an entry matches the typed text: every word in its English or German name. */
export function matchesQuery(entry: MachineEntry, query: string): boolean {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const hay = fold(`${entry.name.en} ${entry.name.de}`);
  return words.every(w => hay.includes(w));
}

/** The entries per category, in `MACHINE_CATEGORIES` order, empty categories left out. */
export function groupByCategory(entries: readonly MachineEntry[]): { category: MachineCategory; entries: MachineEntry[] }[] {
  return MACHINE_CATEGORIES
    .map(category => ({ category, entries: entries.filter(e => e.category === category) }))
    .filter(g => g.entries.length > 0);
}

/**
 * One line of an entry's stats table: `id` names the i18n keys (`machineWiki.stat.<id>` for the label,
 * `machineWiki.statValue.<id>` for the ICU value), `params` fills the value.
 */
export interface StatRow { id: string; params: Record<string, number | string> }

/**
 * The stats table of an entry, in a fixed order. Names in `params` (resources) are in `lang`. Values
 * the game data does not have produce no row, except the fluid tank, whose capacity is marked as
 * missing from the game data.
 */
export function statRows(entry: MachineEntry, items: Readonly<Record<string, WikiItem>>, lang: Lang): StatRow[] {
  const s = entry.stats;
  const rows: StatRow[] = [];
  const add = (id: string, params: Record<string, number | string>) => rows.push({ id, params });
  const itemName = (id: string) => items[id]?.name[lang] ?? id;

  if (s.powerUse !== undefined) add('powerUse', { mw: s.powerUse });
  if (s.powerUseRange) add('powerUseRange', { min: s.powerUseRange.min, max: s.powerUseRange.max });
  if (s.powerProduction !== undefined) add('powerProduction', { mw: s.powerProduction });
  if (s.powerVariable) add('powerVariable', { mw: s.powerVariable.average, seconds: s.powerVariable.cycleSeconds });
  if (s.gridBoost !== undefined) add('gridBoost', { share: s.gridBoost });
  if (s.storageCapacity !== undefined) add('storageCapacity', { mwh: s.storageCapacity });
  if (s.maxCharge !== undefined) add('maxCharge', { mw: s.maxCharge });
  if (s.fuelBurn !== undefined) add('fuelBurn', { mw: s.fuelBurn });
  if (s.extractionPerMinute !== undefined) {
    add(s.extractionFluid ? 'extractionFluid' : 'extraction', { rate: s.extractionPerMinute, node: s.extractionNode ? 'yes' : 'no' });
  }
  if (s.resources) add('resources', { names: s.resources.map(itemName).join(', ') });
  else for (const form of s.resourceForms ?? []) add('resourceForm', { form });
  if (s.inventorySlots !== undefined) add('inventorySlots', { slots: s.inventorySlots });
  if (s.storageSlots !== undefined) add('storageSlots', { slots: s.storageSlots });
  if (s.fluidStorage) add('fluidStorage', {});
  if (s.fuelSlots !== undefined) add('fuelSlots', { slots: s.fuelSlots });
  if (s.loadSeconds !== undefined) add('loadSeconds', { seconds: s.loadSeconds });
  if (s.unloadSeconds !== undefined) add('unloadSeconds', { seconds: s.unloadSeconds });
  if (s.clock) add('clock', { min: s.clock.min, max: s.clock.max });
  if (s.powerExponent !== undefined) add('powerExponent', { exponent: s.powerExponent });
  if (s.somersloopSlots !== undefined) add('somersloopSlots', { slots: s.somersloopSlots });
  return rows;
}
