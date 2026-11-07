import type { i18n as I18n } from 'i18next';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { DatasetIndex } from '../../../shared/dataset.js';
import { pointInRings, worldToLatLng } from '../../../shared/geo.js';
import type { SearchEntry, SearchProvider, WorldCtx } from '../../app/feature.js';
import { boundsOf, useMapFit } from '../search/fit.js';
import { hasCaves, useCaveLayer, useCaves, type CaveShapes } from './useCaves.js';

/** The cave's number from its id (`cave-012` → 12); caves are numbered by the dataset build. */
function caveNumber(id: string, fallback: number): number {
  const n = Number(/\d+/.exec(id)?.[0]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** The biome most of the items inside lie in, else the biome of the item nearest to the cave. */
function caveBiome(index: DatasetIndex, inside: readonly number[], centre: [number, number]): number | null {
  if (inside.length > 0) {
    const counts = new Map<number, number>();
    for (const b of inside) counts.set(b, (counts.get(b) ?? 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]![0];
  }
  let best: number | null = null;
  let bestD = Infinity;
  for (const item of index.items) {
    const [lat, lng] = worldToLatLng(item.x, item.y, index.ds.bounds);
    const d = Math.hypot(lat - centre[0], lng - centre[1]);
    if (d < bestD) { bestD = d; best = item.biome; }
  }
  return best;
}

/**
 * One search entry per cave ("Cave 12", with its biome), found by its number in both languages, its
 * id and its biome's names. Its items are the items inside its outline. Choosing it switches the cave
 * layer on and fits the map to the cave.
 */
export function caveEntries(index: DatasetIndex, shapes: CaveShapes, i18n: I18n): SearchEntry[] {
  const lang = i18n.language === 'de' ? 'de' : 'en';
  const t = i18n.getFixedT(lang);
  const en = i18n.getFixedT('en');
  const de = i18n.getFixedT('de');
  const inCave = index.items.filter(i => i.extra?.cave === true).map(item => ({ item, at: worldToLatLng(item.x, item.y, index.ds.bounds) }));
  return shapes.caves.flatMap((rings, k) => {
    const bounds = boundsOf(rings);
    if (!bounds) return [];
    const id = shapes.ids[k] ?? `cave-${k + 1}`;
    const n = caveNumber(id, k + 1);
    const inside = inCave.filter(({ at }) => pointInRings(at[0], at[1], rings)).map(({ item }) => item);
    const centre: [number, number] = [(bounds[0][0] + bounds[1][0]) / 2, (bounds[0][1] + bounds[1][1]) / 2];
    const biome = caveBiome(index, inside.map(i => i.biome), centre);
    const names = biome === null ? undefined : index.ds.biomes[biome]?.name;
    return [{
      id: `cave:${id}`,
      label: t('search.cave', { n }),
      detail: names
        ? t('search.caveIn', { biome: names[lang], count: inside.length })
        : t('search.itemCount', { count: inside.length }),
      kindKey: 'search.kind.cave',
      terms: [en('search.cave', { n }), de('search.cave', { n }), id, ...(names ? [names.en, names.de] : [])],
      actors: inside.map(i => i.name),
      onSelect: () => {
        const layer = useCaveLayer.getState();
        if (!layer.visible) layer.toggle();
        useMapFit.getState().fit(bounds);
      },
    }];
  });
}

function useCaveEntries(ctx: WorldCtx, active: boolean): readonly SearchEntry[] | undefined {
  const { i18n } = useTranslation();
  const { language } = i18n;
  const withCaves = useMemo(() => hasCaves(ctx.index), [ctx.index]);
  // The file is about 1 MB: only loaded once the search is used, and only for a dataset with caves.
  const shapes = useCaves(ctx.me.datasetVersion, ctx.index.ds.bounds, active && withCaves);
  return useMemo(() => {
    if (!withCaves || shapes === null) return [];
    if (!active || shapes === undefined || !language) return undefined;
    return caveEntries(ctx.index, shapes, i18n);
  }, [withCaves, active, shapes, ctx.index, i18n, language]);
}

export const cavesSearch: SearchProvider = { id: 'caves', order: 20, useEntries: useCaveEntries };
