import type { i18n as I18n } from 'i18next';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { COLLECTIBLE_TYPES } from '../../../shared/collectibleTypes.js';
import type { DatasetIndex } from '../../../shared/dataset.js';
import { detectLocale } from '../../../shared/i18n.js';
import type { SearchEntry, SearchProvider, WorldCtx } from '../../app/feature.js';
import { useUiStore } from '../../app/store.js';
import { itemLabel } from '../itemPanel/label.js';
import { TypeIcon } from '../map/TypeIcon.js';

/** Types come before biomes (10), caves (20), single items and crash sites (40). */
export const TYPE_WEIGHT = 0;
export const ITEM_WEIGHT = 30;

/**
 * The search entries for the collectibles: one per type ("Somersloop": all of them) and one per
 * item, found by its label in both languages ("Blue Power Slug · Dune Desert 3"), its actor ID and
 * the IDs that alias to it (a Mercer Shrine's). Choosing an item selects it and zooms to it.
 */
export function collectibleEntries(index: DatasetIndex, i18n: I18n): SearchEntry[] {
  const locale = detectLocale([i18n.language]);
  const t = i18n.getFixedT(locale);
  const en = i18n.getFixedT('en');
  const de = i18n.getFixedT('de');
  const { biomes } = index.ds;

  const aliasesOf = new Map<string, string[]>();
  for (const [alias, target] of Object.entries(index.ds.aliases)) aliasesOf.set(target, [...(aliasesOf.get(target) ?? []), alias]);

  const types: SearchEntry[] = COLLECTIBLE_TYPES.flatMap(type => {
    const actors = index.items.filter(i => i.type === type.id).map(i => i.name);
    if (actors.length === 0) return [];
    const plural = `progress.types.${type.id}`;
    return [{
      id: `type:${type.id}`,
      label: t(type.labelKey),
      detail: t('search.typeCount', { count: actors.length }),
      kindKey: 'search.kind.type',
      terms: [en(type.labelKey), de(type.labelKey), en(plural), de(plural), type.id, ...type.classes],
      actors,
      weight: TYPE_WEIGHT,
      icon: <TypeIcon type={type} size={16} />,
    }];
  });

  const items: SearchEntry[] = index.items.map(item => {
    const type = COLLECTIBLE_TYPES.find(x => x.id === item.type)!;
    return {
      id: `item:${item.name}`,
      label: itemLabel(item, t, biomes, locale),
      detail: item.name,
      kindKey: 'search.kind.item',
      terms: [item.name, ...(aliasesOf.get(item.name) ?? []), itemLabel(item, en, biomes, 'en'), itemLabel(item, de, biomes, 'de')],
      actors: [item.name],
      weight: ITEM_WEIGHT,
      icon: <TypeIcon type={type} size={16} />,
      onSelect: () => useUiStore.getState().focusItem(item.name),
    };
  });
  return [...types, ...items];
}

function useCollectibleEntries(ctx: WorldCtx, active: boolean): readonly SearchEntry[] | undefined {
  const { i18n } = useTranslation();
  const { language } = i18n;
  // `language` is a dependency so the labels follow the language switch.
  return useMemo(() => (active && language ? collectibleEntries(ctx.index, i18n) : undefined), [active, ctx.index, i18n, language]);
}

export const collectiblesSearch: SearchProvider = { id: 'collectibles', order: ITEM_WEIGHT, useEntries: useCollectibleEntries };
