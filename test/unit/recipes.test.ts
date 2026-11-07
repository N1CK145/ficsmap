import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { buildRecipeData, buildRecipesFromDocs, decodeDocs, describedRate, oneLine, parseDocs, RecipeBuildError } from '../../scripts/recipes.js';
import { indexRecipes, miners, rankProducers, recipeTerms, type GameItem, type GameRecipe, type RecipeData } from '../../src/shared/recipes.js';

// A miniature of the game's CommunityResources/Docs/*.json: same structure and value syntax, made-up classes and numbers.
const path = (dir: string, cls: string) => `/Script/Engine.BlueprintGeneratedClass'/Game/FactoryGame/${dir}/${cls.slice(0, -2)}.${cls}'`;
const io = (list: [string, number][]) => `(${list.map(([c, a]) => `(ItemClass="${path('Resource', c)}",Amount=${a})`).join(',')})`;
const produced = (...cls: string[]) => `(${cls.map(c => `"/Game/FactoryGame/Buildable/${c.slice(0, -2)}.${c}"`).join(',')})`;
const native = (n: string) => `/Script/CoreUObject.Class'/Script/FactoryGame.${n}'`;
/** Clock speed range of every building in the game: 1 % to 100 % (shards add to it). */
const pot = { mMinPotential: '0.010000', mMaxPotential: '1.000000' };
type Groups = { NativeClass: string; Classes: Record<string, string>[] }[];

