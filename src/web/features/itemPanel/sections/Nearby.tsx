import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { typeById } from '../../../../shared/collectibleTypes.js';
import type { Item } from '../../../../shared/dataset.js';
import { detectLocale } from '../../../../shared/i18n.js';
import type { WorldCtx } from '../../../app/feature.js';
import { useUiStore } from '../../../app/store.js';
import { Panel } from '../../../components/Panel.js';
import { TypeIcon } from '../../map/TypeIcon.js';
import { hasMismatch, isCollected, useMarks } from '../../marks/useMarks.js';
import { itemLabel } from '../label.js';
import { nearby, NEARBY_RADIUS_M } from '../nearby.js';

type Status = 'collected' | 'uncollected' | 'conflict';
const STATUS_ICON: Record<Status, string> = { collected: '✓', uncollected: '○', conflict: '!' };

/**
 * Up to six tracked collectibles around the item (spec §10.2), with distance, height difference and
 * status. A row selects its item.
 */
export function Nearby({ item, ctx }: { item: Item; ctx: WorldCtx }) {
  const { t, i18n } = useTranslation();
  const marks = useMarks(ctx.worldId);
  const select = useUiStore(s => s.select);
  const rows = useMemo(() => nearby(item, ctx.index.items), [item, ctx.index.items]);
  const locale = detectLocale([i18n.language]);

  const status = (actor: string): Status => {
    if (!marks || !isCollected(marks, actor)) return 'uncollected';
    return hasMismatch(marks, actor) ? 'conflict' : 'collected';
  };

  return (
    <Panel title={t('item.nearby.title', { radius: NEARBY_RADIUS_M })}>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">{t('item.nearby.empty', { radius: NEARBY_RADIUS_M })}</p>
      ) : (
        <ul className="-mx-1 flex flex-col">
          {rows.map(({ item: other, distM, dzM }) => {
            const s = status(other.name);
            const dz = Math.round(Math.abs(dzM));
            return (
              <li key={other.name}>
                <button
                  type="button"
                  onClick={() => select(other.name)}
                  className="flex w-full items-center gap-2 rounded px-1 py-1 text-left text-sm hover:bg-line focus-ring"
                >
                  <TypeIcon type={typeById(other.type)} className="shrink-0" />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate">{itemLabel(other, t, ctx.index.ds.biomes, locale)}</span>
                    <span className="text-xs text-muted tabular-nums">
                      {t('item.nearby.distance', { distance: Math.round(distM) })}
                      {dz > 0 && <> · {t(dzM < 0 ? 'item.nearby.below' : 'item.nearby.above', { dz })}</>}
                    </span>
                  </span>
                  <span className={`w-4 shrink-0 text-center ${s === 'conflict' ? 'text-conflict' : s === 'collected' ? 'text-fg' : 'text-muted'}`}>
                    <span aria-hidden="true">{STATUS_ICON[s]}</span>
                    <span className="sr-only">{t(`item.status.${s}`)}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
