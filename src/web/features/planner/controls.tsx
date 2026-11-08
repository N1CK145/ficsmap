import { useId } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { choiceKey, choiceOptions, defaultChoice, parseChoiceKey, PURITY_FACTOR, type Choice, type Flow, type PlanStep, type Purity } from '../../../shared/planner.js';
import type { RecipeIndex } from '../../../shared/recipes.js';
import { FIELD_LABEL, fieldClass } from '../../components/Field.js';
import { formatNumber, formatRate, itemName, type Lang } from './format.js';
import { usePlanner } from './usePlanner.js';

/** Parts shared by the step list (`StepRow`) and the diagram's step panel (`StepPanel`). */

/** Impure / Normal / Pure with their factor, for a SegmentedControl or a select. */
export function usePurityOptions(): { value: Purity; label: string }[] {
  const { t } = useTranslation();
  return (Object.keys(PURITY_FACTOR) as Purity[]).map(p => ({ value: p, label: t(`planner.purityOption.${p}`, { factor: PURITY_FACTOR[p] }) }));
}

/** The name of a choice in the "Made by" list. */
export function useChoiceLabel(index: RecipeIndex, lang: Lang, item: string, minerId: string) {
  const { t } = useTranslation();
  return (c: Choice): string => {
    if (c.kind === 'external') return t('planner.option.external');
    if (c.kind === 'extract') {
      if (!c.extractor) return t('planner.option.miner', { name: index.extractors.get(minerId)?.name[lang] ?? '' });
      return index.extractors.get(c.extractor)?.name[lang] ?? c.extractor;
    }
    const r = index.recipes.get(c.recipe);
    if (!r) return c.recipe;
    const args = { recipe: r.name[lang], machine: index.machines.get(r.machine)?.name[lang] ?? r.machine };
    return r.products[0]?.item === item ? t('planner.option.recipe', args) : t('planner.option.byproduct', args);
  };
}

/** "Made by" and the list of the item's recipes, extractors and "supplied from outside". Picking the default drops the choice. */
export function ChoiceSelect({ step, index, lang, minerId, className = '' }: { step: PlanStep; index: RecipeIndex; lang: Lang; minerId: string; className?: string }) {
  const { t } = useTranslation();
  const setChoice = usePlanner(s => s.setChoice);
  const id = useId();
  const label = useChoiceLabel(index, lang, step.item, minerId);
  const current = choiceKey(step.choice);
  const offered = choiceOptions(index, step.item);
  const options = offered.some(o => choiceKey(o) === current) ? offered : [step.choice, ...offered];

  function onChoose(key: string) {
    const c = parseChoiceKey(key);
    if (!c) return;
    setChoice(step.item, choiceKey(c) === choiceKey(defaultChoice(index, step.item)) ? null : c);
  }

  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      <label htmlFor={id} className={FIELD_LABEL}>{t('planner.howMade')}</label>
      <select id={id} value={current} onChange={e => onChoose(e.target.value)} className={fieldClass({}, 'min-w-0 max-w-full flex-1 basis-48 text-sm')}>
        {options.map(o => <option key={choiceKey(o)} value={choiceKey(o)}>{label(o)}</option>)}
      </select>
    </div>
  );
}

export function flows(index: RecipeIndex, list: readonly Flow[], lang: Lang, t: TFunction): string {
  return list.map(f => `${formatRate(index, f.item, f.rate, lang, t)} ${itemName(index, f.item, lang)}`).join(', ');
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