function docs(lang: 'en' | 'de') {
  const n = (en: string, de: string) => (lang === 'en' ? en : de);
  return [
    { NativeClass: native('FGResourceDescriptor'), Classes: [
      { ClassName: 'Desc_OreIron_C', mDisplayName: n('Iron Ore', 'Eisenerz'), mForm: 'RF_SOLID' },
      { ClassName: 'Desc_Water_C', mDisplayName: n('Water', 'Wasser'), mForm: 'RF_LIQUID' },
    ] },
    { NativeClass: native('FGItemDescriptor'), Classes: [
      // Split over two lines like Plutonium Fuel Rod in the German file
      { ClassName: 'Desc_IronIngot_C', mDisplayName: n('Iron Ingot', 'Eisen- \r\nbarren'), mForm: 'RF_SOLID' },
      { ClassName: 'Desc_Slurry_C', mDisplayName: n('Slurry', 'Schlamm'), mForm: 'RF_LIQUID' },
      { ClassName: 'Desc_Unused_C', mDisplayName: n('Unused', 'Unbenutzt'), mForm: 'RF_SOLID' },
    ] },
    { NativeClass: native('FGRecipe'), Classes: [
      { ClassName: 'Recipe_IngotIron_C', mDisplayName: n('Iron Ingot', 'Eisenbarren'), mIngredients: io([['Desc_OreIron_C', 1]]),
        mProduct: io([['Desc_IronIngot_C', 1]]), mManufactoringDuration: '2.000000', mProducedIn: produced('Build_SmelterMk1_C', 'BP_WorkBenchComponent_C') },
      { ClassName: 'Recipe_Alternate_Wet_C', mDisplayName: n('Alternate: Wet Ingot', 'Alternativ: Nasser Barren'),
        mIngredients: io([['Desc_OreIron_C', 3], ['Desc_Water_C', 2000]]), mProduct: io([['Desc_IronIngot_C', 4], ['Desc_Slurry_C', 500]]),
        mManufactoringDuration: '6.000000', mProducedIn: produced('Build_Refinery_C') },
      { ClassName: 'Recipe_Glow_C', mDisplayName: n('Glow', 'Glühen'), mIngredients: io([['Desc_IronIngot_C', 1]]),
        mProduct: io([['Desc_Slurry_C', 1000]]), mManufactoringDuration: '10.000000', mProducedIn: produced('Build_Collider_C'),
        mVariablePowerConsumptionConstant: '250.000000', mVariablePowerConsumptionFactor: '500.000000' },
      { ClassName: 'Recipe_Wall_C', mDisplayName: n('Wall', 'Wand'), mIngredients: io([['Desc_Unused_C', 1]]),
        mProduct: io([['Desc_Unused_C', 1]]), mManufactoringDuration: '1.000000', mProducedIn: produced('BP_BuildGun_C') },
    ] },
    { NativeClass: native('FGBuildableManufacturer'), Classes: [
      { ClassName: 'Build_SmelterMk1_C', mDisplayName: n('Smelter', 'Schmelzofen'), mPowerConsumption: '4.000000', mPowerConsumptionExponent: '1.321929', mManufacturingSpeed: '1.000000', ...pot },
      { ClassName: 'Build_Refinery_C', mDisplayName: n('Refinery', 'Raffinerie'), mPowerConsumption: '30.000000', mPowerConsumptionExponent: '1.321929', mManufacturingSpeed: '1.000000', ...pot },
      { ClassName: 'Build_Idle_C', mDisplayName: n('Idle', 'Leerlauf'), mPowerConsumption: '1.000000', mPowerConsumptionExponent: '1.321929', mManufacturingSpeed: '1.000000', ...pot },
    ] },
    { NativeClass: native('FGBuildableManufacturerVariablePower'), Classes: [
      { ClassName: 'Build_Collider_C', mDisplayName: n('Collider', 'Beschleuniger'), mPowerConsumption: '0.000000', mPowerConsumptionExponent: '1.321929', mManufacturingSpeed: '1.000000', ...pot },
    ] },
    { NativeClass: native('FGBuildableResourceExtractor'), Classes: [
      { ClassName: 'Build_MinerMk2_C', mDisplayName: n('Miner Mk.2', 'Miner Mk.2'), mExtractCycleTime: '0.500000', mItemsPerCycle: '1',
        mAllowedResourceForms: '(RF_SOLID)', mOnlyAllowCertainResources: 'False', mAllowedResources: '', mPowerConsumption: '15.000000',
        mPowerConsumptionExponent: '1.321929', mDescription: n('Default extraction rate is 120 resources per minute.', 'x'), ...pot },
    ] },
    { NativeClass: native('FGBuildableWaterPump'), Classes: [
      { ClassName: 'Build_WaterPump_C', mDisplayName: n('Water Extractor', 'Wasserextraktor'), mExtractCycleTime: '1.000000', mItemsPerCycle: '2000',
        mAllowedResourceForms: '(RF_LIQUID)', mOnlyAllowCertainResources: 'True', mAllowedResources: `("${path('Resource', 'Desc_Water_C')}")`,
        mPowerConsumption: '20.000000', mPowerConsumptionExponent: '1.321929', mDescription: 'Default Extraction Rate: 120 m³ of water per minute.', ...pot },
    ] },
    { NativeClass: native('FGBuildableFrackingActivator'), Classes: [
      { ClassName: 'Build_FrackingSmasher_C', mDisplayName: n('Pressurizer', 'Kompressor'), mPowerConsumption: '150.000000', mPowerConsumptionExponent: '1.321929', ...pot },
    ] },
    { NativeClass: native('FGPowerShardDescriptor'), Classes: [
      { ClassName: 'Desc_CrystalShard_C', mDisplayName: n('Power Shard', 'Energiefragment'), mForm: 'RF_SOLID', mPowerShardType: 'PST_Overclock', mExtraPotential: '0.500000' },
      { ClassName: 'Desc_WAT1_C', mDisplayName: n('Somersloop', 'Somersloop'), mForm: 'RF_SOLID', mPowerShardType: 'PST_ProductionBoost', mExtraPotential: '0.000000' },
    ] },
  ];
}

/** A resource well extractor for water (not in the base docs, which then need no pressurizer). */
const addWell = (d: ReturnType<typeof docs>) => {
  (d as Groups).push({ NativeClass: native('FGBuildableFrackingExtractor'), Classes: [
    { ClassName: 'Build_FrackingExtractor_C', mDisplayName: 'Well Extractor', mExtractCycleTime: '1.000000', mItemsPerCycle: '1000',
      mAllowedResourceForms: '(RF_LIQUID)', mOnlyAllowCertainResources: 'True', mAllowedResources: `("${path('Resource', 'Desc_Water_C')}")`,
      mPowerConsumption: '0.000000', mPowerConsumptionExponent: '1.321929', ...pot },
  ] });
};

const parse = (lang: 'en' | 'de', mutate?: (d: ReturnType<typeof docs>) => void) => {
  const d = docs(lang);
  mutate?.(d);
  return parseDocs(JSON.stringify(d));
};

