import type { i18n as I18n } from 'i18next';
import { createElement, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { LITRES_PER_M3, storageTotals } from '../../../shared/factory/inventory.js';
import type { FactorySnapshot } from '../../../shared/factory/snapshot.js';
import type { SearchEntry, SearchProvider, WorldCtx } from '../../app/feature.js';
import { worldPath } from '../../app/pages.js';
import { GameIcon, useItemIcons, type ItemIcons } from '../machineWiki/icons.js';
import { useMachineData } from '../machineWiki/useMachineWiki.js';
import { useRecipes } from '../planner/useRecipes.js';
import { useTransportData } from '../vehicleCalc/useVehicleCalc.js';
import { useSnapshot, useSnapshotList } from './api.js';
import { factoryLabels, type FactoryLabels } from './data.js';
import { resolveTimeline } from './timeline.js';
import { useFactoryView } from './view.js';

/** The size of a result's picture in the search list. */
const ICON_PX = 24;

/**
 * One search entry per item lying in the factory's storage in the shown save ("Copper Ingot · 1,250 in 3 storages"),
 * found by its name in both languages and its class; choosing it marks the storages holding it on the map
 * (`showOnMap`), which switches the factory layers on and fits to them.
 */
export function storageEntries(snapshot: FactorySnapshot, labels: FactoryLabels, i18n: I18n, icons: ItemIcons | null = null): SearchEntry[] {
  const lang = i18n.language === 'de' ? 'de' : 'en';
  const t = i18n.getFixedT(lang);
  const whole = new Intl.NumberFormat(lang, { maximumFractionDigits: 0 });
  return storageTotals(snapshot).map(s => {
    const fluid = labels.isFluid(s.item);
    const amount = fluid ? `${whole.format(Math.round(s.total / LITRES_PER_M3))} m³` : whole.format(s.total);
    const ids = s.holders.map(h => h.id);
    return {
      id: `storage:${s.item}`,
      label: labels.item(s.item, lang),
      ...(icons?.has(s.item) ? { icon: createElement(GameIcon, { cls: s.item, px: ICON_PX, icons }) } : {}),
      detail: t('factory.storage.searchDetail', { amount, count: s.holders.length }),
      kindKey: 'factory.storage.searchKind',
      terms: [labels.item(s.item, 'en'), labels.item(s.item, 'de'), s.item],
      onSelect: (ctx: WorldCtx) => {
        useFactoryView.getState().showOnMap(ids);
        ctx.navigate(worldPath(ctx.worldId));
      },
    };
  });
}

function useStorageEntries(ctx: WorldCtx, active: boolean): readonly SearchEntry[] | undefined {
  const { i18n } = useTranslation();
  const { language } = i18n;
  const version = ctx.me.datasetVersion;
  // Nothing loads before the search is used: then the snapshot list, the shown (else newest) snapshot and the names.
  const list = useSnapshotList(ctx.worldId, active);
  const selectedId = useFactoryView(s => s.selectedId);
  const shown = resolveTimeline(list.data, selectedId, null).selected;
  const snapshot = useSnapshot(ctx.worldId, active ? shown?.id ?? null : null);
  const { index: recipes } = useRecipes(version, active);
  const { data: machines } = useMachineData(version, active);
  const { data: transport } = useTransportData(version, active);
  const icons = useItemIcons(version, active);
  return useMemo(() => {
    if (!active || !language) return undefined;
    if (list.isError || (list.data && list.data.length === 0) || snapshot.isError) return [];
    if (!snapshot.data || recipes === undefined) return undefined;
    // Without contents (imported before they were read) there is nothing to find.
    if (snapshot.data.meta.inventories !== true) return [];
    return storageEntries(snapshot.data, factoryLabels(recipes, machines ?? null, null, transport ?? null), i18n, icons);
  }, [active, language, list.isError, list.data, snapshot.isError, snapshot.data, recipes, machines, transport, i18n, icons]);
}

/** What lies in storage in the header search, after the machines. */
export const storageSearch: SearchProvider = { id: 'storage', order: 55, useEntries: useStorageEntries };
