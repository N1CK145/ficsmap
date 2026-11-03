import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { COLLECTIBLE_TYPES } from '../../../shared/collectibleTypes.js';
import { useUiStore } from '../../app/store.js';
import { useDatasetQuery } from '../map/useDataset.js';
import { TypeIcon } from '../map/TypeIcon.js';
import { isCollected, useMarks } from '../marks/useMarks.js';
import { useMe } from '../worlds/queries.js';
import { countProgress } from './count.js';

/**
 * The Progress panel as one row of chips (the mobile sheet's peek, spec §10.11): type icon and
 * done/total per type, each a filter toggle like the panel's rows. Scrolls sideways when it does not fit.
 */
export function ProgressChips({ worldId }: { worldId: string }) {
  const { t } = useTranslation();
  const index = useDatasetQuery(useMe().data?.datasetVersion).data;
  const marks = useMarks(worldId);
  const typeFilter = useUiStore(s => s.typeFilter);
  const biomeScope = useUiStore(s => s.biomeScope);
  const toggleType = useUiStore(s => s.toggleType);

  const counts = useMemo(() => {
    if (!index || !marks) return null;
    return countProgress(index.items, name => isCollected(marks, name), { typeFilter, biome: biomeScope, biomeCount: index.ds.biomes.length });
  }, [index, marks, typeFilter, biomeScope]);
  if (!counts) return null;

  return (
    <ul aria-label={t('progress.title')} className="flex gap-2 overflow-x-auto px-3 py-2">
      {COLLECTIBLE_TYPES.map(type => {
        const enabled = typeFilter.has(type.id);
        const count = counts.byType[type.id];
        return (
          <li key={type.id} className="shrink-0">
            <button
              type="button"
              aria-pressed={enabled}
              onClick={() => toggleType(type.id)}
              className={`flex h-11 items-center gap-1.5 rounded border border-line px-2 focus-ring ${enabled ? 'bg-bg text-fg' : 'text-muted'}`}
            >
              <TypeIcon type={type} className={`shrink-0 ${enabled ? '' : 'opacity-40'}`} />
              <span className="sr-only">{t(`progress.types.${type.id}`)}</span>
              <span className="font-display tabular-nums">{t('progress.count', { done: count.done, total: count.total })}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
