import { useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { defaultChoice } from '../../../shared/planner.js';
import { alternateGroups, countAlternateChoices, matchAlternateGroup, type AlternateGroup } from '../../../shared/plannerRecipes.js';
import type { RecipeIndex } from '../../../shared/recipes.js';
import { Badge } from '../../components/Badge.js';
import { fieldClass } from '../../components/Field.js';
import { Fold } from '../../components/Fold.js';
import { SectionHeading } from '../../components/SectionHeading.js';
import { GameIcon } from '../machineWiki/icons.js';
import { ChoiceSelect } from './controls.js';
import { itemName, type Lang } from './format.js';
import { usePlanner } from './usePlanner.js';

/**
 * "Alternate recipes", folded away under how many are chosen: every item an alternate recipe makes, with its recipe
 * picker (the same choice as in the step panel, so it applies wherever the item is in the plan and is remembered).
 * The items of the current plan come first; a filter finds items and recipes by name in either language.
 */
export function AlternateRecipes({ index, lang, minerId, planItems, className = '' }: {
  index: RecipeIndex; lang: Lang; minerId: string; planItems: readonly string[]; className?: string;
}) {
  const { t } = useTranslation();
  const choices = usePlanner(s => s.choices);
  const [query, setQuery] = useState('');
  const searchId = useId();
  const groups = useMemo(() => alternateGroups(index, lang), [index, lang]);
  if (groups.length === 0) return null;
  const total = groups.reduce((sum, g) => sum + g.alternates.length, 0);
  const chosen = countAlternateChoices(index, choices);
  const shown = groups.filter(g => matchAlternateGroup(index, g, query));
  const inPlan = new Set(planItems);
  const row = (g: AlternateGroup) => {
    const choice = choices[g.item] ?? defaultChoice(index, g.item);
    const alt = choice.kind === 'recipe' && index.recipes.get(choice.recipe)?.alternate === true;
    const name = itemName(index, g.item, lang);
    return (
      <li key={g.item} className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="flex min-w-0 basis-40 items-center gap-2">
          <GameIcon cls={g.item} px={24} placeholder />
          <span className="min-w-0 truncate text-sm">{name}</span>
          {alt && <Badge tone="accent">{t('planner.diagram.alt')}</Badge>}
        </span>
        <ChoiceSelect item={g.item} choice={choice} index={index} lang={lang} minerId={minerId} label={t('planner.alternates.recipeFor', { item: name })} className="min-w-0 flex-1 basis-56" />
      </li>
    );
  };
  const list = (title: string, items: AlternateGroup[]) => items.length > 0 && (
    <section className="flex flex-col gap-1">
      <SectionHeading as="h4">{title}</SectionHeading>
      <ul className="flex flex-col gap-2">{items.map(row)}</ul>
    </section>
  );
  return (
    <Fold
      title={t('planner.alternates.title')}
      summary={chosen > 0 ? t('planner.alternates.chosen', { count: chosen }) : t('planner.alternates.available', { count: total })}
      lazy className={className} summaryClassName="px-3 py-1" bodyClassName="flex flex-col gap-3 px-3 pt-1 pb-3"
    >
      <p className="text-xs text-muted">{t('planner.alternates.hint')}</p>
      <label htmlFor={searchId} className="sr-only">{t('planner.alternates.filter')}</label>
      <input
        id={searchId} type="search" value={query} onChange={e => setQuery(e.target.value)} autoComplete="off"
        placeholder={t('planner.alternates.filterPlaceholder')} className={fieldClass({ size: 'sm' }, 'w-full')}
      />
      {list(t('planner.alternates.inPlan'), shown.filter(g => inPlan.has(g.item)))}
      {list(inPlan.size > 0 ? t('planner.alternates.others') : t('planner.alternates.all'), shown.filter(g => !inPlan.has(g.item)))}
      {shown.length === 0 && <p className="text-sm text-muted">{t('planner.alternates.noMatch')}</p>}
    </Fold>
  );
}
