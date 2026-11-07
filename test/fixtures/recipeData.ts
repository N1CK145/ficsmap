import type { GameRecipe, ItemForm, RecipeData } from '../../src/shared/recipes.js';

// Made-up test data in the shape of recipes.json (not the game's numbers).
const item = (id: string, form: ItemForm = 'solid') => ({ id, name: { en: id, de: `${id}-de` }, form });
const recipe = (id: string, machine: string, duration: number, ingredients: [string, number][], products: [string, number][], extra: Partial<GameRecipe> = {}): GameRecipe => ({
  id, name: { en: id, de: id }, alternate: false, machine, duration,
  ingredients: ingredients.map(([i, amount]) => ({ item: i, amount })),
  products: products.map(([i, amount]) => ({ item: i, amount })), ...extra,
});
export const EXP = 1.321929;
export const RECIPE_DATA: RecipeData = {
  format: 1, source: 'test',
  clock: { min: 0.01, perShard: 0.5 },
  items: [
    item('ore'), item('water', 'liquid'), item('oil', 'liquid'), item('gas', 'gas'), item('ingot'), item('plate'),
    item('plastic'), item('rubber'), item('fuel', 'liquid'), item('residue', 'liquid'), item('leaves'), item('biomass'),
    item('glow'), item('a'), item('b'), item('c'), item('d'), item('pfuel'),
  ],
  recipes: [
    recipe('R_Ingot', 'smelter', 2, [['ore', 1]], [['ingot', 1]]),
    recipe('R_Plate', 'constructor', 6, [['ingot', 3]], [['plate', 2]]),
    recipe('R_PlateAlt', 'assembler', 12, [['ingot', 2], ['water', 1]], [['plate', 3]], { alternate: true }),
    recipe('R_Plastic', 'refinery', 6, [['oil', 3]], [['plastic', 2], ['residue', 1]]),
    recipe('R_Fuel', 'refinery', 6, [['oil', 6]], [['fuel', 4]]),
    recipe('R_RecRubber', 'refinery', 6, [['plastic', 6], ['fuel', 6]], [['rubber', 12]], { alternate: true }),
    recipe('R_RecPlastic', 'refinery', 6, [['rubber', 6], ['fuel', 6]], [['plastic', 12]], { alternate: true }),
    recipe('R_Biomass', 'constructor', 4, [['leaves', 10]], [['biomass', 5]]),
    recipe('R_Glow', 'collider', 60, [['ingot', 10]], [['glow', 1]], { power: { min: 250, max: 750 } }),
    recipe('R_AfromB', 'constructor', 60, [['b', 1]], [['a', 1]]),
    recipe('R_BfromA', 'constructor', 60, [['a', 1]], [['b', 1]]),
    recipe('R_CfromD', 'constructor', 60, [['d', 2]], [['c', 1]]),
    recipe('R_DfromC', 'constructor', 60, [['c', 1]], [['d', 1]]),
    recipe('R_ResidueAlt', 'refinery', 6, [['oil', 4]], [['residue', 2]], { alternate: true }),
    recipe('R_ResFuel', 'refinery', 6, [['residue', 6]], [['fuel', 4]], { alternate: true }),
    recipe('R_PackFuel', 'packager', 2, [['fuel', 2]], [['pfuel', 2]]),
    recipe('R_Unpack', 'packager', 2, [['pfuel', 2]], [['fuel', 2]]),
  ],
  machines: [
    { id: 'smelter', name: { en: 'Smelter', de: 'Schmelzofen' }, power: 4, powerExponent: EXP },
    { id: 'constructor', name: { en: 'Constructor', de: 'Konstruktor' }, power: 4, powerExponent: EXP },
    { id: 'assembler', name: { en: 'Assembler', de: 'Fabrikator' }, power: 15, powerExponent: EXP },
    { id: 'refinery', name: { en: 'Refinery', de: 'Raffinerie' }, power: 30, powerExponent: EXP },
    { id: 'packager', name: { en: 'Packager', de: 'Abfüllanlage' }, power: 10, powerExponent: EXP },
    { id: 'collider', name: { en: 'Collider', de: 'Beschleuniger' }, power: 0, powerExponent: EXP },
  ],
  extractors: [
    { id: 'mk2', name: { en: 'Miner Mk.2', de: 'Miner Mk.2' }, kind: 'miner', tier: 2, rate: 120, power: 15, powerExponent: EXP, resources: ['ore'], onNode: true },
    { id: 'mk1', name: { en: 'Miner Mk.1', de: 'Miner Mk.1' }, kind: 'miner', tier: 1, rate: 60, power: 5, powerExponent: EXP, resources: ['ore'], onNode: true },
    { id: 'well', name: { en: 'Well', de: 'Quelle' }, kind: 'well', rate: 60, power: 0, powerExponent: EXP, resources: ['oil', 'water', 'gas'], onNode: true },
    { id: 'pump', name: { en: 'Water Extractor', de: 'Wasserextraktor' }, kind: 'pump', rate: 120, power: 20, powerExponent: EXP, resources: ['water'], onNode: false },
    { id: 'oilpump', name: { en: 'Oil Extractor', de: 'Ölpumpe' }, kind: 'pump', rate: 120, power: 40, powerExponent: EXP, resources: ['oil'], onNode: true },
  ],
  wellPressurizer: { id: 'press', name: { en: 'Pressurizer', de: 'Kompressor' }, power: 150, powerExponent: EXP },
};
