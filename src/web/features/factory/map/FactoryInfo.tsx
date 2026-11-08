import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { MachineFlow } from '../../../../shared/factory/analysis.js';
import { UNITS_PER_METER } from '../../../../shared/geo.js';
import type { WorldCtx } from '../../../app/feature.js';
import { Badge } from '../../../components/Badge.js';
import { SectionHeading } from '../../../components/SectionHeading.js';
import { StatList, StatRow } from '../../../components/StatRow.js';
import { Window } from '../../../components/Window.js';
import { GameIcon, IconsContext, useItemIcons } from '../../machineWiki/icons.js';
import type { FactoryLabels } from '../data.js';
import { useFactoryFormat, type FactoryFormat } from '../format.js';
import { ProductivityBar, ReasonBadge } from '../parts.js';
import { useMapData, type MapData } from './mapData.js';
import { buildingName, langOf, stationName, vehicleName, type Lang } from './names.js';
import type { Scene, SceneBuilding, SceneStation, SceneVehicle } from './scene.js';
import { productivityOf } from './style.js';
import { useFactoryMap } from './useFactoryMap.js';

/**
 * The selected building, station or vehicle of the factory map, as a window over the right of the map like the item
 * panel (on phones over the top): name and picture, then what the game's machine window would show, in the factory
 * page's words and figures. A machine: productivity (bar and band), its reasons, recipe, clock speed, Power Shards,
 * Somersloops and what it makes and loses per minute. A station: mode, items per minute, the time between docks and
 * its vehicles. A vehicle: autopilot, fuel, what it moves and its route (drawn on the map). With changes marked,
 * whether it is new and how its productivity changed. Esc or × closes it.
 */
export function FactoryInfo({ ctx }: { ctx: WorldCtx }) {
  const visible = useFactoryMap(s => s.visible);
  const selection = useFactoryMap(s => s.selection);
  return visible && selection ? <InfoWindow ctx={ctx} /> : null;
}

function InfoWindow({ ctx }: { ctx: WorldCtx }) {
  const { t, i18n } = useTranslation();
  const lang = langOf(i18n.language);
  const selection = useFactoryMap(s => s.selection)!;
  const version = ctx.me.datasetVersion;
  const data = useMapData(ctx.worldId, version, ctx.index.ds.bounds, true);
  const icons = useItemIcons(version);
  const fmt = useFactoryFormat();
  const scene = data.scene;
  if (!scene) return null;
  const close = () => useFactoryMap.getState().select(null);

  let title: string;
  let icon: string | undefined;
  let body: ReactNode;
  let pos: { x: number; y: number; z: number };
  let kindName: string;
  if (selection.kind === 'vehicle') {
    const v = scene.vehicleById.get(selection.id);
    if (!v) return null;
    title = vehicleName(scene, v.v.id, lang);
    icon = v.entry?.icon;
    pos = v.v;
    kindName = t('factoryMap.vehicle.kind');
    body = <VehicleBody v={v} scene={scene} lang={lang} fmt={fmt} labels={data.labels} />;
  } else {
    const sb = scene.byId.get(selection.id);
    if (!sb) return null;
    const st = scene.stationById.get(selection.id);
    title = st ? stationName(scene, st.s.id, lang) : buildingName(sb.entry, sb.b.cls, lang);
    icon = sb.entry?.icon;
    pos = sb.b;
    kindName = t(`factoryMap.kinds.${sb.kind}`);
    body = st ? <StationBody st={st} scene={scene} lang={lang} fmt={fmt} /> : <BuildingBody sb={sb} data={data} fmt={fmt} />;
  }
  const m = new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 0 });
  return (
    <IconsContext.Provider value={icons}>
      <Window
        as="aside"
        title={title}
        subtitle={kindName}
        icon={icon ? <GameIcon cls={icon} px={40} placeholder /> : undefined}
        onClose={close}
        closeLabel={t('factoryMap.info.close')}
        className="ficsmap-factory-info pointer-events-auto absolute top-2 right-2 z-[1001] max-h-[calc(100%-1rem)] w-[340px] max-[899px]:inset-x-2 max-[899px]:max-h-[45%] max-[899px]:w-auto"
        bodyClassName="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain p-3"
        footer={(
          <span className="font-display text-sm font-semibold tracking-wide tabular-nums">
            {t('item.coords', { x: m.format(pos.x / UNITS_PER_METER), y: m.format(pos.y / UNITS_PER_METER), z: m.format(pos.z / UNITS_PER_METER) })}
          </span>
        )}
      >
        {body}
      </Window>
    </IconsContext.Provider>
  );
}

