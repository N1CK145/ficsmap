import { useEffect, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { MachineFlow, MachineHint } from '../../../../shared/factory/analysis.js';
import type { SnapshotCargo } from '../../../../shared/factory/snapshot.js';
import type { WorldCtx } from '../../../app/feature.js';
import { Badge } from '../../../components/Badge.js';
import { SectionHeading } from '../../../components/SectionHeading.js';
import { StatList, StatRow } from '../../../components/StatRow.js';
import { Window } from '../../../components/Window.js';
import { GameIcon, IconsContext, useItemIcons } from '../../machineWiki/icons.js';
import type { FactoryLabels } from '../data.js';
import { useFactoryFormat, type FactoryFormat } from '../format.js';
import { ProductivityBar, ReasonBadge, stateKey } from '../parts.js';
import { useMapData, type MapData } from './mapData.js';
import { buildingName, langOf, stationName, vehicleName, type Lang } from './names.js';
import type { Scene, SceneBuilding, SceneStation, SceneVehicle } from './scene.js';
import { productivityOf } from './style.js';
import { useFactoryMap } from './useFactoryMap.js';

/** A row button in the info window's lists: at least 44 px high (a touch target), its text on up to two lines. */
const LIST_BASE = 'flex min-h-11 w-full chamfer px-1 py-1 text-left text-sm focus-ring hover:bg-raised';
const LIST_BUTTON = `${LIST_BASE} flex-col justify-center`;
const LIST_ROW = `${LIST_BASE} items-center gap-2`;

/**
 * The selected building, station or vehicle of the factory map, as a window over the right of the map like the item
 * panel (on phones as a sheet at the bottom; the map pans the building clear of it): name and picture, then what the
 * game's machine window would show, in the factory page's words and figures. A machine: productivity, what it makes
 * and loses per minute, its state and reasons, the node's purity, the belt at its output and the page's hints, recipe,
 * clock speed, Power Shards, Somersloops. A station: mode, items per minute, the time between docks, what lies in it
 * and its vehicles (how full they are). A vehicle: autopilot, fuel, what it moves and holds, empty legs and its route
 * (drawn on the map). With changes marked,
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
  const pendingFocus = useFactoryMap(s => s.pendingFocus);
  const version = ctx.me.datasetVersion;
  const data = useMapData(ctx.worldId, version, ctx.index.ds.bounds, true);
  const icons = useItemIcons(version);
  const fmt = useFactoryFormat();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const scene = data.scene;

  // Opened from a button: the focus moves to the title, so the window is announced and read from there.
  useEffect(() => {
    if (!pendingFocus || !titleRef.current) return;
    titleRef.current.focus();
    useFactoryMap.getState().focusHandled();
  }, [pendingFocus, selection, scene]);
  // Closed: the focus goes back to the button that opened it.
  useEffect(() => () => {
    const back = useFactoryMap.getState().returnFocus;
    useFactoryMap.setState({ returnFocus: null });
    if (back?.isConnected) back.focus();
  }, []);

  if (!scene) return null;
  const close = () => useFactoryMap.getState().select(null);

  let title: string;
  let icon: string | undefined;
  let body: ReactNode;
  let kindName: string;
  if (selection.kind === 'vehicle') {
    const v = scene.vehicleById.get(selection.id);
    if (!v) return null;
    title = vehicleName(scene, v.v.id, lang);
    icon = v.entry?.icon;
    kindName = t('factoryMap.vehicle.kind');
    body = <VehicleBody v={v} scene={scene} lang={lang} fmt={fmt} labels={data.labels} />;
  } else {
    const sb = scene.byId.get(selection.id);
    if (!sb) return null;
    const st = scene.stationById.get(selection.id);
    title = st ? stationName(scene, st.s.id, lang) : buildingName(sb.entry, sb.b.cls, lang);
    icon = sb.entry?.icon;
    kindName = st ? t('factoryMap.station.kind') : t(`factoryMap.kindShort.${sb.kind}`);
    body = st ? <StationBody st={st} scene={scene} lang={lang} fmt={fmt} labels={data.labels} /> : <BuildingBody sb={sb} data={data} fmt={fmt} />;
  }
  return (
    <IconsContext.Provider value={icons}>
      <Window
        as="aside"
        title={title}
        titleRef={titleRef}
        subtitle={kindName}
        icon={icon ? <GameIcon cls={icon} px={40} placeholder /> : undefined}
        onClose={close}
        closeLabel={t('factoryMap.info.close')}
        className="ficsmap-factory-info pointer-events-auto absolute top-2 right-2 z-[1001] max-h-[calc(100%-1rem)] w-[340px] max-[899px]:top-auto max-[899px]:right-2 max-[899px]:bottom-[136px] max-[899px]:left-2 max-[899px]:max-h-[min(60%,calc(100%-152px))] max-[899px]:w-auto"
        bodyClassName="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain p-3"
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
            <ProductivityBar value={productivity} band={sb.band} fmt={fmt} paused={sb.paused} />
          </div>
          {/* What it makes and loses, right under the bar: the answer to "how bad is it". */}
          {flow && flow.outputs.length > 0 && labels && (
            <StatList>
              {flow.outputs.map(o => {
                const fluid = labels.isFluid(o.item);
                const losing = o.lost > 0.05;
                return (
                  <StatRow
                    key={o.item}
                    icon={<GameIcon cls={o.item} px={20} placeholder />}
                    label={labels.item(o.item, fmt.lang)}
                    hint={losing ? <span className="text-conflict">{t('factoryMap.info.lost', { rate: fmt.rate(o.lost, fluid) })}</span> : undefined}
                    value={t('factoryMap.info.actualOfTarget', { actual: fmt.rate(o.actual, fluid), at: fmt.rate(o.nominal, fluid) })}
                    tone={losing ? 'danger' : 'default'}
                  />
                );
              })}
            </StatList>
          )}
          <p className="text-xs text-muted max-[899px]:text-sm">
            {t(stateKey(sb.paused ? 'paused' : sb.band))}
            {prod.productivity === undefined && ` · ${t('factoryMap.noMeasurement')}`}
          </p>
          {sb.reasons.length > 0 && (
            <div className="flex flex-wrap gap-1.5" data-testid="factory-reasons">
              {sb.reasons.map(r => <ReasonBadge key={r} reason={r} />)}
            </div>
          )}
          {/* The page's hints: the belt at an extractor's output, overclocking that brings nothing. */}
          {flow && flow.hints.length > 0 && labels && (
            <ul className="flex flex-col gap-1 text-sm" data-testid="factory-hints">
              {flow.hints.map(h => <li key={h.kind} className={HINT_TONE[h.kind]}>{hintText(h, labels, fmt, t)}</li>)}
            </ul>
          )}
          <StatList>
            {flow?.purity && <StatRow label={t('factoryMap.info.purity')} value={t(`resourceNodes.purity.${flow.purity}`)} />}
            {flow?.belt && labels && <StatRow label={t('factoryMap.info.belt')} value={t('factory.machine.belt', { belt: labels.building(flow.belt.cls, fmt.lang), rate: fmt.rate(flow.belt.rate) })} />}
            {prod.recipe && <StatRow label={t('factoryMap.info.recipe')} value={recipeName(data, prod.recipe, fmt.lang)} />}
            <StatRow label={t('factoryMap.info.clock')} value={fmt.pct(prod.clock)} />
            {(prod.powerShards ?? 0) > 0 && <StatRow label={t('factoryMap.info.shards')} value={fmt.int(prod.powerShards ?? 0)} />}
            {(prod.somersloops ?? 0) > 0 && <StatRow label={t('factoryMap.info.somersloops')} value={fmt.int(prod.somersloops ?? 0)} />}
            {flow?.power && <StatRow label={t('factoryMap.info.power')} value={t('factoryMap.info.actualOf', { actual: fmt.mw(flow.power.actual), at: fmt.mw(flow.power.nominal) })} />}
          </StatList>
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

