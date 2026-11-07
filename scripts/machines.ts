import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { readDocsFile, type DocsClass } from './game-docs.js';
import {
  MACHINE_CATEGORIES, round, wikiTitle,
  type BuildCost, type BuildPlace, type FuelUse, type ItemAmount, type ItemForm, type MachineCategory, type MachineData,
  type MachineEntry, type MachineStats, type Names, type Unlock, type UnlockKind, type WikiItem, type WikiRecipe,
} from '../src/shared/machines.js';

/**
 * Builds `machines.json` (see src/shared/machines.ts) for the in-app machine and vehicle wiki from the
 * game's own class dump, `<install>/CommunityResources/Docs/en-US.json` and `de.json`: names and
 * descriptions, power, clock speed, extraction rates, fuels, inventories, build costs, unlocks and the
 * recipes that run in each production building. Only fields of the game data are used; nothing is
 * filled in by hand. See data-src/extractor/README.md, "Machine and vehicle wiki".
 */

export class MachineBuildError extends Error {
  constructor(public problems: string[]) {
    super(`Machine data build failed:\n- ${problems.join('\n- ')}`);
    this.name = 'MachineBuildError';
  }
}

/** Which native classes are wiki entries, and in which category. */
const CATEGORY_OF: Record<string, MachineCategory> = {
  FGBuildableManufacturer: 'production',
  FGBuildableManufacturerVariablePower: 'production',
  FGBuildableResourceExtractor: 'extraction',
  FGBuildableWaterPump: 'extraction',
  FGBuildableFrackingExtractor: 'extraction',
  FGBuildableFrackingActivator: 'extraction',
  FGBuildableGeneratorFuel: 'power',
  FGBuildableGeneratorNuclear: 'power',
  FGBuildableGeneratorGeoThermal: 'power',
  FGBuildablePowerStorage: 'power',
  FGBuildablePowerBooster: 'power',
  FGBuildableDockingStation: 'logistics',
  FGBuildableDroneStation: 'logistics',
  FGBuildableRailroadStation: 'logistics',
  FGBuildableTrainPlatformCargo: 'logistics',
  FGBuildablePipelinePump: 'logistics',
  FGPipeHyperStart: 'logistics',
  FGBuildableResourceSink: 'special',
  FGBuildableRadarTower: 'special',
  FGBuildableElevator: 'special',
  FGBuildablePortal: 'special',
  FGBuildablePortalSatellite: 'special',
  FGVehicleDescriptor: 'vehicles',
};
/** In these categories only machines that draw power count (the valve shares the pipeline pump's class). */
const POWERED_ONLY = new Set<MachineCategory>(['logistics', 'special']);
/** The Factory Carts are equipment (crafted in the workshop), not vehicle descriptors. */
const EXTRA_VEHICLES = ['Desc_GolfCart_C', 'Desc_GolfCartGold_C'];
const PRODUCTION = new Set(['FGBuildableManufacturer', 'FGBuildableManufacturerVariablePower']);
/**
 * The Docs say mCanChangePotential=True for these, but the game does not let you change their clock speed
 * (satisfactory.wiki.gg: Alien_Power_Augmenter, Drone_Port; a Resource Well Extractor runs at the clock speed
 * set at its Resource_Well_Pressurizer). So no clock speed and no power exponent for them.
 */
const NO_CLOCK = new Set(['FGBuildablePowerBooster', 'FGBuildableDroneStation', 'FGBuildableFrackingExtractor']);
/** Extractors without resource nodes, whose rate is not "on a normal node". */
const NO_NODE = new Set(['FGBuildableWaterPump']);

const BUILD_PLACES: Record<string, BuildPlace> = { BP_BuildGun_C: 'buildGun', BP_WorkshopComponent_C: 'workshop' };
const FORMS: Record<string, ItemForm> = { RF_SOLID: 'solid', RF_LIQUID: 'liquid', RF_GAS: 'gas' };
const UNLOCK_KINDS: Record<string, UnlockKind> = {
  EST_Milestone: 'milestone', EST_Tutorial: 'tutorial', EST_MAM: 'mam', EST_Alternate: 'alternate',
  EST_HardDrive: 'hardDrive', EST_ResourceSink: 'shop',
};
const UNLOCK_ORDER: UnlockKind[] = ['tutorial', 'milestone', 'mam', 'alternate', 'hardDrive', 'shop', 'other'];
/** The game stores fluid amounts in litres; machines.json has m³. */
const LITRES_PER_M3 = 1000;