function BuildingBody({ sb, data, fmt }: { sb: SceneBuilding; data: MapData; fmt: FactoryFormat }) {
  const { t } = useTranslation();
  const prod = sb.b.prod;
  const flow: MachineFlow | undefined = data.current?.analysis.byId.get(sb.b.id);
  const isNew = data.diff?.added.includes(sb.b.id) ?? false;
  const change = data.diff ? [...data.diff.better, ...data.diff.worse].find(c => c.id === sb.b.id) : undefined;
  const compareDate = data.compare ? fmt.date(data.compare.meta.saveTime) : '';
  const labels = data.labels;
  const productivity = prod ? productivityOf(prod) : 0;
  return (
    <>
      {(isNew || change) && (
        <div className="flex flex-wrap gap-2" data-testid="factory-info-change">
          {isNew && <Badge tone="success">{t('factoryMap.info.newSince', { date: compareDate })}</Badge>}
          {change && (
            <Badge tone={change.delta > 0 ? 'success' : 'danger'}>
              {t('factoryMap.info.change', { before: fmt.pct(change.before), delta: fmt.pctDelta(change.delta) })}
            </Badge>
          )}
        </div>
      )}
      {prod && sb.band && (
        <section aria-label={t('factoryMap.info.production')} className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2 text-sm">
            <span className="text-muted">{t('factoryMap.info.productivity')}</span>
            <ProductivityBar value={productivity} band={sb.band} fmt={fmt} />
          </div>
          <p className="text-xs text-muted">
            {t(`factory.band.${sb.band}`)}
            {prod.productivity === undefined && ` · ${t('factoryMap.noMeasurement')}`}
          </p>
          {sb.reasons.length > 0 && (
            <div className="flex flex-wrap gap-1.5" data-testid="factory-reasons">
              {sb.reasons.map(r => <ReasonBadge key={r} reason={r} />)}
            </div>
          )}
          <StatList>
            {prod.recipe && <StatRow label={t('factoryMap.info.recipe')} value={recipeName(data, prod.recipe, fmt.lang)} />}
            <StatRow label={t('factoryMap.info.clock')} value={fmt.pct(prod.clock)} />
            {(prod.powerShards ?? 0) > 0 && <StatRow label={t('factoryMap.info.shards')} value={fmt.int(prod.powerShards ?? 0)} />}
            {(prod.somersloops ?? 0) > 0 && <StatRow label={t('factoryMap.info.somersloops')} value={fmt.int(prod.somersloops ?? 0)} />}
            {flow?.power && <StatRow label={t('factoryMap.info.power')} value={t('factoryMap.info.actualOf', { actual: fmt.mw(flow.power.actual), at: fmt.mw(flow.power.nominal) })} />}
          </StatList>
          {flow && flow.outputs.length > 0 && labels && (
            <div>
              <SectionHeading as="h3">{t('factoryMap.info.output')}</SectionHeading>
              <StatList>
                {flow.outputs.map(o => (
                  <StatRow
                    key={o.item}
                    icon={<GameIcon cls={o.item} px={20} placeholder />}
                    label={labels.item(o.item, fmt.lang)}
                    hint={o.lost > 0.05 ? t('factoryMap.info.lost', { rate: fmt.rate(o.lost, labels.isFluid(o.item)) }) : undefined}
                    value={t('factoryMap.info.actualOf', { actual: fmt.rate(o.actual, labels.isFluid(o.item)), at: fmt.rate(o.nominal, labels.isFluid(o.item)) })}
                    tone={o.lost > 0.05 ? 'danger' : 'default'}
                  />
                ))}
              </StatList>
            </div>
          )}
        </section>
      )}
      {sb.b.node && <p className="text-sm text-muted">{t('factoryMap.info.onNode')}</p>}
      {sb.b.texts && sb.b.texts.length > 0 && (
        <div>
          <SectionHeading as="h3">{t('factoryMap.info.signText')}</SectionHeading>
          {sb.b.texts.map((x, i) => <p key={i} className="text-sm [overflow-wrap:anywhere]">{x}</p>)}
        </div>
      )}
    </>
  );
}

function recipeName(data: MapData, recipe: string, lang: Lang): string {
  return data.recipes?.recipes.get(recipe)?.name[lang] ?? recipe;
}

