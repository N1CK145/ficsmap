import type { i18n as I18n } from 'i18next';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { MachineData } from '../../../shared/machines.js';
import type { SearchEntry, SearchProvider, WorldCtx } from '../../app/feature.js';
import { useMachineData, useMachineWiki } from './useMachineWiki.js';

/**
 * One search entry per machine and vehicle of the wiki, found by its name in both languages and its class;
 * choosing it opens the wiki at that entry. Entries stand for no map item, so the map stays as it is.
 */
export function machineEntries(data: MachineData, i18n: I18n): SearchEntry[] {
  const lang = i18n.language === 'de' ? 'de' : 'en';
  const t = i18n.getFixedT(lang);
  return data.machines.map(m => ({
    id: `machine:${m.id}`,
    label: m.name[lang],
    detail: t(`machineWiki.category.${m.category}`),
    kindKey: m.category === 'vehicles' ? 'search.kind.vehicle' : 'search.kind.machine',
    terms: [m.name.en, m.name.de, m.id],
    onSelect: () => useMachineWiki.getState().show(m.id),
  }));
}

function useMachineEntries(ctx: WorldCtx, active: boolean): readonly SearchEntry[] | undefined {
  const { i18n } = useTranslation();
  const { language } = i18n;
  // machines.json (about 170 KB) is only loaded once the search is used.
  const { data, failed } = useMachineData(ctx.me.datasetVersion, active);
  return useMemo(() => {
    if (data === null || failed) return [];
    if (!active || data === undefined || !language) return undefined;
    return machineEntries(data, i18n);
  }, [data, failed, active, language, i18n]);
}

/** The wiki's machines and vehicles in the header search, after the map's own results. */
export const machinesSearch: SearchProvider = { id: 'machines', order: 50, useEntries: useMachineEntries };
