import { alternateGroups, countAlternateChoices, matchAlternateGroup } from '../../src/shared/plannerRecipes.js';
import { indexRecipes } from '../../src/shared/recipes.js';
import { RECIPE_DATA } from '../fixtures/recipeData.js';

const IDX = indexRecipes(RECIPE_DATA);

describe('planner alternate recipes', () => {
  it('lists every item that an alternate makes as its main product, with its standard and alternate recipes', () => {
    const groups = alternateGroups(IDX, 'en');
    expect(groups.map(g => g.item)).toEqual(['fuel', 'plastic', 'plate', 'residue', 'rubber']);
    const plate = groups.find(g => g.item === 'plate')!;
    expect(plate.standard.map(r => r.id)).toEqual(['R_Plate']);
    expect(plate.alternates.map(r => r.id)).toEqual(['R_PlateAlt']);
    // Rubber has no standard recipe in the data; Residue is a by-product of Plastic, which is no standard recipe for it.
    expect(groups.find(g => g.item === 'rubber')!.standard).toEqual([]);
    expect(groups.find(g => g.item === 'residue')!.standard).toEqual([]);
  });

  it('covers every alternate of the data exactly once', () => {
    const ids = alternateGroups(IDX, 'en').flatMap(g => g.alternates.map(r => r.id)).sort();
    expect(ids).toEqual(RECIPE_DATA.recipes.filter(r => r.alternate).map(r => r.id).sort());
  });

  it('sorts by the item name in the given language', () => {
    const idx = indexRecipes({ ...RECIPE_DATA, items: RECIPE_DATA.items.map(i => (i.id === 'rubber' ? { ...i, name: { en: 'rubber', de: 'A-Gummi' } } : i)) });
    expect(alternateGroups(idx, 'de')[0]!.item).toBe('rubber');
  });

  it('counts the choices that pick an alternate recipe', () => {
    expect(countAlternateChoices(IDX, {})).toBe(0);
    expect(countAlternateChoices(IDX, {
      plate: { kind: 'recipe', recipe: 'R_PlateAlt' },
      ingot: { kind: 'recipe', recipe: 'R_Ingot' },
      ore: { kind: 'external' },
      fuel: { kind: 'recipe', recipe: 'R_ResFuel' },
      gone: { kind: 'recipe', recipe: 'R_Missing' },
    })).toBe(2);
  });

  it('matches a group by item or recipe name in either language, ignoring case and accents', () => {
    const plate = alternateGroups(IDX, 'en').find(g => g.item === 'plate')!;
    expect(matchAlternateGroup(IDX, plate, '')).toBe(true);
    expect(matchAlternateGroup(IDX, plate, 'PLATE')).toBe(true);
    expect(matchAlternateGroup(IDX, plate, 'plate-de')).toBe(true);
    expect(matchAlternateGroup(IDX, plate, 'platealt')).toBe(true);
    expect(matchAlternateGroup(IDX, plate, 'rubber')).toBe(false);
    const idx = indexRecipes({ ...RECIPE_DATA, items: RECIPE_DATA.items.map(i => (i.id === 'plate' ? { ...i, name: { en: 'Plate', de: 'Eisenplätte' } } : i)) });
    expect(matchAlternateGroup(idx, alternateGroups(idx, 'de').find(g => g.item === 'plate')!, 'eisenplatte')).toBe(true);
  });
});