/** "/Script/CoreUObject.Class'/Script/FactoryGame.FGRecipe'" -> "FGRecipe". */
export const nativeName = (c: DocsClass): string => /\.(\w+)'?$/.exec(c.NativeClass)?.[1] ?? c.NativeClass;
/** Docs values are strings, except a few lists of objects (`mFuel`, `mUnlocks`). */
const raw = (c: DocsClass, key: string): unknown => (c as Record<string, unknown>)[key];
const str = (c: DocsClass, key: string): string => {
  const v = raw(c, key);
  return typeof v === 'string' ? v : '';
};
/** A numeric field, or undefined when it is missing or not a number. */
const num = (c: DocsClass, key: string): number | undefined => {
  const s = str(c, key).trim();
  const n = Number(s);
  return s !== '' && Number.isFinite(n) ? n : undefined;
};
const positive = (n: number | undefined): number | undefined => (n !== undefined && n > 0 ? n : undefined);
const bool = (c: DocsClass, key: string): boolean => str(c, key) === 'True';
/** Class names (`Desc_X_C`, `Build_X_C`) in a UE text value, in order. */
const classNames = (value: string): string[] => [...value.matchAll(/\.(\w+_C)\b/g)].map(m => m[1]!);
/** `((ItemClass="…Desc_X.Desc_X_C'",Amount=3),…)` -> [{item, amount}]. */
const amounts = (value: string): ItemAmount[] =>
  [...value.matchAll(/ItemClass="[^"]*?\.(\w+_C)'?",Amount=([\d.]+)/g)].map(m => ({ item: m[1]!, amount: Number(m[2]) }));
/** Game text with Windows line ends and stray blanks at line ends cleaned up. */
const text = (s: string): string => s.replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').trim();
/**
 * A display name on one line. A word broken with a hyphen and a line break before a lower-case letter is
 * joined (de.json: "Plutonium- \r\nbrennstab" -> "Plutoniumbrennstab"); a hyphen before any other line break
 * stays without the break, other line breaks become a space. "Luft- und Raumfahrttechnik" has no line break and stays.
 */
export const displayName = (s: string): string => s
  .replace(/-[^\S\r\n]*[\r\n]\s*(?=\p{Ll})/gu, '')
  .replace(/-[^\S\r\n]*[\r\n]\s*/g, '-')
  .replace(/\s*[\r\n]\s*/g, ' ')
  .trim();

export function buildMachineData(en: readonly DocsClass[], de: readonly DocsClass[], source = 'CommunityResources/Docs: en-US.json, de.json'): MachineData {
  const problems: string[] = [];
  const byName = new Map(en.map(c => [c.ClassName, c]));
  const deByName = new Map(de.map(c => [c.ClassName, c]));
  const translated = (c: DocsClass, key: string, clean: (s: string) => string = text): Names => {
    const enText = clean(str(c, key));
    const other = deByName.get(c.ClassName);
    if (!other) problems.push(`${c.ClassName} is missing in de.json`);
    return { en: enText, de: (other && clean(str(other, key))) || enText };
  };
  const named = (c: DocsClass): Names => translated(c, 'mDisplayName', displayName);

  // Items: everything an entry refers to, with its form; fluid amounts are scaled to m³.
  const items: Record<string, WikiItem> = {};
  const formOf = (id: string): ItemForm | undefined => {
    const c = byName.get(id);
    return c ? FORMS[str(c, 'mForm')] : undefined;
  };
  const useItem = (id: string, context: string): ItemForm | undefined => {
    const form = formOf(id);
    if (!form) { problems.push(`${context} refers to ${id}, which is no item with a known form`); return undefined; }
    items[id] ??= { name: named(byName.get(id)!), form };
    return form;
  };
  const scaled = (a: ItemAmount, context: string): ItemAmount => {
    const form = useItem(a.item, context);
    return { item: a.item, amount: form === 'solid' || form === undefined ? a.amount : round(a.amount / LITRES_PER_M3) };
  };

  // Which classes are entries
  const entries: { c: DocsClass; category: MachineCategory }[] = [];
  for (const c of en) {
    const category = CATEGORY_OF[nativeName(c)];
    if (!category) continue;
    if (POWERED_ONLY.has(category) && !(num(c, 'mPowerConsumption')! > 0)) continue;
    entries.push({ c, category });
  }
  for (const id of EXTRA_VEHICLES) {
    const c = byName.get(id);
    if (c) entries.push({ c, category: 'vehicles' });
  }
  const descriptorOf = (c: DocsClass) => (c.ClassName.startsWith('Build_') ? c.ClassName.replace(/^Build_/, 'Desc_') : c.ClassName);

  // Build recipes (Build Gun, Equipment Workshop) by their product, and the schematics that unlock them
  const buildRecipes = new Map<string, { recipe: DocsClass; place: BuildPlace }>();
  const recipeClasses = en.filter(c => nativeName(c) === 'FGRecipe');
  for (const r of recipeClasses) {
    const place = classNames(str(r, 'mProducedIn')).map(p => BUILD_PLACES[p]).find(p => p !== undefined);
    const products = amounts(str(r, 'mProduct'));
    if (place && products.length === 1) buildRecipes.set(products[0]!.item, { recipe: r, place });
  }
  const unlocks = new Map<string, Unlock[]>();
  for (const s of en) {
    if (nativeName(s) !== 'FGSchematic') continue;
    const list = raw(s, 'mUnlocks');
    if (!Array.isArray(list)) continue;
    const unlock: Unlock = { kind: UNLOCK_KINDS[str(s, 'mType')] ?? 'other', name: named(s), tier: num(s, 'mTechTier') ?? 0 };
    for (const u of list as Record<string, unknown>[]) {
      if (typeof u.mRecipes !== 'string') continue;
      for (const recipeId of classNames(u.mRecipes)) unlocks.set(recipeId, [...(unlocks.get(recipeId) ?? []), unlock]);
    }
  }

  // Recipes that run in a production building (same rules as the production planner's recipes.json)
  const production = new Map(entries.filter(e => PRODUCTION.has(nativeName(e.c))).map(e => [e.c.ClassName, e.c]));
  const recipes: WikiRecipe[] = [];
  for (const r of recipeClasses) {
    const machinesOf = classNames(str(r, 'mProducedIn')).filter(m => production.has(m));
    if (machinesOf.length === 0) continue;
    if (machinesOf.length > 1) { problems.push(`${r.ClassName} is made in more than one building: ${machinesOf.join(', ')}`); continue; }
    const machine = machinesOf[0]!;
    const duration = num(r, 'mManufactoringDuration') ?? 0;
    if (!(duration > 0)) problems.push(`${r.ClassName}: duration ${str(r, 'mManufactoringDuration')}`);
    const name = named(r);
    const recipe: WikiRecipe = {
      id: r.ClassName, name, alternate: name.en.startsWith('Alternate:'), machine, duration,
      ingredients: amounts(str(r, 'mIngredients')).map(a => scaled(a, r.ClassName)),
      products: amounts(str(r, 'mProduct')).map(a => scaled(a, r.ClassName)),
    };
    if (recipe.products.length === 0) problems.push(`${r.ClassName} has no products`);
    if (nativeName(production.get(machine)!) === 'FGBuildableManufacturerVariablePower') {
      const constant = num(r, 'mVariablePowerConsumptionConstant') ?? 0;
      const factor = num(r, 'mVariablePowerConsumptionFactor') ?? 0;
      recipe.power = { min: constant, max: constant + factor };
    }
    recipes.push(recipe);
  }

  const fuelsOf = (c: DocsClass, power: number | undefined): FuelUse[] | undefined => {
    const list = raw(c, 'mFuel');
    const fuels: FuelUse[] = [];
    if (Array.isArray(list)) {
      for (const f of list as Record<string, unknown>[]) {
        const id = typeof f.mFuelClass === 'string' ? f.mFuelClass : '';
        const form = useItem(id, `${c.ClassName} fuel`);
        if (!form) continue;
        const fuel: FuelUse = { item: id };
        const energy = positive(num(byName.get(id)!, 'mEnergyValue'));
        if (energy !== undefined && power !== undefined) {
          // mEnergyValue: MJ per item, or per litre for fluids
          const rate = round(form === 'solid' ? power * 60 / energy : power * 60 / (energy * LITRES_PER_M3));
          fuel.perMinute = rate;
          const supplement = typeof f.mSupplementalResourceClass === 'string' ? f.mSupplementalResourceClass : '';
          const ratio = positive(num(c, 'mSupplementalToPowerRatio'));
          if (supplement && ratio !== undefined && bool(c, 'mRequiresSupplementalResource')) {
            // mSupplementalToPowerRatio: litres per MJ
            const sForm = useItem(supplement, `${c.ClassName} supplement`);
            fuel.supplement = { item: supplement, amount: round(power * ratio * 60 / (sForm === 'solid' ? 1 : LITRES_PER_M3)) };
          }
          const byproduct = typeof f.mByproduct === 'string' ? f.mByproduct : '';
          const perFuel = Number(f.mByproductAmount);
          if (byproduct && perFuel > 0 && useItem(byproduct, `${c.ClassName} byproduct`)) {
            fuel.byproduct = { item: byproduct, amount: round(rate * perFuel) };
          }
        }
        fuels.push(fuel);
      }
    }
    if (fuels.length === 0) {
      // Generators without an mFuel list (Alien Power Augmenter): one fuel item lasts mBoostDuration seconds
      // and adds mBoostPercentage to the grid boost
      for (const id of classNames(str(c, 'mDefaultFuelClasses'))) {
        if (!useItem(id, `${c.ClassName} fuel`)) continue;
        const fuel: FuelUse = { item: id };
        const item = byName.get(id)!;
        const duration = positive(num(item, 'mBoostDuration'));
        if (duration !== undefined) fuel.perMinute = round(60 / duration);
        const boost = positive(num(item, 'mBoostPercentage'));
        if (boost !== undefined) fuel.boost = boost;
        fuels.push(fuel);
      }
    }
    return fuels.length > 0 ? fuels : undefined;
  };

  const statsOf = (c: DocsClass, category: MachineCategory): MachineStats => {
    const s: MachineStats = {};
    const native = nativeName(c);
    const range = /Min=([\d.]+),Max=([\d.]+)/.exec(str(c, 'mPowerConsumption'));
    if (range) s.powerUseRange = { min: Number(range[1]), max: Number(range[2]) };
    else s.powerUse = positive(num(c, 'mPowerConsumption'));
    const estMin = num(c, 'mEstimatedMininumPowerConsumption'), estMax = positive(num(c, 'mEstimatedMaximumPowerConsumption'));
    if (estMin !== undefined && estMax !== undefined) s.powerUseRange = { min: estMin, max: estMax };

    const production = positive(num(c, 'mPowerProduction')) ?? positive(num(c, 'mBasePowerProduction'));
    s.powerProduction = production;
    const average = positive(num(c, 'mVariablePowerProductionFactor')), cycleSeconds = positive(num(c, 'mVariablePowerProductionCycleLength'));
    if (production === undefined && average !== undefined && cycleSeconds !== undefined) s.powerVariable = { average, cycleSeconds };
    s.gridBoost = positive(num(c, 'mBaseBoostPercentage'));
    if (category === 'power') s.fuels = fuelsOf(c, production);
    s.storageCapacity = positive(num(c, 'mPowerStoreCapacity'));
    s.maxCharge = positive(num(c, 'mPowerInputCapacity'));

    const min = num(c, 'mMinPotential'), max = num(c, 'mMaxPotential');
    if (bool(c, 'mCanChangePotential') && !NO_CLOCK.has(native) && min !== undefined && max !== undefined) {
      s.clock = { min, max };
      if (s.powerUse !== undefined || s.powerUseRange) s.powerExponent = num(c, 'mPowerConsumptionExponent');
    }
    // mProductionShardSlotSize is only set with mOverrideProductionShardSlotSize (the Smelter has 0 there);
    // the multiplier per Somersloop gives the slots for every building: 1.0 -> 1, 0.5 -> 2, 0.25 -> 4
    const boostPerSlot = positive(num(c, 'mProductionShardBoostMultiplier'));
    if (bool(c, 'mCanChangeProductionBoost') && boostPerSlot !== undefined) s.somersloopSlots = Math.round(1 / boostPerSlot);

    const cycle = positive(num(c, 'mExtractCycleTime')), perCycle = positive(num(c, 'mItemsPerCycle'));
    if (cycle !== undefined && perCycle !== undefined) {
      const forms = [...str(c, 'mAllowedResourceForms').matchAll(/RF_\w+/g)].map(m => FORMS[m[0]]).filter((f): f is ItemForm => f !== undefined);
      const fluid = forms.length > 0 && !forms.includes('solid');
      s.extractionPerMinute = round(perCycle / cycle * 60 / (fluid ? LITRES_PER_M3 : 1));
      s.extractionFluid = fluid;
      s.extractionNode = !NO_NODE.has(native);
      if (bool(c, 'mOnlyAllowCertainResources')) s.resources = classNames(str(c, 'mAllowedResources')).filter(id => useItem(id, c.ClassName));
      else if (forms.length > 0) s.resourceForms = forms;
      else problems.push(`${c.ClassName}: no resource forms`);
    }

    // Inventories: vehicles and truck stations; storage size: drone ports and freight platforms
    if (bool(c, 'mIsFluidStorageInventory') || str(c, 'mFreightCargoType') === 'FCT_Liquid') s.fluidStorage = true;
    else {
      const x = num(c, 'mStorageSizeX'), y = num(c, 'mStorageSizeY');
      s.inventorySlots = positive(native === 'FGVehicleDescriptor' ? num(c, 'mInventorySize') : num(c, 'mStorageInventorySize'));
      if (s.inventorySlots === undefined && x !== undefined && y !== undefined) s.storageSlots = positive(x * y);
    }
    const fx = num(c, 'mFuelStorageSizeX'), fy = num(c, 'mFuelStorageSizeY');
    s.fuelSlots = positive(num(c, 'mFuelInventorySize') ?? (fx !== undefined && fy !== undefined ? fx * fy : undefined));
    s.fuelBurn = positive(num(c, 'mManualFuelConsumption'));
    s.loadSeconds = positive(num(c, 'mTimeToCompleteLoad'));
    s.unloadSeconds = positive(num(c, 'mTimeToCompleteUnload'));

    for (const k of Object.keys(s) as (keyof MachineStats)[]) if (s[k] === undefined) delete s[k];
    return s;
  };

  const machines: (MachineEntry & { priority: number })[] = entries.map(({ c, category }) => {
    const descriptor = descriptorOf(c);
    const name = named(c);
    if (!name.en) problems.push(`${c.ClassName} has no display name`);
    const entry: MachineEntry & { priority: number } = {
      id: c.ClassName, category, name, description: translated(c, 'mDescription'), wikiPage: wikiTitle(name.en),
      stats: statsOf(c, category), unlockedBy: [],
      priority: num(byName.get(descriptor) ?? c, 'mMenuPriority') ?? 0,
    };
    const build = buildRecipes.get(descriptor);
    if (build) {
      const cost: BuildCost = { place: build.place, ingredients: amounts(str(build.recipe, 'mIngredients')).map(a => scaled(a, build.recipe.ClassName)) };
      entry.build = cost;
      const seen = new Set<string>();
      entry.unlockedBy = (unlocks.get(build.recipe.ClassName) ?? [])
        .filter(u => !seen.has(u.name.en) && seen.add(u.name.en))
        .sort((a, b) => UNLOCK_ORDER.indexOf(a.kind) - UNLOCK_ORDER.indexOf(b.kind) || a.tier - b.tier);
    } else {
      problems.push(`${c.ClassName}: no build recipe for ${descriptor}`);
    }
    return entry;
  });

  for (const category of MACHINE_CATEGORIES) {
    if (!machines.some(m => m.category === category)) problems.push(`no ${category} entries found`);
  }
  if (recipes.length === 0) problems.push('no recipes found');
  if (problems.length > 0) throw new MachineBuildError(problems);

  // Within a category in game progress order: tier of the first unlock (shop and other unlocks last), then build menu order
  const progress = (m: MachineEntry): number => {
    const u = m.unlockedBy[0];
    return u && (u.kind === 'tutorial' || u.kind === 'milestone' || u.kind === 'mam') ? u.tier : Number.MAX_SAFE_INTEGER;
  };
  const sorted = MACHINE_CATEGORIES.flatMap(category => machines
    .filter(m => m.category === category)
    .sort((a, b) => progress(a) - progress(b) || a.priority - b.priority || a.name.en.localeCompare(b.name.en))
    .map(({ priority: _priority, ...m }) => m));
  return { format: 1, source, items, machines: sorted, recipes };
}

/** Reads `en-US.json` and `de.json` from the Docs folder and builds the machine data. */
export function buildMachinesFromDocs(docsDir: string): MachineData {
  const de = join(docsDir, 'de.json');
  return buildMachineData(readDocsFile(join(docsDir, 'en-US.json')), existsSync(de) ? readDocsFile(de) : []);
}

/** One line for the build log. */
export function machineSummary(d: MachineData): string {
  const per = MACHINE_CATEGORIES.map(c => `${d.machines.filter(m => m.category === c).length} ${c}`).join(', ');
  return `${d.machines.length} entries (${per}), ${d.recipes.length} recipes, ${Object.keys(d.items).length} items`;
}

export function writeMachines(docsDir: string, outDir: string): MachineData {
  const data = buildMachinesFromDocs(docsDir);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'machines.json'), JSON.stringify(data));
  return data;
}

function main(): void {
  const { values: v } = parseArgs({ options: { docs: { type: 'string' }, out: { type: 'string' } } });
  if (!v.docs || !v.out) throw new Error('usage: npm run machines -- --docs <install>/CommunityResources/Docs --out data/<game-version>');
  try {
    const data = writeMachines(resolve(v.docs), resolve(v.out));
    console.log(`machines.json: ${machineSummary(data)}`);
  } catch (e) {
    if (e instanceof MachineBuildError) { console.error(e.message); process.exit(1); }
    throw e;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
