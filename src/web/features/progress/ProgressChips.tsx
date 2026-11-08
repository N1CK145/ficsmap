import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { COLLECTIBLE_TYPES } from '../../../shared/collectibleTypes.js';
import { useUiStore } from '../../app/store.js';
import { useDatasetQuery } from '../map/useDataset.js';
import { TypeIcon } from '../map/TypeIcon.js';
import { isCollected, useMarks } from '../marks/useMarks.js';
import { useMe } from '../worlds/queries.js';
import { countProgress } from './count.js';

/** The row's right edge fades out while more chips follow there (`ProgressChips`). */
const FADE = 'linear-gradient(to right, #000 calc(100% - 3rem), transparent)';
const FADED: CSSProperties = { maskImage: FADE, WebkitMaskImage: FADE };

/**
 * The Progress panel as one row of chips (the mobile sheet's peek, spec §10.11): type icon and
 * done/total per type, each a filter toggle like the panel's rows. Scrolls sideways when it does not fit; while
 * chips are hidden on the right, the right edge fades out, so a cut-off row does not look complete.
 */
export function ProgressChips({ worldId }: { worldId: string }) {
  const { t } = useTranslation();
  const index = useDatasetQuery(useMe().data?.datasetVersion).data;
  const marks = useMarks(worldId);
  const typeFilter = useUiStore(s => s.typeFilter);
  const biomeScope = useUiStore(s => s.biomeScope);
  const toggleType = useUiStore(s => s.toggleType);
  const row = useRef<HTMLUListElement>(null);
  const [more, setMore] = useState(false);

  const counts = useMemo(() => {
    if (!index || !marks) return null;
    return countProgress(index.items, name => isCollected(marks, name), { typeFilter, biome: biomeScope, biomeCount: index.ds.biomes.length });
  }, [index, marks, typeFilter, biomeScope]);

  // Whether chips are hidden to the right: on scrolling, on a size change and when the counts (the chips' widths) change.
  useLayoutEffect(() => {
    const el = row.current;
    if (!el) return;
    const check = () => setMore(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
    check();
    el.addEventListener('scroll', check, { passive: true });
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(check);
    resize?.observe(el);
    return () => {
      el.removeEventListener('scroll', check);
      resize?.disconnect();
    };
  }, [counts]);
  if (!counts) return null;

  return (
    <ul ref={row} aria-label={t('progress.title')} data-more={more || undefined} style={more ? FADED : undefined} className="flex gap-2 overflow-x-auto px-3 py-2">
      {COLLECTIBLE_TYPES.map(type => {
        const enabled = typeFilter.has(type.id);
        const count = counts.byType[type.id];
        return (
          <li key={type.id} className="shrink-0">
            <button
              type="button"
              aria-pressed={enabled}
              onClick={() => toggleType(type.id)}
              className={`flex h-11 items-center gap-1.5 chamfer border px-2.5 focus-ring ${enabled ? 'border-edge bg-raised text-fg' : 'border-line text-muted'}`}
            >
              <TypeIcon type={type} className={`shrink-0 ${enabled ? '' : 'opacity-40'}`} />
              <span className="sr-only">{t(`progress.types.${type.id}`)}</span>
              <span className="font-display font-semibold tabular-nums">{t('progress.count', { done: count.done, total: count.total })}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
