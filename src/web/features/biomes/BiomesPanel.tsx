import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useUiStore } from '../../app/store.js';
import { useDatasetQuery } from '../map/useDataset.js';
import { isCollected, useMarks } from '../marks/useMarks.js';
import { countProgress } from '../progress/count.js';
import { useMe } from '../worlds/queries.js';
import { biomeName, sortBiomeRows, useBiomeHover, type BiomeRow } from './useBiomes.js';

/**
 * The Biomes panel (spec §10.4): one row per biome with done/total of the enabled types and a mini
 * bar, most items left first. A click scopes the map to the biome, a second click clears it.
 * Biomes without any item in the dataset are not listed.
 */
export function BiomesPanel({ worldId }: { worldId: string }) {
  const { t, i18n } = useTranslation();
  const index = useDatasetQuery(useMe().data?.datasetVersion).data;
  const marks = useMarks(worldId);
  const typeFilter = useUiStore(s => s.typeFilter);
  const biomeScope = useUiStore(s => s.biomeScope);
  const setBiomeScope = useUiStore(s => s.setBiomeScope);
  const hovered = useBiomeHover(s => s.hovered);
  const setHovered = useBiomeHover(s => s.setHovered);

  const rows = useMemo((): BiomeRow[] | null => {
    if (!index || !marks) return null;
    const { byBiome } = countProgress(index.items, name => isCollected(marks, name), { typeFilter, biome: null, biomeCount: index.ds.biomes.length });
    const populated = new Set(index.items.map(i => i.biome));
    const unsorted = byBiome.flatMap((count, idx) => (populated.has(idx) ? [{ idx, name: biomeName(index.ds, idx, i18n.language) ?? String(idx), count }] : []));
    return sortBiomeRows(unsorted);
  }, [index, marks, typeFilter, i18n.language]);
  if (!rows) return null;

  return (
    <ul className="flex flex-col" aria-label={t('biomes.title')}>
      {rows.map(({ idx, name, count }) => {
        const active = biomeScope === idx;
        return (
          <li key={idx}>
            <button
              type="button"
              aria-pressed={active}
              onClick={() => setBiomeScope(active ? null : idx)}
              onMouseEnter={() => setHovered(idx)}
              onMouseLeave={() => setHovered(null)}
              onFocus={() => setHovered(idx)}
              onBlur={() => setHovered(null)}
              className={`flex w-full flex-col gap-1 rounded px-2 py-1.5 text-left focus-ring hover:bg-bg ${active ? 'text-accent' : hovered === idx ? 'bg-bg text-fg' : 'text-fg'}`}
            >
              <span className="flex w-full items-center gap-2">
                <span className="min-w-0 flex-1 truncate">{name}</span>
                <span className="shrink-0 font-display tabular-nums">{t('progress.count', { done: count.done, total: count.total })}</span>
              </span>
              <span aria-hidden className="block h-1 w-full overflow-hidden rounded bg-line">
                <span className={`block h-full ${active ? 'bg-accent' : 'bg-muted'}`} style={{ width: `${count.total === 0 ? 0 : (count.done / count.total) * 100}%` }} />
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