describe('recipe data from the game docs', () => {
  it('decodes UTF-16 LE with BOM (the shipped files) and plain UTF-8', () => {
    const text = '[{"a":"Eisenbarren ü m³"}]';
    expect(decodeDocs(new Uint8Array(Buffer.from(`﻿${text}`, 'utf16le')))).toBe(text);
    expect(decodeDocs(new Uint8Array(Buffer.from(text, 'utf8')))).toBe(text);
    expect(decodeDocs(new Uint8Array(Buffer.from(`﻿${text}`, 'utf8')))).toBe(text);
  });

  it('keeps only building recipes, converts fluids to m³ and flags alternates', () => {
    const d = buildRecipeData(parse('en'), parse('de'));
    expect(d.recipes.map(r => r.id)).toEqual(['Recipe_IngotIron_C', 'Recipe_Alternate_Wet_C', 'Recipe_Glow_C']);
    const wet = d.recipes[1]!;
    expect(wet).toMatchObject({
      alternate: true, machine: 'Build_Refinery_C', duration: 6,
      name: { en: 'Alternate: Wet Ingot', de: 'Alternativ: Nasser Barren' },
      ingredients: [{ item: 'Desc_OreIron_C', amount: 3 }, { item: 'Desc_Water_C', amount: 2 }],
      products: [{ item: 'Desc_IronIngot_C', amount: 4 }, { item: 'Desc_Slurry_C', amount: 0.5 }],
    });
    expect(d.recipes[0]).toMatchObject({ alternate: false, machine: 'Build_SmelterMk1_C' });
    expect(d.recipes[0]!.power).toBeUndefined();
    expect(d.recipes[2]!.power).toEqual({ min: 250, max: 750 });
    // Only buildings and items that are used
    expect(d.machines.map(m => m.id)).toEqual(['Build_SmelterMk1_C', 'Build_Refinery_C', 'Build_Collider_C']);
    expect(d.machines[1]).toEqual({ id: 'Build_Refinery_C', name: { en: 'Refinery', de: 'Raffinerie' }, power: 30, powerExponent: 1.321929 });
    expect(d.items.map(i => i.id).sort()).toEqual(['Desc_IronIngot_C', 'Desc_OreIron_C', 'Desc_Slurry_C', 'Desc_Water_C']);
    expect(d.items.find(i => i.id === 'Desc_Water_C')).toEqual({ id: 'Desc_Water_C', name: { en: 'Water', de: 'Wasser' }, form: 'liquid' });
    expect(d.wellPressurizer).toEqual({ id: 'Build_FrackingSmasher_C', name: { en: 'Pressurizer', de: 'Kompressor' }, power: 150, powerExponent: 1.321929 });
  });

  it('joins names split over two lines', () => {
    const d = buildRecipeData(parse('en'), parse('de'));
    expect(d.items.find(i => i.id === 'Desc_IronIngot_C')!.name).toEqual({ en: 'Iron Ingot', de: 'Eisenbarren' });
    expect(oneLine('Plutonium- \r\nbrennstab')).toBe('Plutoniumbrennstab');
    expect(oneLine('Plutonium-\nbrennstab')).toBe('Plutoniumbrennstab');
    // A hyphen before a space is no split word; other breaks become a space.
    expect(oneLine('Luft- und Raumfahrttechnik')).toBe('Luft- und Raumfahrttechnik');
    expect(oneLine('Heavy Oil\r\nResidue ')).toBe('Heavy Oil Residue');
    expect(oneLine('Alien-\r\nDNA')).toBe('Alien- DNA');
  });

  it('reads the clock speed values from the docs and fails if they are missing or differ', () => {
    expect(buildRecipeData(parse('en'), parse('de')).clock).toEqual({ min: 0.01, perShard: 0.5 });
    const problems = (mutate: (d2: ReturnType<typeof docs>) => void): string[] => {
      try { buildRecipeData(parse('en', mutate), parse('de')); } catch (e) { return (e as RecipeBuildError).problems; }
      return [];
    };
    const cls = (d2: ReturnType<typeof docs>, group: number, i = 0) => (d2 as Groups)[group]!.Classes[i]!;
    expect(problems(d2 => { delete cls(d2, 3).mMinPotential; })).toEqual(['Build_SmelterMk1_C: mMinPotential missing']);
    expect(problems(d2 => { cls(d2, 5).mMinPotential = '0.050000'; })).toEqual(['mMinPotential differs between buildings: 0.01, 0.05']);
    expect(problems(d2 => { cls(d2, 6).mMaxPotential = '2.500000'; })).toEqual(['Build_WaterPump_C: mMaxPotential 2.500000 is not 1 (not supported)']);
    expect(problems(d2 => { cls(d2, 8).mPowerShardType = 'PST_ProductionBoost'; })).toEqual(['expected one overclocking Power Shard (PST_Overclock), found 0']);
    expect(problems(d2 => { cls(d2, 8).mExtraPotential = ''; })).toEqual(['Desc_CrystalShard_C: mExtraPotential missing']);
    // A building no recipe uses does not count.
    expect(problems(d2 => { cls(d2, 3, 2).mMinPotential = '0.500000'; })).toEqual([]);
  });

  it('needs a pressurizer with a power exponent for resource well extractors', () => {
    const d = buildRecipeData(parse('en', addWell), parse('de', addWell));
    expect(d.extractors.find(e => e.kind === 'well')).toMatchObject({ id: 'Build_FrackingExtractor_C', rate: 60, power: 0 });
    expect(d.wellPressurizer).toMatchObject({ power: 150, powerExponent: 1.321929 });
    const noPressurizer = (d2: ReturnType<typeof docs>) => { addWell(d2); d2.splice(7, 1); };
    expect(() => buildRecipeData(parse('en', noPressurizer), parse('de', noPressurizer))).toThrow(/resource well extractor without a pressurizer/);
    const noExponent = (d2: ReturnType<typeof docs>) => { addWell(d2); delete (d2 as Groups)[7]!.Classes[0]!.mPowerConsumptionExponent; };
    expect(() => buildRecipeData(parse('en', noExponent), parse('de', addWell))).toThrow(/Build_FrackingSmasher_C: no mPowerConsumptionExponent/);
  });

  it('computes extractor rates from cycle time and items per cycle, and checks them against the description', () => {
    const d = buildRecipeData(parse('en'), parse('de'));
    expect(d.extractors).toEqual([
      { id: 'Build_MinerMk2_C', name: { en: 'Miner Mk.2', de: 'Miner Mk.2' }, kind: 'miner', tier: 2, rate: 120, power: 15,
        powerExponent: 1.321929, resources: ['Desc_OreIron_C'], onNode: true },
      { id: 'Build_WaterPump_C', name: { en: 'Water Extractor', de: 'Wasserextraktor' }, kind: 'pump', rate: 120, power: 20,
        powerExponent: 1.321929, resources: ['Desc_Water_C'], onNode: false },
    ]);
    expect(describedRate('Default extraction rate is 60 resources per minute.')).toBe(60);
    expect(describedRate('Default Extraction Rate: 120 m³ of oil per minute.')).toBe(120);
    expect(describedRate('Collects things.')).toBeNull();

    const wrong = (d2: ReturnType<typeof docs>) => {
      (d2[5]!.Classes[0] as Record<string, string>).mExtractCycleTime = '1.000000';
    };
    expect(() => buildRecipeData(parse('en', wrong), parse('de'))).toThrow(/computed rate 60\/min, the description says 120/);
  });

  it('fails on data it cannot represent', () => {
    const twoBuildings = (d2: ReturnType<typeof docs>) => {
      (d2[2]!.Classes[0] as Record<string, string>).mProducedIn = produced('Build_SmelterMk1_C', 'Build_Refinery_C');
    };
    const err = (() => { try { buildRecipeData(parse('en', twoBuildings), parse('de')); } catch (e) { return e; } })();
    expect(err).toBeInstanceOf(RecipeBuildError);
    expect((err as RecipeBuildError).problems).toEqual(['Recipe_IngotIron_C is made in more than one building: Build_SmelterMk1_C, Build_Refinery_C']);
    const speed = (d2: ReturnType<typeof docs>) => {
      (d2[3]!.Classes[0] as Record<string, string>).mManufacturingSpeed = '2.000000';
    };
    expect(() => buildRecipeData(parse('en', speed), parse('de'))).toThrow(/mManufacturingSpeed 2.000000 is not 1/);
  });

  it('indexes producers with the default first and finds recipes by text', () => {
    const idx = indexRecipes(buildRecipeData(parse('en'), parse('de')));
    expect(idx.producers.get('Desc_IronIngot_C')!.map(r => r.id)).toEqual(['Recipe_IngotIron_C', 'Recipe_Alternate_Wet_C']);
    // Main product (Glow) before by-product (Wet Ingot), although Wet Ingot comes first in the data
    expect(idx.producers.get('Desc_Slurry_C')!.map(r => r.id)).toEqual(['Recipe_Glow_C', 'Recipe_Alternate_Wet_C']);
    expect(idx.consumers.get('Desc_OreIron_C')!.map(r => r.id)).toEqual(['Recipe_IngotIron_C', 'Recipe_Alternate_Wet_C']);
    expect(idx.extractorsFor.get('Desc_Water_C')!.map(e => e.id)).toEqual(['Build_WaterPump_C']);
    expect(miners(idx).map(m => m.id)).toEqual(['Build_MinerMk2_C']);
    expect(idx.plannable.map(i => i.id).sort()).toEqual(['Desc_IronIngot_C', 'Desc_OreIron_C', 'Desc_Slurry_C', 'Desc_Water_C']);
    expect(recipeTerms(idx, idx.recipes.get('Recipe_Alternate_Wet_C')!)).toEqual(expect.arrayContaining(['Alternativ: Nasser Barren', 'Wasser', 'Raffinerie', 'Schlamm']));
  });
});