const HINT_TONE: Record<MachineHint['kind'], string> = {
  beltLimits: 'text-accent', noBelt: 'text-accent', beltBehind: 'text-muted', overclockUseless: 'text-muted',
};

/** A hint in words, as the page says it ("Conveyor Belt Mk.2 limits it to 120.0/min"). */
function hintText(h: MachineHint, labels: FactoryLabels, fmt: FactoryFormat, t: (k: string, o?: Record<string, unknown>) => string): string {
  switch (h.kind) {
    case 'beltLimits': return t('factory.machine.hint.beltLimits', { belt: labels.building(h.belt, fmt.lang), rate: fmt.rate(h.rate) });
    case 'beltBehind': return t('factory.machine.hint.beltBehind', { belt: labels.building(h.belt, fmt.lang), rate: fmt.rate(h.rate) });
    case 'noBelt': return t('factory.machine.hint.noBelt');
    case 'overclockUseless': return t('factory.machine.hint.overclockUseless', { shards: h.shards });
  }
}

function recipeName(data: MapData, recipe: string, lang: Lang): string {
  return data.recipes?.recipes.get(recipe)?.name[lang] ?? recipe;
}

/** What lies in a station or vehicle: a picture and count per item ("Iron Plate × 1,200"), most first. */
function CargoRow({ label, cargo, labels, fmt }: { label: string; cargo: readonly SnapshotCargo[]; labels: FactoryLabels | undefined; fmt: FactoryFormat }) {
  const { t } = useTranslation();
  return (
    <StatRow
      label={label}
      value={cargo.length === 0 ? t('factory.routes.cargoNone') : (
        <span className="flex flex-col items-end gap-0.5">
          {cargo.slice(0, 3).map(c => (
            <span key={c.item} className="flex items-center gap-1.5">
              <GameIcon cls={c.item} px={20} placeholder />
              {`${labels?.item(c.item, fmt.lang) ?? c.item} × ${fmt.int(c.count)}`}
            </span>
          ))}
        </span>
      )}
      tone={cargo.length === 0 ? 'muted' : 'default'}
    />
  );
}

