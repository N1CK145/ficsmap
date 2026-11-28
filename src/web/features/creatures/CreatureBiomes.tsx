import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { biomeLocator } from '../../../shared/biomes.js';
import { creaturesByBiome, type CreatureFamily } from '../../../shared/creatures.js';
import { UNITS_PER_METER } from '../../../shared/geo.js';
import { useUiStore } from '../../app/store.js';
import { Fold } from '../../components/Fold.js';
import { biomeName, useBiomeCollection } from '../biomes/useBiomes.js';
import { useFactoryFormat } from '../factory/format.js';
import { useDatasetQuery } from '../map/useDataset.js';
import { useCreatureLayer, type CreatureData } from './useCreatures.js';

/** A spawner outside every biome counts for the nearest one within this distance, as the dataset build assigns items. */
const SNAP_UNITS = 100 * UNITS_PER_METER;

/**
 * Where creatures still live, per biome (folded in the Creatures panel): the spawn points of the shown kinds that are
 * not dead right now (`creaturesByBiome`) of all, most first; a biome with none left says "cleared". A click shows the
 * creature layer and scopes the map to the biome (a second click clears the scope), like the Biomes panel. Biomes
 * come from the dataset's `biomes.geojson`; spawn points outside every one are a row of their own.
 */
export function CreatureBiomes({ version, data, hidden }: { version: string; data: CreatureData; hidden: readonly CreatureFamily[] }) {
  const { t, i18n } = useTranslation();
  const fmt = useFactoryFormat();
  const shapes = useBiomeCollection(version);
  const ds = useDatasetQuery(version).data?.ds;
  const scope = useUiStore(s => s.biomeScope);
  const rows = useMemo(() => {
    if (!shapes) return null;
    const shown = data.spawners.filter(s => !hidden.includes(s.family));
    return creaturesByBiome(shown, data.kills, biomeLocator(shapes, SNAP_UNITS));
  }, [shapes, data, hidden]);
  if (!rows || !ds) return null;
  const open = rows.filter(r => r.biome >= 0 && r.open > 0).length;
  const pick = (biome: number) => {
    useCreatureLayer.getState().show();
    useUiStore.getState().setBiomeScope(scope === biome ? null : biome);
  };

  return (
    <Fold title={t('creatures.biomes.title')} summary={t('creatures.biomes.summary', { count: open })} className="-mx-1 border-t border-line" summaryClassName="px-1 py-2" bodyClassName="flex flex-col gap-1 px-1 pb-1">
      <ul aria-label={t('creatures.biomes.title')} className="flex flex-col">
        {rows.map(r => {
          const name = r.biome < 0 ? t('creatures.biomes.outside') : biomeName(ds, r.biome, i18n.language) ?? String(r.biome);
          const count = r.open === 0
            ? <span className="shrink-0 text-muted">{t('creatures.biomes.cleared')}</span>
            : <span className="shrink-0 font-display tabular-nums">{t('creatures.biomes.count', { open: fmt.int(r.open), total: fmt.int(r.total) })}</span>;
          const body = <><span className="min-w-0 flex-1 truncate">{name}</span>{count}</>;
          return (
            <li key={r.biome}>
              {r.biome < 0
                ? <div className="flex h-8 items-center gap-2 px-2 text-sm text-muted max-[899px]:h-11">{body}</div>
                : (
                  <button type="button" aria-pressed={scope === r.biome} onClick={() => pick(r.biome)}
                    className={`flex h-8 w-full items-center gap-2 border-l-2 px-2 text-left text-sm focus-ring hover:bg-raised max-[899px]:h-11 ${
                      scope === r.biome ? 'border-l-accent bg-raised text-accent' : 'border-l-transparent text-fg'}`}>
                    {body}
                  </button>
                )}
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-muted">{t('creatures.biomes.hint')}</p>
    </Fold>
  );
}
