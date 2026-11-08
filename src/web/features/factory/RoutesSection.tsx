import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { RouteAnalysis, StationFlow } from '../../../shared/factory/analysis.js';
import type { DatasetIndex } from '../../../shared/dataset.js';
import { Badge } from '../../components/Badge.js';
import { SectionHeading } from '../../components/SectionHeading.js';
import { Window } from '../../components/Window.js';
import { GameIcon } from '../machineWiki/icons.js';
import { Picture } from '../planner/pictures.js';
import type { FactoryLabels } from './data.js';
import { nearestBiome, stationNames, vehicleNames, type FactoryFormat } from './format.js';
import { TABLE, TD, TD_FIRST, TH, THEAD, TR } from './ItemsSection.js';
import { ShowOnMap } from './parts.js';

const mean = (xs: number[]) => (xs.length > 0 ? xs.reduce((s, x) => s + x, 0) / xs.length : null);

/** Loading ↑ / unloading ↓ as arrow and word. */
function Mode({ loading }: { loading: boolean | null }) {
  const { t } = useTranslation();
  if (loading === null) return <span className="text-muted">–</span>;
  return (
    <span className="inline-flex items-center gap-1">
      <span aria-hidden="true" className={loading ? 'text-free' : 'text-accent'}>{loading ? '↑' : '↓'}</span>
      {t(loading ? 'factory.routes.loading' : 'factory.routes.unloading')}
    </span>
  );
}

/**
 * "Routes": the stations (name or "Truck Station n" with the biome nearby, loading or unloading, the vehicles that
 * stop there, items per minute = items per dock / time between docks, the time between docks, items per dock against
 * the vehicle's hold) and the vehicles (their stops in order, autopilot, fuel, round trip, items loaded and unloaded
 * per minute). The save tracks each vehicle per station, so all figures are the game's own averages.
 */
