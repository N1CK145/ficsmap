import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import type { Item, PodRequirement } from '../../../../shared/dataset.js';
import { detectLocale } from '../../../../shared/i18n.js';
import type { Locale } from '../../../../shared/types.js';
import type { WorldCtx } from '../../../app/feature.js';
import { Panel } from '../../../components/Panel.js';

/** "5× Motor · 20 MW", leaving out what is not needed; "Nothing needed" when nothing is. */
export function requirementText(pod: PodRequirement, t: TFunction, locale: Locale): string {
  const parts: string[] = [];
  if (pod.item && pod.amount > 0) parts.push(t('item.toOpen.items', { amount: pod.amount, item: pod.item[locale] }));
  if (pod.power > 0) parts.push(t('item.toOpen.power', { power: pod.power }));
  return parts.length > 0 ? parts.join(' · ') : t('item.toOpen.nothing');
}

/** Drop pods: what it takes to open one (spec §10.2, §11), from the dataset. */
export function ToOpen({ item, ctx }: { item: Item; ctx: WorldCtx }) {
  const { t, i18n } = useTranslation();
  const pod = item.extra?.pod;
  const text = !ctx.index.ds.podRequirementsKnown
    ? t('item.toOpen.varies')
    : pod ? requirementText(pod, t, detectLocale([i18n.language])) : t('item.toOpen.noData');
  return <Panel title={t('item.toOpen.title')}><p>{text}</p></Panel>;
}
