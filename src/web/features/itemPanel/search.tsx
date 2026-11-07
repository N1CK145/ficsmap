import type { i18n as I18n } from 'i18next';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { typeById } from '../../../shared/collectibleTypes.js';
import type { CrashSites, DatasetIndex } from '../../../shared/dataset.js';
import type { SearchEntry, SearchProvider, WorldCtx } from '../../app/feature.js';
import { useUiStore } from '../../app/store.js';
import { TypeIcon } from '../map/TypeIcon.js';
import { requirementText } from './sections/ToOpen.js';
import { useCrashSites } from './useCrashSites.js';

/** "crash site, drop pod" → its words as separate terms, in both languages. */
const keywords = (t: (k: string) => string) => t('search.crashSiteTerms').split(',').map(s => s.trim()).filter(Boolean);

/**
 * One search entry per drop pod's crash site, found by "crash site"/"drop pod" in both languages,
 * by what the pod needs to open, and by what lies around it, its threats and notes (crash-sites.json,
 * English). So "Modular Frame" finds the sites with Modular Frames. Choosing one selects the pod and
 * zooms to it. The pod itself is also found as a Hard Drive by its ID and label (collectibles).
 */
export function crashSiteEntries(index: DatasetIndex, sites: CrashSites, i18n: I18n): SearchEntry[] {
  const locale = i18n.language === 'de' ? 'de' : 'en';
  const t = i18n.getFixedT(locale);
  const en = i18n.getFixedT('en');
  const de = i18n.getFixedT('de');
  const words = [...keywords(en), ...keywords(de)];
  return index.items.flatMap(item => {
    const type = typeById(item.type);
    if (type.details !== 'dropPod') return [];
    const site = sites[item.name];
    const pod = item.extra?.pod;
    const biome = index.ds.biomes[item.biome]?.name[locale];
    const place = biome ? `${biome} ${item.seq}` : String(item.seq);
    return [{
      id: `crash-site:${item.name}`,
      label: t('search.crashSite', { place }),
      detail: pod && index.ds.podRequirementsKnown ? t('search.toOpen', { what: requirementText(pod, t, locale) }) : undefined,
      kindKey: 'search.kind.crashSite',
      terms: [
        ...words,
        ...(pod?.item ? [pod.item.en, pod.item.de] : []),
        ...(site ? [...site.items.map(i => i.item), ...site.threats.map(th => th.name), ...site.notes] : []),
      ],
      actors: [item.name],
      icon: <TypeIcon type={type} size={16} />,
      onSelect: () => useUiStore.getState().focusItem(item.name),
    }];
  });
}

function useCrashSiteEntries(ctx: WorldCtx, active: boolean): readonly SearchEntry[] | undefined {
  const { i18n } = useTranslation();
  const { language } = i18n;
  const sites = useCrashSites(active ? ctx.me.datasetVersion : undefined).data;
  return useMemo(() => (sites && language ? crashSiteEntries(ctx.index, sites, i18n) : undefined), [sites, ctx.index, i18n, language]);
}

export const crashSitesSearch: SearchProvider = { id: 'crash-sites', order: 40, useEntries: useCrashSiteEntries };
