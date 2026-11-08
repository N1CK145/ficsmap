import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import type { ClockData, ExtractorKind, GameBelt, GamePipe, GameExtractor, GameItem, GameMachine, GameRecipe, ItemAmount, ItemForm, Names, RecipeData } from '../src/shared/recipes.js';

/**
 * Builds `recipes.json` (see src/shared/recipes.ts) from the game's own class dump,
 * `<install>/CommunityResources/Docs/en-US.json` and `de.json`: production recipes with their
 * buildings, the items they use, and the extractors. Only fields of the game data are used; nothing
 * is added by hand. See data-src/extractor/README.md, "Recipes and buildings".
 */

/** One class of the Docs dump with its native class (e.g. `FGRecipe`). Values are the game's strings. */
export interface DocsClass { native: string; fields: Record<string, unknown> & { ClassName: string } }

export class RecipeBuildError extends Error {
  constructor(public problems: string[]) {
    super(`Recipe data build failed:\n- ${problems.join('\n- ')}`);
    this.name = 'RecipeBuildError';
  }
}

/** Decodes a Docs file: UTF-16 LE with a byte order mark (the shipped files), UTF-8 otherwise. */
export function decodeDocs(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return new TextDecoder('utf-8').decode(bytes.subarray(3));
  return new TextDecoder('utf-8').decode(bytes);
}

/** The Docs JSON (`[{NativeClass, Classes: [...]}]`) as a flat list. */
export function parseDocs(text: string): DocsClass[] {
  const groups = JSON.parse(text) as { NativeClass: string; Classes: DocsClass['fields'][] }[];
  return groups.flatMap(g => {
    // "/Script/CoreUObject.Class'/Script/FactoryGame.FGRecipe'" -> "FGRecipe"
    const native = /\.(\w+)'?$/.exec(g.NativeClass)?.[1] ?? g.NativeClass;
    return g.Classes.map(fields => ({ native, fields }));
  });
}

export function readDocs(path: string): DocsClass[] {
  return parseDocs(decodeDocs(readFileSync(path)));
}

const MANUFACTURERS = new Set(['FGBuildableManufacturer', 'FGBuildableManufacturerVariablePower']);
const EXTRACTORS = new Set(['FGBuildableResourceExtractor', 'FGBuildableWaterPump', 'FGBuildableFrackingExtractor']);
const BELTS: Record<string, GameBelt['kind']> = { FGBuildableConveyorBelt: 'belt', FGBuildableConveyorLift: 'lift' };
/** Pipelines: `mFlowLimit` is in m³ per second (Mk.1: 5 → 300 m³/min). */
const PIPES = new Set(['FGBuildablePipeline']);
const FORMS: Record<string, ItemForm> = { RF_SOLID: 'solid', RF_LIQUID: 'liquid', RF_GAS: 'gas' };
/** The game stores fluid amounts in litres; recipes.json has m³. */
const LITRES_PER_M3 = 1000;

