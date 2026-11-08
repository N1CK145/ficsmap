import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { nodeRates, placedRate, purityRates, type NodeRate } from '../../../shared/nodeRates.js';
import { isFluid, type GameExtractor, type RecipeIndex } from '../../../shared/recipes.js';
import type { ExtractorInfo, Purity, ResourceNode } from '../../../shared/resourceNodes.js';
import { formatNumber, langOf } from '../planner/format.js';

/**
 * The extraction rates of resource nodes as text, from the dataset's `recipes.json` (`index`; without it every
 * function returns null and nothing is shown). Solids per minute, fluids in m³ per minute.
 */
export interface RateTexts {
  /** At the node's purity and 100 %: "120/min (Mk.1) · 240 (Mk.2) · 480 (Mk.3)", "240 m³/min (Oil Extractor)". */
  node(node: Pick<ResourceNode, 'kind' | 'resource' | 'purity'>): string | null;
  /** What an extractor from the save import gets out of the node: "Extracts 360/min". */
  placed(node: Pick<ResourceNode, 'kind' | 'resource' | 'purity'>, e: ExtractorInfo, pressurizerClock: number | null): string | null;
  /** The miners' range on a node of this purity at 100 % ("30–120/min") and every on-node extractor's rate as a hint. */
  purity(purity: Purity): { range: string; hint: string } | null;
}

export function useRateTexts(index: RecipeIndex | null | undefined): RateTexts {
  const { t, i18n } = useTranslation();
  const lang = langOf(i18n.language);
  const unit = useCallback((resource: string, value: string) =>
    t(isFluid(index?.items.get(resource)) ? 'planner.unit.fluid' : 'planner.unit.solid', { value }), [t, index]);
  const short = useCallback((e: GameExtractor) =>
    (e.kind === 'miner' && e.tier !== undefined ? t(`resourceNodes.extractorShort.miner${e.tier}`) : e.name[lang]), [t, lang]);
  const percent = useMemo(() => new Intl.NumberFormat(lang, { style: 'percent', maximumFractionDigits: 4 }), [lang]);

  return useMemo((): RateTexts => ({
    node: node => {
      if (!index) return null;
      const rates: NodeRate[] = nodeRates(node, index);
      if (rates.length === 0) return null;
      // The unit once, on the first entry: all extract the node's resource.
      return rates.map((r, i) => t('resourceNodes.rateEntry', {
        rate: i === 0 ? unit(node.resource, formatNumber(r.rate, lang)) : formatNumber(r.rate, lang),
        name: short(r.extractor),
      })).join(' · ');
    },
    placed: (node, e, pressurizerClock) => {
      const p = index ? placedRate(node, e, index, pressurizerClock) : null;
      if (!p) return null;
      const rate = unit(node.resource, formatNumber(p.rate, lang));
      return e.kind === 'well'
        ? t('resourceNodes.extractsWell', { rate, clock: percent.format(p.clock) })
        : t('resourceNodes.extracts', { rate });
    },
    purity: purity => {
      if (!index) return null;
      const all = purityRates(purity, index);
      const miners = all.filter(r => r.extractor.kind === 'miner').map(r => r.rate);
      if (miners.length === 0) return null;
      const min = Math.min(...miners);
      const max = Math.max(...miners);
      const value = min === max ? formatNumber(min, lang) : `${formatNumber(min, lang)}–${formatNumber(max, lang)}`;
      const list = all.map(r => `${r.extractor.name[lang]} ${unit(r.extractor.resources[0] ?? '', formatNumber(r.rate, lang))}`).join(', ');
      return { range: t('planner.unit.solid', { value }), hint: t('resourceNodes.purityRatesHint', { rates: list }) };
    },
  }), [index, t, unit, short, lang, percent]);
}
