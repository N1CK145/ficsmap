import type { Choice } from './planner.js';
import type { GameRecipe, Names, RecipeIndex } from './recipes.js';

/**
 * The planner's overview of alternate recipes: every item an alternate makes as its main product, with the standard
 * recipes it competes with. Pure; the choice itself is the planner's per item choice (`PlanInput.choices`).
 */

export interface AlternateGroup {
  item: string;
  /** Standard recipes with the item as main product (none for items only alternates make, e.g. Recycled Rubber). */
  standard: GameRecipe[];
  /** Alternates with the item as main product, in the order of `RecipeIndex.producers`. */
  alternates: GameRecipe[];
}

/** Every item that is the main product of an alternate recipe, by its name in `lang`. */
export function alternateGroups(index: RecipeIndex, lang: keyof Names): AlternateGroup[] {
  const groups: AlternateGroup[] = [];
  for (const [item, recipes] of index.producers) {
    const main = recipes.filter(r => r.products[0]?.item === item);
    const alternates = main.filter(r => r.alternate);
    if (alternates.length === 0) continue;
    groups.push({ item, standard: main.filter(r => !r.alternate), alternates });
  }
  const name = (id: string) => index.items.get(id)?.name[lang] ?? id;
  return groups.sort((a, b) => name(a.item).localeCompare(name(b.item), lang));
}

/** How many of the choices pick an alternate recipe. */
export function countAlternateChoices(index: RecipeIndex, choices: Readonly<Record<string, Choice>>): number {
  return Object.values(choices).filter(c => c.kind === 'recipe' && index.recipes.get(c.recipe)?.alternate === true).length;
}

const fold = (s: string): string => s.toLocaleLowerCase().normalize('NFD').replace(/\p{M}/gu, '');

/** Whether every word of `query` is in the item's or one of its recipes' names (English or German; case and accents ignored). */
export function matchAlternateGroup(index: RecipeIndex, group: AlternateGroup, query: string): boolean {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const names = [index.items.get(group.item)?.name, ...group.standard.map(r => r.name), ...group.alternates.map(r => r.name)]
    .flatMap(n => (n ? [fold(n.en), fold(n.de)] : []));
  return words.every(w => names.some(n => n.includes(w)));
}
