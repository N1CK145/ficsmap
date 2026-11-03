import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { detectLocale } from '../../../shared/i18n.js';
import { loadPodTicks, savePodTicks } from '../../app/persist.js';
import { useCrashSites } from '../itemPanel/useCrashSites.js';
import { useDatasetQuery } from '../map/useDataset.js';
import { isCollected, useMarks } from '../marks/useMarks.js';
import { useMe } from '../worlds/queries.js';
import { podNeeds, type FoundAt, type PodNeeds } from './podNeeds.js';
import { useRouteDraft } from './useRoutes.js';

/** What the open route's open pods need, with crash-site loot on the way counted in; null without open pods or route. */
export function useRoutePodNeeds(worldId: string): PodNeeds | null {
  const { i18n } = useTranslation();
  const me = useMe().data;
  const index = useDatasetQuery(me?.datasetVersion).data;
  const marks = useMarks(worldId);
  const stops = useRouteDraft(s => s.draft?.stops);
  const sites = useCrashSites(me?.datasetVersion).data;
  const locale = detectLocale([i18n.language]);
  return useMemo(() => {
    if (!index || !marks || !stops) return null;
    const items = stops.flatMap(s => index.byName.get(s) ?? []);
    return podNeeds(items, name => isCollected(marks, name), locale, sites ?? {});
  }, [index, marks, stops, sites, locale]);
}

export interface PodTicks { ticks: ReadonlySet<string>; toggle(key: string): void }

/**
 * The items ticked off in the open route's list ("I have it with me"), on this device only. A saved
 * route keeps them in localStorage; an unsaved one in memory, and they carry over when it is saved.
 */
export function usePodTicks(worldId: string): PodTicks {
  const routeId = useRouteDraft(s => s.draft?.id ?? null);
  const [state, setState] = useState(() => ({ worldId, routeId, ticks: routeId === null ? new Set<string>() : loadPodTicks(worldId, routeId) }));
  let current = state;
  if (state.worldId !== worldId || state.routeId !== routeId) {
    const firstSave = state.worldId === worldId && state.routeId === null && routeId !== null;
    const ticks = firstSave ? state.ticks : routeId === null ? new Set<string>() : loadPodTicks(worldId, routeId);
    current = { worldId, routeId, ticks };
    setState(current);
  }
  useEffect(() => {
    if (state.routeId !== null) savePodTicks(state.worldId, state.routeId, state.ticks);
  }, [state]);
  return {
    ticks: current.ticks,
    toggle: key => setState(s => {
      const ticks = new Set(s.ticks);
      if (!ticks.delete(key)) ticks.add(key);
      return { ...s, ticks };
    }),
  };
}

/** Items still to bring that are not ticked off yet. */
export function openCount(needs: PodNeeds, ticks: ReadonlySet<string>): number {
  return needs.items.filter(i => i.bring > 0 && !ticks.has(i.key)).length;
}

const stopList = (at: readonly FoundAt[]) => at.map(a => a.stop).join(', ');
const sum = (at: readonly FoundAt[]) => at.reduce((n, a) => n + a.amount, 0);

/**
 * The "Bring with you" list (spec §10.6): per item what crash-site loot on the route does not cover,
 * checkable, with where the rest lies; below it the items fully found on the way, then power and
 * pods that need nothing or have no data.
 */
export function PodChecklistBody({ needs, ticks, onToggle }: { needs: PodNeeds; ticks: ReadonlySet<string>; onToggle(key: string): void }) {
  const { t } = useTranslation();
  const bring = needs.items.filter(i => i.bring > 0);
  const found = needs.items.filter(i => i.bring === 0);
  return (
    <div className="flex flex-col gap-2 text-sm">
      {bring.length > 0 && (
        <ul className="flex flex-col gap-1">
          {bring.map(i => {
            const ticked = ticks.has(i.key);
            return (
              <li key={i.key} className="flex flex-col">
                <label className="flex cursor-pointer items-center gap-2">
                  <input type="checkbox" checked={ticked} onChange={() => onToggle(i.key)} className="size-4 shrink-0 accent-accent focus-ring" />
                  <span className={`min-w-0 flex-1 ${ticked ? 'text-muted line-through' : ''}`}>{i.item}</span>
                  <span className={`font-display tabular-nums ${ticked ? 'text-muted' : ''}`}>{t('routes.podNeeds.amount', { amount: i.bring })}</span>
                </label>
                {i.onRoute.length > 0 && (
                  <span className="pl-6 text-muted">
                    {t('routes.podNeeds.fromStops', { amount: sum(i.onRoute), count: i.onRoute.length, stops: stopList(i.onRoute) })}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {bring.length === 0 && found.length > 0 && <p className="text-muted">{t('routes.podNeeds.allFound')}</p>}
      {found.length > 0 && (
        <section aria-label={t('routes.podNeeds.found')} className="flex flex-col gap-1">
          <h5 className="font-display text-xs font-semibold tracking-wider text-muted uppercase">{t('routes.podNeeds.found')}</h5>
          <ul className="flex flex-col gap-0.5 text-muted">
            {found.map(i => (
              <li key={i.key} className="flex items-baseline gap-2">
                <span aria-hidden="true" className="w-4 shrink-0 text-center text-accent">✓</span>
                <span className="min-w-0 flex-1">{i.item}</span>
                <span className="font-display tabular-nums">{t('routes.podNeeds.amount', { amount: i.need })}</span>
                <span>{t('routes.podNeeds.atStops', { count: i.onRoute.length, stops: stopList(i.onRoute) })}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {needs.power && <p>⚡ {t('routes.podNeeds.power', { count: needs.power.pods, mw: needs.power.maxMw })}</p>}
      {needs.free > 0 && <p className="text-muted">{t('routes.podNeeds.free', { count: needs.free })}</p>}
      {needs.unknown > 0 && <p className="text-muted">{t('routes.podNeeds.unknown', { count: needs.unknown })}</p>}
    </div>
  );
}

/** The list inside the route editor, where the map has no room for the overlay (mobile). Nothing without open pods. */
export function PodChecklist({ worldId }: { worldId: string }) {
  const { t } = useTranslation();
  const needs = useRoutePodNeeds(worldId);
  const { ticks, toggle } = usePodTicks(worldId);
  if (!needs) return null;
  const open = openCount(needs, ticks);
  return (
    <section aria-label={t('routes.podNeeds.title')} className="flex flex-col gap-2 rounded border border-line p-2">
      <h4 className="flex items-baseline justify-between gap-2 text-sm font-medium">
        <span>{t('routes.podNeeds.title')}</span>
        {open > 0 && <span className="text-muted">{t('routes.podNeeds.open', { count: open })}</span>}
      </h4>
      <PodChecklistBody needs={needs} ticks={ticks} onToggle={toggle} />
    </section>
  );
}