describe('rankProducers', () => {
  const it_ = (id: string, form: GameItem['form'] = 'solid'): GameItem => ({ id, name: { en: id, de: id }, form });
  const r = (id: string, products: string[], extra: Partial<GameRecipe> = {}): GameRecipe => ({
    id, name: { en: id, de: id }, alternate: false, machine: 'Build_ConstructorMk1_C', duration: 1, ingredients: [],
    products: products.map(item => ({ item, amount: 1 })), ...extra,
  });
  const residue = it_('Residue', 'liquid');
  const items = new Map([residue, it_('Plastic'), it_('Canister')].map(i => [i.id, i]));
  it('puts the main product before by-products, standard before alternate, unpacking last', () => {
    const ranked = rankProducers(residue, [
      r('Unpackage Residue', ['Residue', 'Canister'], { machine: 'Build_Packager_C' }),
      r('Plastic', ['Plastic', 'Residue']),
      r('Alternate: Residue', ['Residue'], { alternate: true }),
      r('Residual', ['Residue']),
      r('Residue', ['Residue']),
    ], items);
    expect(ranked.map(x => x.id)).toEqual(['Residue', 'Residual', 'Alternate: Residue', 'Plastic', 'Unpackage Residue']);
  });
});

// The real game data, when the install is there: FICSMAP_GAME_DOCS=<install>/CommunityResources/Docs
const DOCS = process.env.FICSMAP_GAME_DOCS;
describe.skipIf(!DOCS || !existsSync(join(DOCS, 'en-US.json')))('recipe data from the installed game', () => {
  let data: RecipeData;
  beforeAll(() => { data = buildRecipesFromDocs(DOCS!); });

  it('has the extractors with the rates their descriptions state', () => {
    const rate = Object.fromEntries(data.extractors.map(e => [e.id, e.rate]));
    expect(rate).toMatchObject({ Build_MinerMk1_C: 60, Build_MinerMk2_C: 120, Build_MinerMk3_C: 240, Build_WaterPump_C: 120, Build_OilPump_C: 120, Build_FrackingExtractor_C: 60 });
  });

  it('has the clock speed values, the pressurizer and German names on one line', () => {
    expect(data.clock).toEqual({ min: 0.01, perShard: 0.5 });
    expect(data.wellPressurizer).toMatchObject({ id: 'Build_FrackingSmasher_C', power: 150, powerExponent: 1.321929 });
    expect(data.items.find(i => i.id === 'Desc_PlutoniumFuelRod_C')?.name.de).toBe('Plutoniumbrennstab');
    expect(data.recipes.find(r => r.id === 'Recipe_PlutoniumFuelRod_C')?.name.de).toBe('Plutoniumbrennstab');
    const names = [...data.items, ...data.recipes, ...data.machines, ...data.extractors].flatMap(x => [x.name.en, x.name.de]);
    expect(names.filter(n => /[\r\n]|^\s|\s$/.test(n))).toEqual([]);
  });

  it('has the standard iron plate recipe and alternates', () => {
    const plate = data.recipes.find(r => r.id === 'Recipe_IronPlate_C');
    expect(plate).toMatchObject({ machine: 'Build_ConstructorMk1_C', duration: 6, ingredients: [{ item: 'Desc_IronIngot_C', amount: 3 }], products: [{ item: 'Desc_IronPlate_C', amount: 2 }] });
    expect(data.recipes.filter(r => r.alternate).length).toBeGreaterThan(50);
  });
});
