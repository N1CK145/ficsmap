import { useTranslation } from 'react-i18next';
import { tierShort, transportTier } from '../../../shared/plannerTransport.js';
import type { RecipeIndex } from '../../../shared/recipes.js';
import type { Lang } from './format.js';

/** A flow's belt or pipeline tier as text: `short` ("Mk.2", "2× Mk.6") and `long` ("Needs Conveyor Belt Mk.2"). */
export interface TransportText { short: string; long: string }

/** The belt or pipeline tier a flow of the plan needs (`transportTier`), as text; undefined without belt and pipe data. */
export function useTransportText(index: RecipeIndex, lang: Lang): (item: string, rate: number) => TransportText | undefined {
  const { t } = useTranslation();
  return (item, rate) => {
    const tier = transportTier(index, item, rate);
    if (!tier) return undefined;
    const name = tier.name[lang];
    const times = (text: string) => (tier.lines > 1 ? t('planner.transport.lines', { count: tier.lines, tier: text }) : text);
    return { short: times(tierShort(name)), long: t('planner.transport.needs', { tier: times(name) }) };
  };
}

/** The short tier after a rate, its full name as tooltip and for screen readers. */
export function TransportMark({ text, className = '' }: { text: TransportText | undefined; className?: string }) {
  if (!text) return null;
  return (
    <span title={text.long} className={`text-muted ${className}`}>
      <span aria-hidden="true">{text.short}</span>
      <span className="sr-only">{text.long}</span>
    </span>
  );
}