const str = (c: DocsClass, key: string): string => {
  const v = c.fields[key];
  return typeof v === 'string' ? v : '';
};
const num = (c: DocsClass, key: string): number => Number(str(c, key));
/** Class names (`Desc_X_C`, `Build_X_C`) in a UE text value, in order. */
const classNames = (value: string): string[] => [...value.matchAll(/\.(\w+_C)\b/g)].map(m => m[1]!);
/** `((ItemClass="…Desc_X.Desc_X_C'",Amount=3),…)` -> [{item, amount}]. */
const amounts = (value: string): { item: string; amount: number }[] =>
  [...value.matchAll(/ItemClass="[^"]*?\.(\w+_C)'?",Amount=([\d.]+)/g)].map(m => ({ item: m[1]!, amount: Number(m[2]) }));
/** Rounds away float noise from divisions (e.g. 0.1 + 0.2); the game's numbers have few decimals. */
const clean = (n: number): number => Math.round(n * 1e6) / 1e6;

/**
 * The "default extraction rate" written in an extractor's English description ("Default extraction
 * rate is 60 resources per minute", "Default Extraction Rate: 120 m³ of water per minute"), or null.
 */
export function describedRate(description: string): number | null {
  const m = /default extraction rate(?: is|:)\s*([\d.,]+)/i.exec(description);
  return m ? Number(m[1]!.replace(/,/g, '')) : null;
}

/**
 * A display name on one line. Some German names carry a line break for the in-game UI
 * ("Plutonium- \r\nbrennstab"): a hyphen, then a line break, then a lower-case letter is a split word and
 * is joined ("Plutoniumbrennstab"); other line breaks become a space. A hyphen before a plain space stays
 * ("Luft- und Raumfahrttechnik").
 */
export function oneLine(text: string): string {
  return text.replace(/-[ \t]*[\r\n]+\s*(?=\p{Ll})/gu, '').replace(/\s*[\r\n]+\s*/g, ' ').trim();
}

/**
 * The clock speed values (see `ClockData`): `mMinPotential` of the given buildings, which must all be
 * the same, and `mExtraPotential` of the one overclocking Power Shard (`FGPowerShardDescriptor` with
 * `mPowerShardType` `PST_Overclock`). Every building must have `mMaxPotential` 1 (100 % without shards),
 * as the planner's upper limit is 100 % plus the shards. Problems are added to `problems`.
 */
export function clockData(buildings: readonly DocsClass[], en: readonly DocsClass[], problems: string[]): ClockData {
  const mins = new Set<number>();
  for (const c of buildings) {
    const min = num(c, 'mMinPotential');
    if (!(min > 0 && min < 1)) problems.push(`${c.fields.ClassName}: mMinPotential ${str(c, 'mMinPotential') || 'missing'}`);
    else mins.add(min);
    if (num(c, 'mMaxPotential') !== 1) problems.push(`${c.fields.ClassName}: mMaxPotential ${str(c, 'mMaxPotential') || 'missing'} is not 1 (not supported)`);
  }
  if (mins.size > 1) problems.push(`mMinPotential differs between buildings: ${[...mins].sort((a, b) => a - b).join(', ')}`);
  const shards = en.filter(c => c.native === 'FGPowerShardDescriptor' && str(c, 'mPowerShardType') === 'PST_Overclock');
  if (shards.length !== 1) problems.push(`expected one overclocking Power Shard (PST_Overclock), found ${shards.length}`);
  const perShard = shards.length === 1 ? num(shards[0]!, 'mExtraPotential') : Number.NaN;
  if (shards.length === 1 && !(perShard > 0)) problems.push(`${shards[0]!.fields.ClassName}: mExtraPotential ${str(shards[0]!, 'mExtraPotential') || 'missing'}`);
  return { min: [...mins][0] ?? Number.NaN, perShard };
}

export function buildRecipeData(en: readonly DocsClass[], de: readonly DocsClass[], source = 'CommunityResources/Docs: en-US.json, de.json'): RecipeData {
  const problems: string[] = [];
  const byName = new Map(en.map(c => [c.fields.ClassName, c]));
  const deByName = new Map(de.map(c => [c.fields.ClassName, c]));
  const names = (c: DocsClass): Names => {
    const enName = oneLine(str(c, 'mDisplayName'));
    const deName = deByName.get(c.fields.ClassName);
    if (!deName) problems.push(`${c.fields.ClassName} is missing in de.json`);
    return { en: enName, de: (deName && oneLine(str(deName, 'mDisplayName'))) || enName };
  };

  const formOf = (id: string): ItemForm | undefined => {
    const c = byName.get(id);
    return c ? FORMS[str(c, 'mForm')] : undefined;
  };
  const scale = (id: string, amount: number) => (formOf(id) === 'solid' ? amount : clean(amount / LITRES_PER_M3));
  const usedItems = new Set<string>();
  const ioList = (list: { item: string; amount: number }[]): ItemAmount[] => list.map(a => {
    usedItems.add(a.item);
    return { item: a.item, amount: scale(a.item, a.amount) };
  });

  // Production buildings
  const machineClasses = new Map(en.filter(c => MANUFACTURERS.has(c.native)).map(c => [c.fields.ClassName, c]));
  for (const [id, c] of machineClasses) {
    if (num(c, 'mManufacturingSpeed') !== 1) problems.push(`${id}: mManufacturingSpeed ${str(c, 'mManufacturingSpeed')} is not 1 (not supported)`);
  }

  // Recipes made in a production building (build gun, workbench and workshop recipes are left out)
  const recipes: GameRecipe[] = [];
  const usedMachines = new Set<string>();
  for (const c of en) {
    if (c.native !== 'FGRecipe') continue;
    const id = c.fields.ClassName;
    const machinesOf = classNames(str(c, 'mProducedIn')).filter(m => machineClasses.has(m));
    if (machinesOf.length === 0) continue;
    if (machinesOf.length > 1) { problems.push(`${id} is made in more than one building: ${machinesOf.join(', ')}`); continue; }
    const machineId = machinesOf[0]!;
    const duration = num(c, 'mManufactoringDuration');
    const ingredients = amounts(str(c, 'mIngredients'));
    const products = amounts(str(c, 'mProduct'));
    if (!(duration > 0)) problems.push(`${id}: duration ${str(c, 'mManufactoringDuration')}`);
    if (products.length === 0) problems.push(`${id} has no products`);
    for (const a of [...ingredients, ...products]) {
      if (!formOf(a.item)) problems.push(`${id} uses ${a.item}, which is no item with a known form`);
    }
    const name = names(c);
    const recipe: GameRecipe = {
      id, name, alternate: name.en.startsWith('Alternate:'), machine: machineId, duration,
      ingredients: ioList(ingredients), products: ioList(products),
    };
    if (machineClasses.get(machineId)!.native === 'FGBuildableManufacturerVariablePower') {
      const constant = num(c, 'mVariablePowerConsumptionConstant');
      const factor = num(c, 'mVariablePowerConsumptionFactor');
      if (!(constant + factor > 0)) problems.push(`${id}: no variable power (constant ${constant}, factor ${factor})`);
      recipe.power = { min: constant, max: constant + factor };
    }
    usedMachines.add(machineId);
    recipes.push(recipe);
  }

  const machines: GameMachine[] = [...machineClasses.values()]
    .filter(c => usedMachines.has(c.fields.ClassName))
    .map(c => {
      const powerExponent = num(c, 'mPowerConsumptionExponent');
      if (!(powerExponent > 0)) problems.push(`${c.fields.ClassName}: no mPowerConsumptionExponent`);
      return { id: c.fields.ClassName, name: names(c), power: num(c, 'mPowerConsumption'), powerExponent };
    });

  // Extractors
  const resources = en.filter(c => c.native === 'FGResourceDescriptor');
  const extractors: GameExtractor[] = [];
  const extractorClasses: DocsClass[] = [];
  for (const c of en) {
    if (!EXTRACTORS.has(c.native)) continue;
    const id = c.fields.ClassName;
    const forms = [...str(c, 'mAllowedResourceForms').matchAll(/RF_\w+/g)].map(m => m[0]);
    const allowed = str(c, 'mOnlyAllowCertainResources') === 'True'
      ? classNames(str(c, 'mAllowedResources'))
      : resources.filter(r => forms.includes(str(r, 'mForm'))).map(r => r.fields.ClassName);
    if (allowed.length === 0) { problems.push(`${id} extracts nothing`); continue; }
    const fluid = allowed.map(formOf);
    if (new Set(fluid.map(f => f === 'solid')).size > 1) problems.push(`${id} extracts solids and fluids`);
    const perMinute = num(c, 'mItemsPerCycle') / num(c, 'mExtractCycleTime') * 60;
    const rate = clean(fluid[0] === 'solid' ? perMinute : perMinute / LITRES_PER_M3);
    const kind: ExtractorKind = c.native === 'FGBuildableFrackingExtractor' ? 'well' : fluid[0] === 'solid' ? 'miner' : 'pump';
    const described = describedRate(str(c, 'mDescription'));
    if (described !== null && described !== rate) problems.push(`${id}: computed rate ${rate}/min, the description says ${described}`);
    const ex: GameExtractor = {
      id, name: names(c), kind, rate,
      power: num(c, 'mPowerConsumption'), powerExponent: num(c, 'mPowerConsumptionExponent'),
      resources: allowed, onNode: c.native !== 'FGBuildableWaterPump',
    };
    const tier = /Mk(\d+)/.exec(id)?.[1];
    if (kind === 'miner' && tier) ex.tier = Number(tier);
    for (const r of allowed) usedItems.add(r);
    extractors.push(ex);
    extractorClasses.push(c);
  }
  const pressurizer = en.find(c => c.native === 'FGBuildableFrackingActivator');
  if (extractors.some(e => e.kind === 'well') && !pressurizer) problems.push('resource well extractor without a pressurizer (FGBuildableFrackingActivator)');
  const wellPressurizer: RecipeData['wellPressurizer'] = pressurizer && {
    id: pressurizer.fields.ClassName, name: names(pressurizer),
    power: num(pressurizer, 'mPowerConsumption'), powerExponent: num(pressurizer, 'mPowerConsumptionExponent'),
  };
  if (wellPressurizer && !(wellPressurizer.powerExponent > 0)) problems.push(`${wellPressurizer.id}: no mPowerConsumptionExponent`);

  const clock = clockData([
    ...[...machineClasses.values()].filter(c => usedMachines.has(c.fields.ClassName)),
    ...extractorClasses,
    ...(pressurizer ? [pressurizer] : []),
  ], en, problems);

  const items: GameItem[] = [];
  for (const id of usedItems) {
    const c = byName.get(id);
    const form = formOf(id);
    if (!c || !form) continue; // reported above
    const item: GameItem = { id, name: names(c), form };
    // mCachedStackSize is the slot size in the game's unit (litres for fluids).
    const stack = num(c, 'mCachedStackSize');
    if (stack > 0) item.stackSize = form === 'solid' ? stack : clean(stack / LITRES_PER_M3);
    items.push(item);
  }

  // Conveyor belts and lifts: mSpeed is in half items per minute (Mk.1: 120 → 60/min).
  const belts: GameBelt[] = [];
  for (const c of en) {
    const kind = BELTS[c.native];
    if (!kind) continue;
    const speed = num(c, 'mSpeed');
    if (!(speed > 0)) { problems.push(`${c.fields.ClassName}: mSpeed ${str(c, 'mSpeed') || 'missing'}`); continue; }
    belts.push({ id: c.fields.ClassName, name: names(c), kind, rate: clean(speed / 2) });
  }
  belts.sort((a, b) => a.rate - b.rate || a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));

  // Pipelines: mFlowLimit in m³/s; recipes.json has fluids per minute in m³.
  const pipes: GamePipe[] = [];
  for (const c of en) {
    if (!PIPES.has(c.native)) continue;
    const limit = num(c, 'mFlowLimit');
    if (!(limit > 0)) { problems.push(`${c.fields.ClassName}: mFlowLimit ${str(c, 'mFlowLimit') || 'missing'}`); continue; }
    pipes.push({ id: c.fields.ClassName, name: names(c), rate: clean(limit * 60) });
  }
  pipes.sort((a, b) => a.rate - b.rate || a.id.localeCompare(b.id));

  if (recipes.length === 0) problems.push('no recipes found');
  if (!extractors.some(e => e.kind === 'miner')) problems.push('no miners found');
  if (problems.length > 0) throw new RecipeBuildError(problems);

  const data: RecipeData = { format: 1, source, clock, items, recipes, machines, extractors };
  if (wellPressurizer) data.wellPressurizer = wellPressurizer;
  if (belts.length > 0) data.belts = belts;
  if (pipes.length > 0) data.pipes = pipes;
  return data;
}

