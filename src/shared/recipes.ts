/**
 * The game's items, production recipes (standard and alternate), production buildings and extractors,
 * as stored in a dataset's optional `recipes.json` (built by `scripts/recipes.ts` from the game's
 * `CommunityResources/Docs/*.json`). Shared by the production planner and, later, the search.
 *
 * Units: solid items count in pieces, fluids (liquids and gases) in m³. The game stores fluid amounts
 * in litres (1000 per m³); `recipes.json` already has them divided by 1000.
 */

export interface Names { en: string; de: string }
export type ItemForm = 'solid' | 'liquid' | 'gas';

export interface GameItem {
  /** Descriptor class, e.g. `Desc_IronPlate_C`. */
  id: string;
  name: Names;
  form: ItemForm;
  /**
   * How many fit in one inventory slot (the game's `mCachedStackSize`): pieces for solids, m³ for fluids. Missing in
   * datasets built before it was added.
   */
  stackSize?: number;
}

/** An amount per production cycle (fluids in m³). */
export interface ItemAmount { item: string; amount: number }

export interface GameRecipe {
  /** Recipe class, e.g. `Recipe_IronPlate_C`. */
  id: string;
  name: Names;
  /** "Alternate: …" recipes (from hard drives and some MAM research). */
  alternate: boolean;
  /** The production building it runs in (a `GameMachine` id). */
  machine: string;
  /** Seconds per cycle at 100 % clock speed. */
  duration: number;
  ingredients: ItemAmount[];
  /** First entry is the main product, the rest are by-products. */
  products: ItemAmount[];
  /** Only for buildings with variable power: MW over a cycle, from `min` to `max`. */
  power?: { min: number; max: number };
}

export interface GameMachine {
  /** Building class, e.g. `Build_ConstructorMk1_C`. */
  id: string;
  name: Names;
  /** MW at 100 % clock speed; 0 for buildings whose power comes from the recipe (`GameRecipe.power`). */
  power: number;
  /** The game's `mPowerConsumptionExponent`: power at clock speed c is `power * c^powerExponent`. */
  powerExponent: number;
}

/** `miner`: solid resources from a node; `pump`: one fluid (water from a lake, oil from a node); `well`: a resource well's sub-node. */
export type ExtractorKind = 'miner' | 'pump' | 'well';

export interface GameExtractor {
  id: string;
  name: Names;
  kind: ExtractorKind;
  /** Miners only: the Mk. number from the class name (1, 2, 3). */
  tier?: number;
  /** Units per minute at 100 % clock speed: the game's "default extraction rate" (fluids in m³). */
  rate: number;
  /** MW at 100 % clock speed. */
  power: number;
  /** The game's `mPowerConsumptionExponent`: power at clock speed c is `power * c^powerExponent`. */
  powerExponent: number;
  /** Resource item ids it can extract. */
  resources: string[];
  /** Built on a resource node, whose purity changes the rate (not the water extractor). */
  onNode: boolean;
}

/** A conveyor belt or lift tier: what it carries per minute (the game's `mSpeed` / 2). */
/** A pipeline class and its flow limit (`mFlowLimit` × 60, m³/min). */
export interface GamePipe {
  /** Building class, e.g. `Build_PipelineMK2_C`. */
  id: string;
  name: Names;
  /** m³ per minute. */
  rate: number;
}

export interface GameBelt {
  /** Building class, e.g. `Build_ConveyorBeltMk2_C`. */
  id: string;
  name: Names;
  kind: 'belt' | 'lift';
  /** Items per minute. */
  rate: number;
}

/** Clock speed values from the Docs, 1 = 100 %. */
export interface ClockData {
  /** Lowest clock speed: `mMinPotential`, the same for every production building and extractor. */
  min: number;
  /** What one Power Shard adds: `mExtraPotential` of the overclocking shard (`Desc_CrystalShard_C`). */
  perShard: number;
}

export interface RecipeData {
  format: 1;
  /** Where the data came from, for the record (file names, not paths). */
  source: string;
  clock: ClockData;
  items: GameItem[];
  recipes: GameRecipe[];
  machines: GameMachine[];
  extractors: GameExtractor[];
  /**
   * The Resource Well Pressurizer: one per resource well, not per extractor. Its clock speed sets the
   * whole well's output (the Resource Well Extractors cannot be overclocked); power at clock speed c is
   * `power * c^powerExponent`. Present whenever there is a resource well extractor.
   */
  wellPressurizer?: { id: string; name: Names; power: number; powerExponent: number };
  /** Conveyor belts and lifts with their rate, slowest first; missing in datasets built before it was added. */
  belts?: GameBelt[];
  /** Pipelines with their flow limit (m³/min), slowest first; missing in datasets built before it was added. */
  pipes?: GamePipe[];
}