function StationBody({ st, scene, lang, fmt }: { st: SceneStation; scene: Scene; lang: Lang; fmt: FactoryFormat }) {
  const { t } = useTranslation();
  const flow = st.flow;
  const select = (id: string) => useFactoryMap.getState().select({ kind: 'vehicle', id });
  return (
    <>
      <StatList>
        <StatRow label={t('factoryMap.station.mode')} value={t(st.s.loading === false ? 'factoryMap.station.unloading' : 'factoryMap.station.loading')} />
        <StatRow label={t('factoryMap.station.throughput')} value={fmt.rate(flow.itemsPerMin ?? 0)} tone={st.state === 'empty' ? 'danger' : 'default'} />
        {flow.interval !== null && <StatRow label={t('factoryMap.station.interval')} value={t('factoryMap.station.every', { time: fmt.duration(flow.interval) })} />}
      </StatList>
      <p className="text-sm text-muted" data-testid="station-state">{t(`factoryMap.station.state.${st.state}`)}</p>
      {flow.visits.length > 0 && (
        <div>
          <SectionHeading as="h3">{t('factoryMap.station.vehicles', { count: flow.visits.length })}</SectionHeading>
          <ul className="flex flex-col">
            {flow.visits.map(v => (
              <li key={v.vehicle}>
                <button type="button" onClick={() => select(v.vehicle)} className="flex w-full items-baseline justify-between gap-2 chamfer px-1 py-1 text-left text-sm focus-ring hover:bg-raised">
                  <span className="min-w-0 truncate">{vehicleName(scene, v.vehicle, lang)}</span>
                  <span className="shrink-0 text-muted tabular-nums">
                    {t('factoryMap.station.vehicleRow', {
                      rate: fmt.rate(v.itemsPerMin ?? 0), perDock: fmt.int(Math.round(v.itemsPerDock ?? 0)),
                      time: v.interval === null ? '–' : fmt.duration(v.interval),
                    })}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

function VehicleBody({ v, scene, lang, fmt, labels }: { v: SceneVehicle; scene: Scene; lang: Lang; fmt: FactoryFormat; labels: FactoryLabels | undefined }) {
  const { t } = useTranslation();
  const flow = v.flow;
  const fuel = v.v.fuel;
  const select = (id: string) => useFactoryMap.getState().select({ kind: 'building', id });
  return (
    <>
      <StatList>
        <StatRow label={t('factoryMap.vehicle.autopilot')} value={t(v.v.autopilot ? 'factoryMap.vehicle.on' : 'factoryMap.vehicle.off')} tone={v.v.autopilot ? 'success' : 'muted'} />
        {fuel && (
          <StatRow
            label={t('factoryMap.vehicle.fuel')}
            icon={<GameIcon cls={fuel.item} px={20} placeholder />}
            value={`${labels?.item(fuel.item, lang) ?? fuel.item} × ${fmt.int(fuel.amount ?? 0)}`}
            tone={(fuel.amount ?? 0) <= 0 ? 'danger' : 'default'}
          />
        )}
        {flow.loadedPerMin !== null && <StatRow label={t('factoryMap.vehicle.loads')} value={fmt.rate(flow.loadedPerMin)} />}
        {flow.unloadedPerMin !== null && <StatRow label={t('factoryMap.vehicle.unloads')} value={fmt.rate(flow.unloadedPerMin)} />}
        {flow.roundTrip !== null && <StatRow label={t('factoryMap.vehicle.roundTrip')} value={fmt.duration(flow.roundTrip)} />}
      </StatList>
      <div>
        <SectionHeading as="h3">{t('factoryMap.vehicle.route', { count: v.v.route.length })}</SectionHeading>
        {v.v.route.length === 0 ? <p className="text-sm text-muted">{t('factoryMap.vehicle.noRoute')}</p> : (
          <ol className="flex flex-col">
            {flow.stops.map((stop, i) => (
              <li key={`${stop.station}-${i}`}>
                <button type="button" onClick={() => select(stop.station)} className="flex w-full items-baseline gap-2 chamfer px-1 py-1 text-left text-sm focus-ring hover:bg-raised">
                  <span className="w-5 shrink-0 font-display font-semibold text-accent tabular-nums">{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate">{stationName(scene, stop.station, lang)}</span>
                  <span className="shrink-0 text-muted tabular-nums">
                    {stop.loading === false ? '↓' : '↑'} {stop.visit?.itemsPerMin != null ? fmt.rate(stop.visit.itemsPerMin) : ''}
                  </span>
                </button>
              </li>
            ))}
          </ol>
        )}
      </div>
    </>
  );
}