/** Reads `en-US.json` and `de.json` from the Docs folder and builds the recipe data. */
export function buildRecipesFromDocs(docsDir: string): RecipeData {
  return buildRecipeData(readDocs(join(docsDir, 'en-US.json')), readDocs(join(docsDir, 'de.json')));
}

/** One line for the build log. */
export function recipeSummary(d: RecipeData): string {
  const alternates = d.recipes.filter(r => r.alternate).length;
  return `${d.recipes.length} recipes (${alternates} alternates), ${d.items.length} items, ${d.machines.length} buildings, `
    + `${d.extractors.length} extractors (${d.extractors.map(e => `${e.name.en} ${e.rate}/min`).join(', ')}), `
    + `clock speed from ${d.clock.min * 100} %, +${d.clock.perShard * 100} % per Power Shard, `
    + `${d.items.filter(i => i.stackSize !== undefined).length} stack sizes, belts ${(d.belts ?? []).filter(b => b.kind === 'belt').map(b => `${b.rate}/min`).join(', ') || 'none'}, `
    + `pipelines ${(d.pipes ?? []).map(p => `${p.rate} m³/min`).join(', ') || 'none'}`;
}

export function writeRecipes(docsDir: string, outDir: string): RecipeData {
  const data = buildRecipesFromDocs(docsDir);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'recipes.json'), JSON.stringify(data));
  return data;
}

function main(): void {
  const { values: v } = parseArgs({ options: { docs: { type: 'string' }, out: { type: 'string' } } });
  if (!v.docs || !v.out) throw new Error('usage: npm run recipes -- --docs <install>/CommunityResources/Docs --out data/<game-version>');
  try {
    const data = writeRecipes(resolve(v.docs), resolve(v.out));
    console.log(`recipes.json: ${recipeSummary(data)}`);
  } catch (e) {
    if (e instanceof RecipeBuildError) { console.error(e.message); process.exit(1); }
    throw e;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
