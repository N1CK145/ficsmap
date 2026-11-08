import type { i18n as I18n } from 'i18next';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { PURITIES, type Purity, type ResourceNode, type ResourceNodesFile } from '../../../shared/resourceNodes.js';
import type { SearchEntry, SearchProvider, WorldCtx } from '../../app/feature.js';
import { GameIcon, useItemIcons, type ItemIcons } from '../machineWiki/icons.js';
import { PurityDot, ResourceSwatch } from './PurityPips.js';
import { resourceToken, sortResources } from './resourceStyle.js';
import { useNodeLayer, useWorldNodes } from './useResourceNodes.js';

/** The size of a result's picture in the search list. */
const ICON_PX = 24;
/** The provider's order: after the collectibles (30), before crash sites (40). */
const ORDER = 35;
/** Pure first, in the detail line and among a resource's purity entries: what players look for. */
const BY_VALUE: readonly Purity[] = [...PURITIES].reverse();
/** A resource's purity entries rank after it, pure first. */
const purityWeight = (p: Purity) => ORDER + (BY_VALUE.indexOf(p) + 1) / 10;

/** The resource's game picture (a colour disk where the dataset has none, e.g. geysers), with a purity dot. */
function ResourcePicture({ id, icons, purity }: { id: string; icons: ItemIcons | null; purity?: Purity }) {
  return (
    <span className="relative inline-flex size-6 items-center justify-center">
      {icons?.has(id) ? <GameIcon cls={id} px={ICON_PX} icons={icons} /> : <ResourceSwatch token={resourceToken(id)} />}
      {purity && <PurityDot purity={purity} className="absolute -right-0.5 -bottom-0.5 rounded-full bg-bg" />}
    </span>
  );
}

/**
 * Per resource on the map one search entry, found by its name in both languages and its class ("Eisenerz", detail
 * "46 rein · 42 normal · 39 unrein"), and one per purity it has ("Eisenerz · Rein", found by "eisen rein" or "iron
 * pure"), ranked after it. Choosing one switches the resource node layer on and filters it to that resource (and
 * purity); the entry's nodes are its `actors`, so the collectibles fade like non-matches of a search. Counts are the
 * world's extraction points (with the last save import), not well centres.
 */
export function resourceNodeEntries(nodes: readonly ResourceNode[], file: ResourceNodesFile, i18n: I18n, icons: ItemIcons | null = null): SearchEntry[] {
  const lang = i18n.language === 'de' ? 'de' : 'en';
  const t = i18n.getFixedT(lang);
  const fixed = { en: i18n.getFixedT('en'), de: i18n.getFixedT('de') };
  const nameIn = (l: 'en' | 'de', id: string) => {
    const key = `resourceNodes.resources.${id}`;
    return i18n.exists(key, { lng: l }) ? fixed[l](key) : (file.resources.find(r => r.id === id)?.name ?? id);
  };
  const byResource = new Map<string, Map<Purity, string[]>>();
  for (const n of nodes) {
    if (n.kind === 'core' || n.purity === null) continue;
    const perPurity = byResource.get(n.resource) ?? new Map<Purity, string[]>();
    perPurity.set(n.purity, [...(perPurity.get(n.purity) ?? []), n.name]);
    byResource.set(n.resource, perPurity);
  }
  const all = sortResources(new Set([...file.resources.map(r => r.id), ...byResource.keys()]));
  return sortResources(byResource.keys()).flatMap(id => {
    const perPurity = byResource.get(id)!;
    const names = { en: nameIn('en', id), de: nameIn('de', id) };
    const present = BY_VALUE.filter(p => perPurity.has(p));
    const main: SearchEntry = {
      id: `resource-node:${id}`,
      label: names[lang],
      detail: present.map(p => t(`resourceNodes.search.purity.${p}`, { count: perPurity.get(p)!.length })).join(' · '),
      kindKey: 'search.kind.resource',
      terms: [names.en, names.de, id],
      actors: present.flatMap(p => perPurity.get(p)!),
      weight: ORDER,
      icon: <ResourcePicture id={id} icons={icons} />,
      onSelect: () => useNodeLayer.getState().showResource(id, all, null),
    };
    const withPurity = present.map((p): SearchEntry => {
      const label = (l: 'en' | 'de') => fixed[l]('resourceNodes.search.withPurity', { resource: names[l], purity: fixed[l](`resourceNodes.purity.${p}`) });
      return {
        id: `resource-node:${id}:${p}`,
        label: label(lang),
        detail: t('resourceNodes.search.nodes', { count: perPurity.get(p)!.length }),
        kindKey: 'search.kind.resource',
        terms: [label('en'), label('de')],
        actors: perPurity.get(p)!,
        weight: purityWeight(p),
        icon: <ResourcePicture id={id} icons={icons} purity={p} />,
        onSelect: () => useNodeLayer.getState().showResource(id, all, p),
      };
    });
    return [main, ...withPurity];
  });
}

function useResourceNodeEntries(ctx: WorldCtx, active: boolean): readonly SearchEntry[] | undefined {
  const { i18n } = useTranslation();
  const { language } = i18n;
  // The node file is shared with the map layer and the panel (one query); loaded once the search is used.
  const data = useWorldNodes(ctx.me.datasetVersion, ctx.worldId, active);
  const icons = useItemIcons(ctx.me.datasetVersion, active && !!data);
  return useMemo(() => {
    if (data === null) return [];
    if (!active || data === undefined || !language) return undefined;
    return resourceNodeEntries(data.nodes, data.file, i18n, icons);
  }, [data, active, language, i18n, icons]);
}

/** The resources on the map in the header search: one entry per resource and one per resource and purity. */
export const resourceNodesSearch: SearchProvider = { id: 'resource-nodes', order: ORDER, useEntries: useResourceNodeEntries };
