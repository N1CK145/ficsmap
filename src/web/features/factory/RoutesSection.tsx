import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { AnalysisData, FactoryAnalysis, RouteAnalysis, StationFlow, StationProblem } from '../../../shared/factory/analysis.js';
import { stationConsumers, type ProductionLines, type StationConsumers } from '../../../shared/factory/lines.js';
import type { SnapshotCargo } from '../../../shared/factory/snapshot.js';
import type { DatasetIndex } from '../../../shared/dataset.js';
import { Badge } from '../../components/Badge.js';
import { SectionHeading } from '../../components/SectionHeading.js';
import { Window } from '../../components/Window.js';
import { GameIcon } from '../machineWiki/icons.js';
import { Picture } from '../planner/pictures.js';
import type { FactoryLabels } from './data.js';
import { nearestBiome, stationNames, vehicleNames, type FactoryFormat } from './format.js';
import { Cell, NONE, ShowOnMap, TABLE, TD, TD_FIRST, TH, THEAD, TR } from './parts.js';

const mean = (xs: number[]) => (xs.length > 0 ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
/** Pictures of a cargo shown before "+n". */
const CARGO_PICTURES = 3;

/** Loading ↑ / unloading ↓ as arrow and word. */
function Mode({ loading }: { loading: boolean | null }) {
  const { t } = useTranslation();
  if (loading === null) return <span className="text-muted">{NONE}</span>;
  return (
    <span className="inline-flex items-center gap-1">
      <span aria-hidden="true" className={loading ? 'text-free' : 'text-accent'}>{loading ? '↑' : '↓'}</span>
      {t(loading ? 'factory.routes.loading' : 'factory.routes.unloading')}
    </span>
  );
}

/** What lies in a station or vehicle: the first pictures with the names as tooltip and for screen readers. */
function Cargo({ cargo, labels, fmt, counts = false }: { cargo: readonly SnapshotCargo[]; labels: FactoryLabels; fmt: FactoryFormat; counts?: boolean }) {
  const { t } = useTranslation();
  if (cargo.length === 0) return <span className="text-muted">{t('factory.routes.cargoNone')}</span>;
  const names = cargo.map(c => labels.item(c.item, fmt.lang));
  if (counts) {
    return (
      <span className="inline-flex flex-wrap items-center gap-x-2.5 gap-y-1">
        {cargo.map((c, i) => (
          <span key={c.item} className="inline-flex items-center gap-1 whitespace-nowrap tabular-nums">
            <GameIcon cls={c.item} px={16} />
            {names[i]} {fmt.int(labels.isFluid(c.item) ? Math.round(c.count / 1000) : c.count)}
          </span>
        ))}
      </span>
    );
  }
  const rest = cargo.length - CARGO_PICTURES;
  return (
    <span className="inline-flex items-center gap-1" title={names.join(', ')}>
      {cargo.slice(0, CARGO_PICTURES).map(c => <GameIcon key={c.item} cls={c.item} px={20} />)}
      {rest > 0 && <span className="text-xs text-muted">+{rest}</span>}
      <span className="sr-only">{names.join(', ')}</span>
    </span>
  );
}

/** How bad a station problem is, for the order and the badge: nothing moves first, hardly anything after. */
const PROBLEM_RANK: Record<StationProblem, number> = { nothingMoved: 0, noVehicles: 1, lowThroughput: 2 };

/** Problem stations first (nothing moved, no vehicle stops, hardly anything moved: `stationProblem`), then in the save's order. */
export function orderStations(stations: readonly StationFlow[]): StationFlow[] {
  const rank = (s: StationFlow) => (s.problem ? PROBLEM_RANK[s.problem] : 3);
  return stations.map((s, i) => ({ s, i })).sort((a, b) => rank(a.s) - rank(b.s) || a.i - b.i).map(x => x.s);
}

/**
 * "Stations and vehicles": the stations, problem ones first and marked (name or "Truck Station n" with the biome
 * nearby, loading or unloading, what lies in them, the vehicles that stop there, items per minute = items per dock /
 * time between docks, the time between two docks of any vehicle and per vehicle, items per stop with the hold and how
 * full it is), and the vehicles (autopilot, fuel by name, what they carry, round trip, loaded and unloaded per minute,
 * empty legs, their stops in order with items per minute). The save tracks each vehicle per station, so all rates are
 * the game's own averages.
 */
export function RoutesSection({ worldId, routes, labels, fmt, index, lines = null, analysis, data }: {
  worldId: string; routes: RouteAnalysis; labels: FactoryLabels; fmt: FactoryFormat; index: DatasetIndex;
  /** With the production lines: how the machines behind each unloading station run (`stationConsumers`). */
  lines?: ProductionLines | null; analysis?: FactoryAnalysis; data?: AnalysisData | null;
}) {
  const { t } = useTranslation();
  const lang = fmt.lang;
  const names = useMemo(() => stationNames(routes.stations, labels, lang), [routes, labels, lang]);
  const vNames = useMemo(() => vehicleNames(routes.vehicles, labels, lang), [routes, labels, lang]);
  const biomes = useMemo(() => new Map(routes.stations.map(s => [s.id, nearestBiome(index, s.x, s.y, lang)])), [routes, index, lang]);
  const byId = useMemo(() => new Map(routes.stations.map(s => [s.id, s])), [routes]);
  const ordered = useMemo(() => orderStations(routes.stations), [routes]);
  // Unloading stations: what their consumers make of it ("Abnehmer: 3 Mangel"), the worst item first.
  const consumers = useMemo(() => {
    const out = new Map<string, StationConsumers>();
    if (!lines || !analysis || !data) return out;
    for (const st of routes.stations) {
      if (st.loading !== false) continue;
      const items = [...new Set([...st.cargo.map(c => c.item), ...routes.vehicles.filter(v => v.stops.some(x => x.station === st.id)).flatMap(v => v.cargo.map(c => c.item))])];
      const c = stationConsumers(lines, analysis, data, st.id, items)[0];
      if (c) out.set(st.id, c);
    }
    return out;
  }, [routes, lines, analysis, data]);
  const moved = routes.stations.reduce((n, s) => n + (s.loading === false ? s.itemsPerMin ?? 0 : 0), 0);
  const problems = routes.stations.filter(s => s.problem !== null).length;

  if (routes.stations.length === 0 && routes.vehicles.length === 0) {
    return (
      <Window title={t('factory.routes.title')}>
        <p className="text-sm text-muted">{t('factory.routes.none')}</p>
      </Window>
    );
  }

  const stationLabel = (s: StationFlow) => names.get(s.id) ?? s.id;
  const cols = {
    mode: t('factory.routes.mode'), cargo: t('factory.routes.cargo'), vehicles: t('factory.routes.vehicles'), perMin: t('factory.routes.perMin'),
    interval: t('factory.routes.interval'), perDock: t('factory.routes.perDock'),
  };
  const subtitle = t('factory.routes.subtitle', { stations: routes.stations.length, vehicles: routes.vehicles.length, moved: fmt.rate(moved) })
    + (problems > 0 ? ` · ${t('factory.routes.problems', { count: problems })}` : '');

  return (
    <Window title={t('factory.routes.title')} subtitle={subtitle} bodyClassName="flex flex-col gap-4 py-3">
      <section aria-labelledby="factory-stations" className="flex flex-col gap-1">
        <SectionHeading as="h3" id="factory-stations" className="px-3">{t('factory.routes.stations')}</SectionHeading>
        <table role="table" className={TABLE}>
          <thead role="rowgroup" className={THEAD}>
            <tr role="row">
              <th role="columnheader" scope="col" className={TH}>{t('factory.routes.station')}</th>
              <th role="columnheader" scope="col" className={TH}>{cols.mode}</th>
              <th role="columnheader" scope="col" className={TH}>{cols.cargo}</th>
              <th role="columnheader" scope="col" className={`${TH} text-right`}>{cols.vehicles}</th>
              <th role="columnheader" scope="col" className={`${TH} text-right`}>{cols.perMin}</th>
              <th role="columnheader" scope="col" className={`${TH} text-right`} title={t('factory.routes.intervalHint')}>{cols.interval}</th>
              <th role="columnheader" scope="col" className={`${TH} text-right`}>{cols.perDock}</th>
              <th role="columnheader" scope="col" className={TH}><span className="sr-only">{t('factory.showOnMap')}</span></th>
            </tr>
          </thead>
          <tbody role="rowgroup" className="max-sm:block">
            {ordered.map(s => {
              const perDock = mean(s.visits.map(v => v.itemsPerDock).filter((x): x is number => x !== null));
              const stacks = s.visits.find(v => v.capacityStacks !== null)?.capacityStacks ?? null;
              const label = stationLabel(s);
              const cons = consumers.get(s.id);
              const severe = s.problem === 'nothingMoved' || s.problem === 'noVehicles';
              return (
                <tr role="row" key={s.id} className={`${TR} ${s.problem ? `border-l-2 ${severe ? 'border-l-conflict' : 'border-l-accent'}` : ''}`}>
                  <Cell className={TD_FIRST}>
                    <span className="flex items-center gap-2">
                      <Picture cls={labels.buildingPicture(s.cls)} px={24} />
                      <span className="min-w-0">
                        <span className="block font-medium">{label}</span>
                        {biomes.get(s.id) && <span className="block text-xs text-muted max-[899px]:text-sm">{t('factory.routes.near', { biome: biomes.get(s.id) })}</span>}
                        {s.problem && <Badge tone={severe ? 'danger' : 'accent'} className="mt-0.5">{t(`factory.routes.problem.${s.problem}`)}</Badge>}
                        {cons && (
                          <span className={`mt-0.5 flex items-center gap-1 text-xs max-[899px]:text-sm ${cons.starving > 0 ? 'font-medium text-conflict' : 'text-muted'}`}>
                            <GameIcon cls={cons.item} px={14} />
                            {cons.starving > 0
                              ? t('factory.routes.consumersShort', { count: cons.starving, total: cons.consumers })
                              : t('factory.routes.consumersFine', { count: cons.consumers })}
                          </span>
                        )}
                      </span>
                      <span className="ml-auto sm:hidden"><ShowOnMap worldId={worldId} ids={[s.id]} label={label} compact /></span>
                    </span>
                  </Cell>
                  <Cell label={cols.mode}><Mode loading={s.loading} /></Cell>
                  <Cell label={cols.cargo}><Cargo cargo={s.cargo} labels={labels} fmt={fmt} /></Cell>
                  <Cell label={cols.vehicles} className={`${TD} text-right`}>
                    <span title={s.visits.map(v => vNames.get(v.vehicle) ?? v.vehicle).join(', ')}>{fmt.int(s.visits.length)}</span>
                  </Cell>
                  <Cell label={cols.perMin} className={`${TD} text-right`}>
                    {s.itemsPerMin === null ? <span className="text-muted">{NONE}</span> : (
                      <span className={`font-display font-semibold ${s.itemsPerMin === 0 ? 'text-conflict' : ''}`}>{fmt.rate(s.itemsPerMin)}</span>
                    )}
                  </Cell>
                  <Cell label={cols.interval} className={`${TD} text-right`}>
                    <span className={`block ${s.combinedInterval === null ? 'text-muted' : ''}`}>{s.combinedInterval === null ? NONE : fmt.duration(s.combinedInterval)}</span>
                    {s.visits.length > 1 && s.interval !== null && (
                      <span className="block text-xs text-muted max-[899px]:text-sm">{t('factory.routes.intervalEach', { time: fmt.duration(s.interval) })}</span>
                    )}
                  </Cell>
                  <Cell label={cols.perDock} className={`${TD} text-right max-sm:col-span-2`}>
                    <span className={`block ${perDock === null ? 'text-muted' : ''}`}>{perDock === null ? NONE : t('factory.routes.items', { value: fmt.int(Math.round(perDock)) })}</span>
                    {stacks !== null && <span className="block text-xs text-muted max-[899px]:text-sm">{t('factory.routes.hold', { stacks })}</span>}
                    {/* The fill on every station, "–" where no visit tells. */}
                    <span className="block text-xs text-muted max-[899px]:text-sm" title={t('factory.routes.fillHint')}>
                      {s.fill === null ? t('factory.routes.fill', { value: NONE }) : t(s.fillApprox ? 'factory.routes.fillApprox' : 'factory.routes.fill', { value: fmt.pct(s.fill) })}
                    </span>
                  </Cell>
                  <Cell className="px-2 py-1 text-right max-sm:hidden">
                    <ShowOnMap worldId={worldId} ids={[s.id]} label={label} compact />
                  </Cell>
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
              const fuelName = v.fuel ? labels.item(v.fuel.item, lang) : null;
              return (
                <li key={v.id} className="flex flex-col gap-1.5 py-2">
                  <div className="flex items-center gap-3">
                    <Picture cls={labels.buildingPicture(v.cls)} px={24} />
                    <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="font-medium">{name}</span>
                      <Badge tone={v.autopilot ? 'success' : 'neutral'}>{t(v.autopilot ? 'factory.routes.autopilot' : 'factory.routes.manual')}</Badge>
                      {v.fuel && fuelName && (
                        <span className="inline-flex items-center gap-1 text-sm text-muted">
                          <GameIcon cls={v.fuel.item} px={16} />
                          <span className={v.fuel.amount === 0 ? 'text-conflict' : 'tabular-nums'}>
                            {v.fuel.amount === 0
                              ? t('factory.routes.noFuelNamed', { fuel: fuelName })
                              : t('factory.routes.fuelNamed', { fuel: fuelName, amount: v.fuel.amount ?? 0 })}
                          </span>
                        </span>
                      )}
                    </span>
                    <span className="shrink-0"><ShowOnMap worldId={worldId} ids={[v.id, ...new Set(v.stops.map(x => x.station))]} label={name} compact /></span>
                  </div>
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-1 pl-11 text-sm">
                    <span className="text-muted">{t('factory.routes.carries')}:</span>
                    <Cargo cargo={v.cargo} labels={labels} fmt={fmt} counts />
                  </p>
                  {(v.roundTrip !== null || v.loadedPerMin !== null || v.unloadedPerMin !== null) && (
                    <p className="pl-11 text-sm text-muted tabular-nums">
                      {[
                        v.roundTrip !== null ? t('factory.routes.roundTrip', { time: fmt.duration(v.roundTrip) }) : null,
                        v.loadedPerMin !== null ? t('factory.routes.loads', { value: fmt.rate(v.loadedPerMin) }) : null,
                        v.unloadedPerMin !== null ? t('factory.routes.unloads', { value: fmt.rate(v.unloadedPerMin) }) : null,
                      ].filter(Boolean).join(' · ')}
                    </p>
                  )}
                  {v.emptyLegs.length > 0 && (
                    <p className="pl-11 text-sm font-medium text-conflict">
                      {t('factory.routes.emptyLegs', { stations: v.emptyLegs.map(id => (byId.get(id) ? stationLabel(byId.get(id)!) : id)).join(', ') })}
                    </p>
                  )}
                  {/* Is it enough? Unloading stops whose consumers starve for what it brings. */}
                  {[...new Set(v.stops.filter(x => x.loading === false && (consumers.get(x.station)?.starving ?? 0) > 0).map(x => x.station))].map(id => {
                    const c = consumers.get(id)!;
                    return (
                      <p key={id} className="pl-11 text-sm font-medium text-conflict">
                        {t('factory.routes.notEnough', { station: byId.get(id) ? stationLabel(byId.get(id)!) : id, item: labels.item(c.item, lang), count: c.starving })}
                      </p>
                    );
                  })}
                  {v.stops.length > 0 ? (
                    <ol aria-label={t('factory.routes.stops', { name })} className="flex flex-wrap items-center gap-1 pl-11 text-sm">
                      {v.stops.map((stop, i) => {
                        const st = byId.get(stop.station);
                        // A station visited again: the station tracks the vehicle once, its figures stand at the first stop.
                        const rate = stop.repeat ? null : stop.visit?.itemsPerMin ?? null;
                        const hungry = stop.loading === false && (consumers.get(stop.station)?.starving ?? 0) > 0;
                        return (
                          <li key={i} className="inline-flex items-center gap-1">
                            {i > 0 && <span aria-hidden="true" className="text-muted">→</span>}
                            <span className={`inline-flex items-center gap-1 chamfer border bg-bg px-1.5 py-0.5 ${stop.visit?.empty || hungry ? 'border-conflict' : 'border-line'}`}>
                              <span className="font-display text-xs text-muted">{i + 1}</span>
                              {st ? stationLabel(st) : t('factory.routes.unknownStop')}
                              {stop.loading !== null && (
                                <span className={stop.loading ? 'text-free' : 'text-accent'} title={t(stop.loading ? 'factory.routes.loading' : 'factory.routes.unloading')}>
                                  <span aria-hidden="true">{stop.loading ? '↑' : '↓'}</span>
                                  <span className="sr-only">{t(stop.loading ? 'factory.routes.loading' : 'factory.routes.unloading')}</span>
                                </span>
                              )}
                              {rate !== null && <span className={`text-xs tabular-nums ${rate === 0 ? 'text-conflict' : 'text-muted'}`}>{fmt.rate(rate)}</span>}
                              {stop.repeat && <span className="text-xs text-muted">{t('factory.routes.repeat', { n: stop.repeat })}</span>}
                              {hungry && <span className="text-xs font-medium text-conflict">{t('factory.routes.stopShort')}</span>}
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
