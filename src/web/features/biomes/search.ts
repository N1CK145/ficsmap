import type { i18n as I18n } from 'i18next';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { DatasetIndex } from '../../../shared/dataset.js';
import type { SearchEntry, SearchProvider, WorldCtx } from '../../app/feature.js';
import { useUiStore } from '../../app/store.js';
import { biomeName } from './useBiomes.js';

/**
 * One search entry per biome with items, found by its name in both languages and its id. Choosing it
 * scopes the map to the biome (outline, mask, fit), like a click in the Biomes panel.
 */
export function biomeEntries(index: DatasetIndex, i18n: I18n): SearchEntry[] {
  const t = i18n.getFixedT(i18n.language);
  const byBiome = new Map<number, string[]>();
  for (const item of index.items) byBiome.set(item.biome, [...(byBiome.get(item.biome) ?? []), item.name]);
  return index.ds.biomes.flatMap((b, idx) => {
    const actors = byBiome.get(idx);
    if (!actors) return [];
    return [{
      id: `biome:${b.id}`,
      label: biomeName(index.ds, idx, i18n.language) ?? b.id,
      detail: t('search.itemCount', { count: actors.length }),
      kindKey: 'search.kind.biome',
      terms: [b.name.en, b.name.de, b.id],
      actors,
      onSelect: () => useUiStore.getState().setBiomeScope(idx),
    }];
  });
}

function useBiomeEntries(ctx: WorldCtx, active: boolean): readonly SearchEntry[] | undefined {
  const { i18n } = useTranslation();
  const { language } = i18n;
  return useMemo(() => (active && language ? biomeEntries(ctx.index, i18n) : undefined), [active, ctx.index, i18n, language]);
}

export const biomesSearch: SearchProvider = { id: 'biomes', order: 10, useEntries: useBiomeEntries };
