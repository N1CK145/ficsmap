import { useId } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { choiceKey, choiceOptions, defaultChoice, offeredChoice, parseChoiceKey, PURITY_FACTOR, type Choice, type PlanStep, type Purity } from '../../../shared/planner.js';
import type { RecipeIndex } from '../../../shared/recipes.js';
import { FIELD_LABEL, fieldClass } from '../../components/Field.js';
import { formatNumber, type Lang } from './format.js';
import { usePlanner } from './usePlanner.js';

/** Parts shared by the planner's views and the step panel (`StepPanel`). */

/** Impure / Normal / Pure (the game's words; the factors are in the extractor settings' hint), for a SegmentedControl or a select. */
export function usePurityOptions(): { value: Purity; label: string }[] {
  const { t } = useTranslation();
  return (Object.keys(PURITY_FACTOR) as Purity[]).map(p => ({ value: p, label: t(`planner.purityOption.${p}`) }));
}

/** The name of a choice in the "Made by" list: the extractor, the recipe with its building, or "Supplied from outside". */
export function useChoiceLabel(index: RecipeIndex, lang: Lang, item: string) {
  const { t } = useTranslation();
  return (c: Choice): string => {
    if (c.kind === 'external') return t('planner.option.external');
    if (c.kind === 'extract') return c.extractor ? index.extractors.get(c.extractor)?.name[lang] ?? c.extractor : '';
    const r = index.recipes.get(c.recipe);
    if (!r) return c.recipe;
    const args = { recipe: r.name[lang], machine: index.machines.get(r.machine)?.name[lang] ?? r.machine };
    return r.products[0]?.item === item ? t('planner.option.recipe', args) : t('planner.option.byproduct', args);
  };
}

/**
 * "Made by" and the list of the item's extractors (each miner on its own), recipes and "supplied from outside". A step
 * that follows the miner setting shows that miner; picking the default (the setting's miner for a solid resource)
 * drops the choice, so the step follows the setting again.
 */
export function ChoiceSelect({ item, choice, index, lang, minerId, label: name, className = '' }: {
  item: string; choice: Choice; index: RecipeIndex; lang: Lang; minerId: string;
  /** Accessible name instead of the visible "Made by" (for a list of items). */
  label?: string;
  className?: string;
}) {
  const { t } = useTranslation();
  const setChoice = usePlanner(s => s.setChoice);
  const id = useId();
  const label = useChoiceLabel(index, lang, item);
  const settings = { miner: minerId };
  const current = choiceKey(offeredChoice(index, item, choice, settings));
  const offered = choiceOptions(index, item);
  const options = offered.some(o => choiceKey(o) === current) ? offered : [choice, ...offered];

  function onChoose(key: string) {
    const c = parseChoiceKey(key);
    if (!c) return;
    const isDefault = choiceKey(c) === choiceKey(offeredChoice(index, item, defaultChoice(index, item), settings));
    setChoice(item, isDefault ? null : c);
  }

  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      <label htmlFor={id} className={name ? 'sr-only' : FIELD_LABEL}>{name ?? t('planner.howMade')}</label>
      <select id={id} value={current} onChange={e => onChoose(e.target.value)} className={fieldClass({}, 'min-w-0 max-w-full flex-1 basis-48 text-sm')}>
        {options.map(o => <option key={choiceKey(o)} value={choiceKey(o)}>{label(o)}</option>)}
      </select>
    </div>
  );
}

export function powerText(p: { min: number; max: number }, lang: Lang, t: TFunction): string {
  return Math.abs(p.max - p.min) < 1e-9
    ? t('planner.power', { value: formatNumber(p.min, lang, 1) })
    : t('planner.powerRange', { min: formatNumber(p.min, lang, 1), max: formatNumber(p.max, lang, 1) });
}

/** The power as a number (or range) without its unit, for a figure whose unit is shown apart. */
export function powerValue(p: { min: number; max: number }, lang: Lang): string {
  return Math.abs(p.max - p.min) < 1e-9 ? formatNumber(p.min, lang, 1) : `${formatNumber(p.min, lang, 1)}–${formatNumber(p.max, lang, 1)}`;
}

/** The step's building name in the UI language: the recipe's machine or the extractor; undefined for an external item. */
export function buildingName(step: PlanStep, index: RecipeIndex, lang: Lang): string | undefined {
  return step.recipe ? index.machines.get(step.recipe.machine)?.name[lang] : step.extractor?.name[lang];
}