export function RoutesSection({ worldId, routes, labels, fmt, index }: {
  worldId: string; routes: RouteAnalysis; labels: FactoryLabels; fmt: FactoryFormat; index: DatasetIndex;
}) {
  const { t } = useTranslation();
  const lang = fmt.lang;
  const names = useMemo(() => stationNames(routes.stations, labels, lang), [routes, labels, lang]);
  const vNames = useMemo(() => vehicleNames(routes.vehicles, labels, lang), [routes, labels, lang]);
  const biomes = useMemo(() => new Map(routes.stations.map(s => [s.id, nearestBiome(index, s.x, s.y, lang)])), [routes, index, lang]);
  const byId = useMemo(() => new Map(routes.stations.map(s => [s.id, s])), [routes]);
  const moved = routes.stations.reduce((n, s) => n + (s.loading === false ? s.itemsPerMin ?? 0 : 0), 0);

  if (routes.stations.length === 0 && routes.vehicles.length === 0) {
    return (
      <Window title={t('factory.routes.title')}>
        <p className="text-sm text-muted">{t('factory.routes.none')}</p>
      </Window>
    );
  }

  const stationLabel = (s: StationFlow) => names.get(s.id) ?? s.id;

  return (
    <Window
      title={t('factory.routes.title')}
      subtitle={t('factory.routes.subtitle', { stations: routes.stations.length, vehicles: routes.vehicles.length, moved: fmt.rate(moved) })}
      bodyClassName="flex flex-col gap-4 py-3"
    >
      <section aria-labelledby="factory-stations" className="flex flex-col gap-1">
        <SectionHeading as="h3" id="factory-stations" className="px-3">{t('factory.routes.stations')}</SectionHeading>
        <table className={TABLE}>
          <thead className={THEAD}>
            <tr>
              <th scope="col" className={TH}>{t('factory.routes.station')}</th>
              <th scope="col" className={TH}>{t('factory.routes.mode')}</th>
              <th scope="col" className={`${TH} text-right`}>{t('factory.routes.vehicles')}</th>
              <th scope="col" className={`${TH} text-right`}>{t('factory.routes.perMin')}</th>
              <th scope="col" className={`${TH} text-right`}>{t('factory.routes.interval')}</th>
              <th scope="col" className={`${TH} text-right`}>{t('factory.routes.perDock')}</th>
              <th scope="col" className={TH}><span className="sr-only">{t('factory.showOnMap')}</span></th>
            </tr>
          </thead>
          <tbody className="max-sm:block">
            {routes.stations.map(s => {
              const perDock = mean(s.visits.map(v => v.itemsPerDock).filter((x): x is number => x !== null));
              const stacks = s.visits.find(v => v.capacityStacks !== null)?.capacityStacks ?? null;
              const label = stationLabel(s);
              return (
                <tr key={s.id} className={TR}>
                  <td className={TD_FIRST}>
                    <span className="flex items-center gap-2">
                      <Picture cls={labels.buildingPicture(s.cls)} px={24} />
                      <span className="min-w-0">
                        <span className="block font-medium">{label}</span>
                        {biomes.get(s.id) && <span className="block text-xs text-muted max-[899px]:text-sm">{t('factory.routes.near', { biome: biomes.get(s.id) })}</span>}
                      </span>
                      <span className="ml-auto sm:hidden"><ShowOnMap worldId={worldId} ids={[s.id]} label={label} compact /></span>
                    </span>
                  </td>
                  <td data-label={t('factory.routes.mode')} className={TD}><Mode loading={s.loading} /></td>
                  <td data-label={t('factory.routes.vehicles')} className={`${TD} text-right`} title={s.visits.map(v => vNames.get(v.vehicle) ?? v.vehicle).join(', ')}>
                    {fmt.int(s.visits.length)}
                  </td>
                  <td data-label={t('factory.routes.perMin')} className={`${TD} text-right`}>
                    <span className="font-display font-semibold">{s.itemsPerMin === null ? '–' : fmt.rate(s.itemsPerMin)}</span>
                  </td>
                  <td data-label={t('factory.routes.interval')} className={`${TD} text-right`}>{s.interval === null ? '–' : fmt.duration(s.interval)}</td>
                  <td data-label={t('factory.routes.perDock')} className={`${TD} text-right max-sm:col-span-2`}>
                    <span>
                      {perDock === null ? '–' : t('factory.routes.items', { value: fmt.int(Math.round(perDock)) })}
                      {stacks !== null && <span className="block text-xs text-muted max-sm:ml-2 max-sm:inline max-[899px]:text-sm">{t('factory.routes.hold', { stacks })}</span>}
                    </span>
                  </td>
                  <td className="px-2 py-1 text-right max-sm:hidden">
                    <ShowOnMap worldId={worldId} ids={[s.id]} label={label} compact />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      {routes.vehicles.length > 0 && (
        <section aria-labelledby="factory-vehicles" className="flex flex-col gap-1 px-3">
          <SectionHeading as="h3" id="factory-vehicles">{t('factory.routes.vehicleList')}</SectionHeading>
          <ul className="flex flex-col divide-y divide-line">
            {routes.vehicles.map(v => {
              const name = vNames.get(v.id) ?? v.id;
              return (
                <li key={v.id} className="flex flex-col gap-1.5 py-2">
                  <div className="flex items-center gap-3">
                    <Picture cls={labels.buildingPicture(v.cls)} px={24} />
                    <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="font-medium">{name}</span>
                      <Badge tone={v.autopilot ? 'success' : 'neutral'}>{t(v.autopilot ? 'factory.routes.autopilot' : 'factory.routes.manual')}</Badge>
                      {v.fuel && (
                        <span className="inline-flex items-center gap-1 text-sm text-muted" title={labels.item(v.fuel.item, lang)}>
                          <GameIcon cls={v.fuel.item} px={16} />
                          <span className="sr-only">{labels.item(v.fuel.item, lang)}</span>
                          <span className={v.fuel.amount === 0 ? 'text-conflict' : 'tabular-nums'}>
                            {v.fuel.amount === 0 ? t('factory.routes.noFuel') : t('factory.routes.fuel', { amount: v.fuel.amount ?? 0 })}
                          </span>
                        </span>
                      )}
                    </span>
                    <span className="shrink-0"><ShowOnMap worldId={worldId} ids={[v.id, ...new Set(v.stops.map(x => x.station))]} label={name} compact /></span>
                  </div>
                  {(v.roundTrip !== null || v.loadedPerMin !== null || v.unloadedPerMin !== null) && (
                    <p className="pl-11 text-sm text-muted tabular-nums">
                      {[
                        v.roundTrip !== null ? t('factory.routes.roundTrip', { time: fmt.duration(v.roundTrip) }) : null,
                        v.loadedPerMin !== null ? t('factory.routes.loads', { value: fmt.rate(v.loadedPerMin) }) : null,
                        v.unloadedPerMin !== null ? t('factory.routes.unloads', { value: fmt.rate(v.unloadedPerMin) }) : null,
                      ].filter(Boolean).join(' · ')}
                    </p>
                  )}
                  {v.stops.length > 0 ? (
                    <ol aria-label={t('factory.routes.stops', { name })} className="flex flex-wrap items-center gap-1 pl-11 text-sm">
                      {v.stops.map((stop, i) => {
                        const st = byId.get(stop.station);
                        return (
                          <li key={i} className="inline-flex items-center gap-1">
                            {i > 0 && <span aria-hidden="true" className="text-muted">→</span>}
                            <span className="inline-flex items-center gap-1 chamfer border border-line bg-bg px-1.5 py-0.5">
                              <span className="font-display text-xs text-muted">{i + 1}</span>
                              {st ? stationLabel(st) : t('factory.routes.unknownStop')}
                              {stop.loading !== null && (
                                <span className={stop.loading ? 'text-free' : 'text-accent'} title={t(stop.loading ? 'factory.routes.loading' : 'factory.routes.unloading')}>
                                  <span aria-hidden="true">{stop.loading ? '↑' : '↓'}</span>
                                  <span className="sr-only">{t(stop.loading ? 'factory.routes.loading' : 'factory.routes.unloading')}</span>
                                </span>
                              )}
                            </span>
                          </li>
                        );
                      })}
                    </ol>
                  ) : (
                    <p className="pl-11 text-sm text-muted">{t('factory.routes.noRoute')}</p>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </Window>
  );
}
