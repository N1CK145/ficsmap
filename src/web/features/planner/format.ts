import type { TFunction } from 'i18next';
import { isFluid, type Names, type RecipeIndex } from '../../../shared/recipes.js';

export type Lang = keyof Names;

/** The UI language as a key of `Names` (German for `de*`, else English). */
export const langOf = (language: string | undefined): Lang => (language?.startsWith('de') ? 'de' : 'en');

export function formatNumber(n: number, lang: Lang, digits = 2): string {
  return new Intl.NumberFormat(lang, { maximumFractionDigits: digits }).format(Math.abs(n) < 1e-9 ? 0 : n);
}

export function itemName(index: RecipeIndex, item: string, lang: Lang): string {
  return index.items.get(item)?.name[lang] ?? item;
}

/** "45/min" for solids, "45 m³/min" for fluids. */
export function formatRate(index: RecipeIndex, item: string, rate: number, lang: Lang, t: TFunction): string {
  const value = formatNumber(rate, lang);
  return isFluid(index.items.get(item)) ? t('planner.unit.fluid', { value }) : t('planner.unit.solid', { value });
}

/** Normalises for matching: lower case, no accents. */
export const fold = (s: string): string => s.toLocaleLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
