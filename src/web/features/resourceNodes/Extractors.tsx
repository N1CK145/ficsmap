import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { MAX_SHARDS, type ExtractorInfo, type ExtractorKind } from '../../../shared/resourceNodes.js';

/** The building's short name for the map tag (Mk.2, Oil, ...). */
export function useExtractorLabel(): (kind: ExtractorKind) => string {
  const { t } = useTranslation();
  return useCallback((kind: ExtractorKind) => t(`resourceNodes.extractorShort.${kind}`), [t]);
}

/** Identical extractors on one node (several portable miners) as one entry with a count. */
export function groupExtractors(list: readonly ExtractorInfo[]): { info: ExtractorInfo; count: number }[] {
  const out: { info: ExtractorInfo; count: number }[] = [];
  for (const e of list) {
    const g = out.find(o => o.info.kind === e.kind && o.info.clock === e.clock && o.info.shards === e.shards);
    if (g) g.count++;
    else out.push({ info: e, count: 1 });
  }
  return out;
}

/** The Power Shards as on the map: one diamond per shard, empty outlines for free slots. Decorative. */
export function ShardPips({ shards, slots = MAX_SHARDS }: { shards: number; slots?: number }) {
  return (
    <svg viewBox={`0 0 ${slots * 8} 8`} width={slots * 8} height="8" aria-hidden="true" className="shrink-0">
      {Array.from({ length: slots }, (_, i) => (
        <path
          key={i}
          d={`M${i * 8 + 4} 0.5 L${i * 8 + 7} 4 L${i * 8 + 4} 7.5 L${i * 8 + 1} 4 Z`}
          fill={i < shards ? 'var(--color-shard)' : 'none'}
          stroke={i < shards ? 'var(--color-shard)' : 'currentColor'}
          strokeOpacity={i < shards ? 1 : 0.5}
        />
      ))}
    </svg>
  );
}

/**
 * The extractors on one node: building, clock speed and Power Shards as the save holds them, and with `rateOf` what
 * each gets out of the node (from the recipe data; null leaves the line out).
 */
export function ExtractorList({ extractors, rateOf }: { extractors: readonly ExtractorInfo[]; rateOf?: (e: ExtractorInfo) => string | null }) {
  const { t, i18n } = useTranslation();
  const percent = new Intl.NumberFormat(i18n.language, { style: 'percent', maximumFractionDigits: 4 });
  return (
    <ul className="flex flex-col gap-0.5" data-testid="node-extractors">
      {groupExtractors(extractors).map(({ info, count }, i) => {
        const name = t(`resourceNodes.extractorKinds.${info.kind}`);
        const rate = rateOf?.(info) ?? null;
        return (
          <li key={i}>
            <div className="font-semibold">{count > 1 ? t('resourceNodes.times', { name, count }) : name}</div>
            {info.clock !== null && <div className="tabular-nums">{t('resourceNodes.clock', { value: percent.format(info.clock) })}</div>}
            {info.shards !== null && (
              <div className="flex items-center gap-1.5">
                <ShardPips shards={info.shards} />
                <span>{t('resourceNodes.shards', { count: info.shards })}</span>
              </div>
            )}
            {rate !== null && <div className="tabular-nums" data-testid="extractor-rate">{rate}</div>}
          </li>
        );
      })}
    </ul>
  );
}