function StationBody({ st, scene, lang, fmt, labels }: { st: SceneStation; scene: Scene; lang: Lang; fmt: FactoryFormat; labels: FactoryLabels | undefined }) {
  const { t } = useTranslation();
  const flow = st.flow;
  const select = (id: string, opener: HTMLElement) => useFactoryMap.getState().select({ kind: 'vehicle', id }, { focus: true, opener });
  return (
    <>
      <StatList>
        <StatRow label={t('factoryMap.station.mode')} value={t(st.s.loading === false ? 'factoryMap.station.unloading' : 'factoryMap.station.loading')} />
        <StatRow label={t('factoryMap.station.throughput')} value={fmt.rate(flow.itemsPerMin ?? 0)} tone={st.state !== 'active' ? 'danger' : 'default'} />
        {(flow.combinedInterval ?? flow.interval) !== null && (
          <StatRow label={t('factoryMap.station.interval')} value={t('factoryMap.station.every', { time: fmt.duration((flow.combinedInterval ?? flow.interval)!) })} />
        )}
        {flow.cargo && <CargoRow label={t('factoryMap.station.cargo')} cargo={flow.cargo} labels={labels} fmt={fmt} />}
      </StatList>
      <p className={`text-sm ${st.state === 'active' ? 'text-muted' : 'text-conflict'}`} data-testid="station-state">{t(`factoryMap.station.state.${st.state}`)}</p>
      {flow.visits.length > 0 && (
        <div>
          <SectionHeading as="h3">{t('factoryMap.station.vehicles', { count: flow.visits.length })}</SectionHeading>
          <ul className="flex flex-col">
            {flow.visits.map(v => (
              <li key={v.vehicle}>
                <button type="button" onClick={e => select(v.vehicle, e.currentTarget)} className={LIST_BUTTON}>
                  <span className="[overflow-wrap:anywhere]">{vehicleName(scene, v.vehicle, lang)}</span>
                  <span className={`text-xs tabular-nums max-[899px]:text-sm ${v.empty ? 'text-conflict' : 'text-muted'}`}>
                    {t('factoryMap.station.vehicleRow', {
                      rate: fmt.rate(v.itemsPerMin ?? 0), perDock: fmt.int(Math.round(v.itemsPerDock ?? 0)),
                      time: v.interval === null ? '–' : fmt.duration(v.interval),
                    })}
                    {v.fill != null && ` · ${t(v.fillApprox ? 'factory.routes.fillApprox' : 'factory.routes.fill', { value: fmt.pct(v.fill) })}`}
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
  const select = (id: string, opener: HTMLElement) => useFactoryMap.getState().select({ kind: 'building', id }, { focus: true, opener });
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
        {flow.cargo && <CargoRow label={t('factoryMap.vehicle.cargo')} cargo={flow.cargo} labels={labels} fmt={fmt} />}
      </StatList>
      {flow.emptyLegs && flow.emptyLegs.length > 0 && (
        <p className="text-sm text-conflict">{t('factory.routes.emptyLegs', { stations: flow.emptyLegs.map(id => stationName(scene, id, lang)).join(', ') })}</p>
      )}
      <div>
        <SectionHeading as="h3">{t('factoryMap.vehicle.route', { count: v.v.route.length })}</SectionHeading>
        {v.v.route.length === 0 ? <p className="text-sm text-muted">{t('factoryMap.vehicle.noRoute')}</p> : (
          <ol className="flex flex-col">
            {flow.stops.map((stop, i) => (
              <li key={`${stop.station}-${i}`}>
                <button type="button" onClick={e => select(stop.station, e.currentTarget)} className={LIST_ROW}>
                  <span className="w-5 shrink-0 font-display font-semibold tabular-nums">{i + 1}</span>
                  <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{stationName(scene, stop.station, lang)}</span>
                  <span className={`shrink-0 tabular-nums ${stop.visit && (stop.visit.itemsPerMin ?? 0) <= 0 ? 'text-conflict' : 'text-muted'}`}>
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