export interface RecipeIndex {
  data: RecipeData;
  items: ReadonlyMap<string, GameItem>;
  recipes: ReadonlyMap<string, GameRecipe>;
  machines: ReadonlyMap<string, GameMachine>;
  extractors: ReadonlyMap<string, GameExtractor>;
  /** Per item every recipe that makes it (as main or by-product), the default first; see `rankProducers`. */
  producers: ReadonlyMap<string, readonly GameRecipe[]>;
  /** Per item every recipe that uses it as an ingredient (standard first, then by name). */
  consumers: ReadonlyMap<string, readonly GameRecipe[]>;
  /** Per resource the extractors for it: pumps before wells, miners by tier. */
  extractorsFor: ReadonlyMap<string, readonly GameExtractor[]>;
  /** Items that can be made or extracted, i.e. that the planner can plan for. */
  plannable: readonly GameItem[];
}

const KIND_ORDER: Record<ExtractorKind, number> = { miner: 0, pump: 1, well: 2 };

/** The Packager; recipes in it that make a fluid unpack it (Unpackage Water, …). */
const PACKAGER = 'Build_Packager_C';

/**
 * Producers of `item` in the order the planner offers them; the first is the default:
 * 1. recipes with the item as main product before those with it as by-product;
 * 2. standard before alternate;
 * 3. the recipe named like the item first ("Fuel" before "Residual Fuel"), then data order.
 * Unpacking recipes (a fluid out of the Packager) come last: as a default they would loop with the
 * packaging recipe (Heavy Oil Residue from Packaged Heavy Oil Residue from Heavy Oil Residue).
 */
export function rankProducers(item: GameItem, recipes: readonly GameRecipe[], items: ReadonlyMap<string, GameItem> = new Map()): GameRecipe[] {
  const rank = (r: GameRecipe): number[] => {
    const main = r.products[0]?.item;
    const unpacks = r.machine === PACKAGER && main !== undefined && isFluid(items.get(main));
    return [unpacks ? 1 : 0, main === item.id ? 0 : 1, r.alternate ? 1 : 0, r.name.en === item.name.en ? 0 : 1];
  };
  return recipes
    .map((r, i) => ({ r, i, k: rank(r) }))
    .sort((a, b) => a.k.reduce((d, v, j) => d || v - b.k[j]!, 0) || a.i - b.i)
    .map(x => x.r);
}

export function indexRecipes(data: RecipeData): RecipeIndex {
  const items = new Map(data.items.map(i => [i.id, i]));
  const recipes = new Map(data.recipes.map(r => [r.id, r]));
  const machines = new Map(data.machines.map(m => [m.id, m]));
  const extractors = new Map(data.extractors.map(e => [e.id, e]));

  const making = new Map<string, GameRecipe[]>();
  const using = new Map<string, GameRecipe[]>();
  for (const r of data.recipes) {
    for (const p of r.products) making.set(p.item, [...(making.get(p.item) ?? []), r]);
    for (const g of r.ingredients) using.set(g.item, [...(using.get(g.item) ?? []), r]);
  }
  const producers = new Map<string, GameRecipe[]>();
  for (const [id, list] of making) {
    const item = items.get(id);
    if (item) producers.set(id, rankProducers(item, list, items));
  }
  const consumers = new Map<string, GameRecipe[]>();
  for (const [id, list] of using) {
    consumers.set(id, [...list].sort((a, b) => Number(a.alternate) - Number(b.alternate) || a.name.en.localeCompare(b.name.en)));
  }
  const extractorsFor = new Map<string, GameExtractor[]>();
  for (const e of data.extractors) {
    for (const res of e.resources) extractorsFor.set(res, [...(extractorsFor.get(res) ?? []), e]);
  }
  for (const list of extractorsFor.values()) list.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || (a.tier ?? 0) - (b.tier ?? 0));

  const plannable = data.items.filter(i => producers.has(i.id) || extractorsFor.has(i.id));
  return { data, items, recipes, machines, extractors, producers, consumers, extractorsFor, plannable };
}

/** Whether amounts of the item are in m³ (liquids and gases). */
export function isFluid(item: GameItem | undefined): boolean {
  return item !== undefined && item.form !== 'solid';
}

/** Units per minute one building makes or uses of `amount` at 100 % clock speed. */
export function perMinute(recipe: GameRecipe, amount: number): number {
  return amount * 60 / recipe.duration;
}

/** The miners, by tier. */
export function miners(index: RecipeIndex): GameExtractor[] {
  return [...index.extractors.values()].filter(e => e.kind === 'miner').sort((a, b) => (a.tier ?? 0) - (b.tier ?? 0));
}

/**
 * Text a recipe can be found by (for a search): its names in both languages and the names of its
 * products, ingredients and building.
 */
export function recipeTerms(index: RecipeIndex, recipe: GameRecipe): string[] {
  const names = (n: Names | undefined) => (n ? [n.en, n.de] : []);
  return [
    ...names(recipe.name),
    ...recipe.products.flatMap(p => names(index.items.get(p.item)?.name)),
    ...recipe.ingredients.flatMap(g => names(index.items.get(g.item)?.name)),
    ...names(index.machines.get(recipe.machine)?.name),
  ];
}
