import { useTranslation } from 'react-i18next';
import type { PlanStep, Purity } from '../../../shared/planner.js';
import type { RecipeIndex } from '../../../shared/recipes.js';
import { GameIcon } from '../machineWiki/icons.js';
import { powerText } from './controls.js';
import { formatRate, itemName, type Lang } from './format.js';
import { StepBadges, stepPicture } from './pictures.js';
import { stepText } from './stepText.js';

export interface StepListProps {
  steps: readonly PlanStep[];
  index: RecipeIndex;
  lang: Lang;
  /** The step whose panel is open. */
  selected: string | null;
  onSelect(item: string): void;
  /** The panel's id (aria-controls of the selected row's button). */
  editorId: string;
  /** The element id of an item's button, so focus can come back to it. */
  nodeId(item: string): string;
  /** The node purity of the settings: a row shows its purity only when it differs. */
  defaultPurity: Purity;
}

const HEAD = 'py-2 font-display text-xs font-semibold tracking-wider text-muted uppercase';

/**
 * The plan's steps as a table, one row per step (wanted items first, extraction last): the item with its badges and
 * its inputs as small chips, the rate, "4× Constructor" and the power. On a phone the buildings go under the rate and
 * the power is left out, so the item keeps its room. A row opens the same step panel as a node of the diagram; the
 * item's name is the row's button, for the keyboard.
 */
export function StepList({ steps, index, lang, selected, onSelect, editorId, nodeId, defaultPurity }: StepListProps) {
  const { t } = useTranslation();
  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="border-b border-line text-left">
          <th scope="col" className={`${HEAD} pr-2 pl-3`}>{t('planner.list.item')}</th>
          <th scope="col" className={`${HEAD} px-2 text-right`}>{t('planner.list.rate')}</th>
          <th scope="col" className={`${HEAD} hidden px-2 sm:table-cell`}>{t('planner.buildings')}</th>
          <th scope="col" className={`${HEAD} hidden pr-3 pl-2 text-right md:table-cell`}>{t('planner.totalPower')}</th>
        </tr>
      </thead>
      <tbody>
        {steps.map(step => {
          const text = stepText(step, index, lang, t, defaultPurity);
          const isSelected = selected === step.item;
          const inputs = step.inputs.filter(f => f.rate > 1e-9);
          const picture = stepPicture(step);
          const built = step.choice.kind !== 'external' && step.machines > 1e-9;
          const badges = text.wanted !== undefined || text.loop !== undefined || text.badges.length > 0;
          return (
            // The row is the pointer target; its button (bubbling its click) the keyboard's.
            <tr
              key={step.item}
              onClick={() => onSelect(step.item)}
              className={`cursor-pointer border-b border-line align-top last:border-b-0 motion-safe:transition-colors ${isSelected ? 'bg-raised' : 'hover:bg-raised'}`}
            >
              <th scope="row" className={`border-l-2 py-2 pr-2 pl-2.5 text-left font-normal ${isSelected ? 'border-l-accent' : 'border-l-transparent'}`}>
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <button
                    id={nodeId(step.item)}
                    type="button"
                    aria-expanded={isSelected}
                    aria-controls={isSelected ? editorId : undefined}
                    className="flex min-w-0 items-center gap-2 text-left font-semibold text-fg focus-ring"
                  >
                    <GameIcon cls={step.item} px={24} placeholder />
                    <span className="break-words">{text.name}</span>
                  </button>
                  {badges && <span className="flex flex-wrap gap-1"><StepBadges text={text} /></span>}
                </span>
                {inputs.length > 0 && (
                  <ul aria-label={t('planner.panel.input')} className="mt-1 flex flex-wrap gap-1 pl-8">
                    {inputs.map(f => {
                      const name = itemName(index, f.item, lang);
                      return (
                        <li key={f.item} title={name} className="relative inline-flex h-6 items-center gap-1 chamfer border border-line bg-bg px-1.5 text-xs text-muted tabular-nums">
                          <GameIcon cls={f.item} px={16} />
                          <span className="sr-only">{name}: </span>
                          {formatRate(index, f.item, f.rate, lang, t)}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </th>
              <td className="px-2 py-2 text-right">
                <span className="block font-display text-base leading-6 font-semibold whitespace-nowrap tabular-nums">{text.amount}</span>
                <span className="block text-xs text-muted sm:hidden" title={text.exact}>{text.made}</span>
              </td>
              <td className="hidden px-2 py-2 sm:table-cell">
                <span className={`flex items-center gap-1.5 leading-6 ${built ? '' : 'text-muted'}`} title={text.exact}>
                  {built && <GameIcon cls={picture.cls} px={20} />}
                  <span className="break-words">{text.made}</span>
                </span>
              </td>
              <td className="hidden py-2 pr-3 pl-2 text-right leading-6 whitespace-nowrap text-muted tabular-nums md:table-cell">
                {built ? powerText(step.power, lang, t) : '–'}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
