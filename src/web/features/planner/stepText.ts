import type { TFunction } from 'i18next';
import type { PlanStep, Purity } from '../../../shared/planner.js';
import type { RecipeIndex } from '../../../shared/recipes.js';
import type { BadgeTone } from '../../components/Badge.js';
import { buildingName } from './controls.js';
import { formatNumber, formatRate, itemName, type Lang } from './format.js';

/** "Alternate: Cast Screw" -> "Cast Screw"; the badge says it is an alternate. */
export const ALT_PREFIX = /^[^:]{1,16}:\s+/;

/** A compact badge of a step; `long` is its title and goes into the step's accessible name (`parts`, or `long`). */
export interface StepBadge { text: string; shards?: number; long: string; parts?: string[]; tone: BadgeTone }

export interface StepText {
  /** The item. */
  name: string;
  /** "4× Constructor", "Supplied from outside" or "From by-products". */
  made: string;
  /** "exact 3.5" when the count is rounded up. */
  exact?: string;
  /** The rate of the item (from by-products, for a covered step). */
  amount: string;
  /** A third line: the by-products, or why it is supplied from outside. */
  third?: string;
  /** Wanted rate, for the "Wanted" badge. */
  wanted?: string;
  /** Loop badge. */
  loop?: { text: string; long: string };
  badges: StepBadge[];
  /** Everything above as one sentence (the accessible name of a node). */
  label: string;
}

/**
 * What the diagram's node and the list's row say about a step: shown as text and badges, and as one sentence for the
 * accessible name. `defaultPurity` is the settings' one: only a purity that differs gets a badge.
 */
export function stepText(step: PlanStep, index: RecipeIndex, lang: Lang, t: TFunction, defaultPurity: Purity): StepText {
  const name = itemName(index, step.item, lang);
  const rate = (item: string, value: number) => formatRate(index, item, value, lang, t);
  const external = step.choice.kind === 'external';
  const covered = !external && step.machines < 1e-9;
  const exact = !external && !covered && Math.abs(step.machines - step.machinesCeil) > 1e-6
    ? t('planner.exact', { value: formatNumber(step.machines, lang, 3) }) : undefined;
  let made: string;
  if (external) made = t('planner.option.external');
  else if (covered) made = t('planner.diagram.covered');
  else made = t('planner.diagram.machines', { count: step.machinesCeil, name: buildingName(step, index, lang) ?? '' });
  const amount = rate(step.item, covered ? step.fromByproducts : step.rate);
  const byproducts = step.byproducts.filter(f => f.rate > 1e-9).map(f => ({ name: itemName(index, f.item, lang), amount: rate(f.item, f.rate) }));

  // The recipe (its name goes into the accessible name; an alternate gets a badge), or why it is supplied from outside.
  let how: { text: string; long: string; alt: boolean } | undefined;
  if (step.recipe) {
    const full = step.recipe.name[lang];
    const alt = step.recipe.alternate;
    const text = alt ? full.replace(ALT_PREFIX, '') : full;
    how = { text, long: alt ? t('planner.diagram.alternate', { recipe: text }) : full, alt };
  } else if (step.auto === 'loop') {
    how = { text: t('planner.diagram.autoLoop'), long: t('planner.autoLoop'), alt: false };
  }

  const badges: StepBadge[] = [];
  if (how?.alt) badges.push({ text: t('planner.diagram.alt'), long: how.long, parts: [], tone: 'accent' });
  if (step.purity && step.purity !== defaultPurity) {
    const text = t(`planner.purityOption.${step.purity}`);
    badges.push({ text, long: `${t('planner.panel.purity')}: ${text}`, tone: 'neutral' });
  }
  const clock = step.clock * 100;
  if (!external && (Math.abs(clock - 100) > 1e-6 || step.shards > 0)) {
    const parts = [t('planner.diagram.clockLong', { value: clock })];
    if (step.shards > 0) {
      const pressurizer = step.pressurizer ? index.data.wellPressurizer?.name[lang] : undefined;
      parts.push(pressurizer ? t('planner.shardsPressurizer', { count: step.shards, name: pressurizer }) : t('planner.shards', { count: step.shards }));
    }
    badges.push({ text: t('planner.diagram.clock', { value: clock }), shards: step.shards, long: parts.join(' · '), parts, tone: 'neutral' });
  }
  if (!covered && step.fromByproducts > 1e-9) {
    badges.push({ text: t('planner.diagram.byproducts'), long: t('planner.fromByproducts', { value: rate(step.item, step.fromByproducts) }), tone: 'success' });
  }

  const loop = step.cycle ? { text: t('planner.cycle'), long: t('planner.cycleHint') } : undefined;
  const third = step.auto === 'loop' ? how?.text : byproducts.map(b => `+ ${b.name} · ${b.amount}`).join(', ') || undefined;
  const wanted = step.targetRate > 0 ? rate(step.item, step.targetRate) : undefined;

  const needs = step.inputs.filter(f => f.rate > 1e-9).map(f => `${rate(f.item, f.rate)} ${itemName(index, f.item, lang)}`);
  const label = [
    wanted ? `${name} (${t('planner.diagram.wanted', { value: wanted })})` : name,
    exact ? `${made} (${exact})` : made,
    external || covered ? amount : t('planner.diagram.makes', { value: amount }),
    byproducts.length > 0 ? `${t('planner.byproducts')}: ${byproducts.map(b => `${b.amount} ${b.name}`).join(', ')}` : undefined,
    how?.long,
    loop?.long,
    ...badges.flatMap(b => b.parts ?? [b.long]),
    needs.length > 0 ? t('planner.diagram.needs', { list: needs.join(', ') }) : undefined,
  ].filter(Boolean).join('; ');
  return { name, made, exact, amount, third, wanted, loop, badges, label };
}
