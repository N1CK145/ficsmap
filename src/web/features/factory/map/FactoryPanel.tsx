import { useId, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../../components/Button.js';
import { Fold } from '../../../components/Fold.js';
import { SegmentedControl } from '../../../components/SegmentedControl.js';
import { useDataset } from '../../map/useDataset.js';
import { useMe, useWorld } from '../../worlds/queries.js';
import { useFactoryView } from '../view.js';
import { ReasonIcon } from '../icons.js';
import { useTimeline } from '../timeline.js';
import { useMapData } from './mapData.js';
import { langOf, stationName, vehicleName } from './names.js';
import { BandSwatch, KIND_BG } from './ProdParts.js';
import type { Scene } from './scene.js';
import { BANDS, REASONS, type Band, type Reason } from '../../../../shared/factory/analysis.js';
import { canAdmin } from '../../../../shared/roles.js';
import { stateKey } from '../parts.js';
import { bandLook, MAP_KINDS, type MapKind } from './style.js';
import { EmptyFactory } from './Timeline.js';
import { LinesSection } from './LinesSection.js';
import { FACTORY_LAYERS, useFactoryMap, type ColorMode } from './useFactoryMap.js';
import { HeightSlider } from './HeightSlider.js';
import { useHeight } from './useHeight.js';

/** A row of the panel's lists: 32 px, 44 px (a touch target) below 900 px. */
const ROW = 'flex h-8 w-full items-center gap-2 chamfer px-2 text-left text-sm select-none focus-ring hover:bg-raised max-[899px]:h-11';

interface Legend {
  kinds: Map<MapKind, string[]>;
  /** Machines per band, paused ones apart. */
  bands: Map<Band, string[]>;
  paused: string[];
  reasons: Map<Reason, string[]>;
}

/** Building ids per map kind, per productivity band (machines only; paused ones counted apart) and per reason. */
export function legendOf(scene: Scene): Legend {
  const l: Legend = { kinds: new Map(), bands: new Map(), paused: [], reasons: new Map() };
  const add = <K,>(m: Map<K, string[]>, k: K, id: string) => (m.get(k) ?? m.set(k, []).get(k)!).push(id);
  for (const sb of scene.buildings) {
    add(l.kinds, sb.kind, sb.b.id);
    if (sb.paused && sb.band) l.paused.push(sb.b.id);
    else if (sb.band) add(l.bands, sb.band, sb.b.id);
    for (const r of sb.reasons) add(l.reasons, r, sb.b.id);
  }
  return l;
}

/**
 * The legend's reasons: the analysis's list, then any reason the scene has that the list does not know yet. "Paused"
 * is a state of its own in the band list, so it is not repeated here.
 */
function reasonOrder(legend: Legend): Reason[] {
  const all = [...REASONS, ...[...legend.reasons.keys()].filter(r => !(REASONS as readonly Reason[]).includes(r))];
  return legend.paused.length > 0 ? all.filter(r => r !== 'paused') : all;
}

/**
 * The Factory panel: the factory layers' switch, the colour mode with its legend (counts; a click on a productivity
 * band or a reason outlines those machines on the map and fits to them), the production lines (`LinesSection`), the
 * layers one by one, and the stations and vehicles as lists (a click selects and shows one). Without snapshots it
 * explains how to get them.
 */
export function FactoryPanel({ worldId }: { worldId: string }) {
  const { t } = useTranslation();
  const version = useMe().data?.datasetVersion;
  const world = useWorld(worldId).data;
  // Owner or admin: may import (the empty state and missing lines offer the import dialog).
  const owner = world ? canAdmin(world.role) : false;
  const visible = useFactoryMap(s => s.visible);
  const toggle = useFactoryMap(s => s.toggle);
  // The list is small and always loaded (for the empty state); snapshots only while the layers are on.
  const sel = useTimeline(worldId);
  return (
    <div className="flex flex-col gap-3">
      <button type="button" aria-pressed={visible} onClick={toggle} className={`${ROW} justify-between border border-line`}>
        <span>{t('factoryMap.show')}</span>
        <span className={visible ? 'text-accent' : 'text-muted'}>{t(visible ? 'factoryMap.on' : 'factoryMap.off')}</span>
      </button>
      {sel.list && sel.ordered.length === 0 && <EmptyFactory owner={owner} framed={false} />}
      {sel.selected && (
        <SaveLine saveTime={sel.selected.saveTime} buildings={sel.selected.buildings} machines={sel.selected.machines} />
      )}
      {sel.ordered.length > 0 && visible && version !== undefined && <PanelDetails worldId={worldId} version={version} owner={owner} />}
    </div>
  );
}

function SaveLine({ saveTime, buildings, machines }: { saveTime: number; buildings: number; machines: number }) {
  const { t, i18n } = useTranslation();
  const num = new Intl.NumberFormat(i18n.language);
  return (
    <p className="text-xs text-muted" data-testid="factory-panel-save">
      {t('factoryMap.panel.save', {
        date: new Date(saveTime).toLocaleString(i18n.language, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
        buildings: num.format(buildings),
        machines: num.format(machines),
      })}
    </p>
  );
}

/**
 * The height range ("Höhe"): the slider over the save's heights, how many buildings lie in the range, and "Darunter
 * blass zeigen" (what lies below as faint outlines; only when the range starts above the lowest height).
 */
function HeightSection({ worldId, scene, settled }: { worldId: string; scene: Scene; settled: boolean }) {
  const { t, i18n } = useTranslation();
  // The count follows the map (a little behind while the slider is dragged); the slider itself never waits.
  const { profile, range, shown } = useHeight(worldId, scene, { deferred: true, settled });
  const below = useFactoryMap(s => s.heightBelow);
  if (!profile) return null;
  const num = new Intl.NumberFormat(i18n.language);
  const session = scene.snapshot.meta.sessionName;
  const canBelow = range !== null && range.lo > profile.min;
  return (
    <div className="flex flex-col" data-testid="factory-height">
      <HeightSlider profile={profile} value={range} onChange={r => useFactoryMap.getState().setHeight(worldId, r, session)} />
      {range && shown && (
        <p className="px-2 text-xs text-muted tabular-nums" data-testid="height-count">
          {t('factoryMap.height.count', { shown: num.format(shown.buildings.length), total: num.format(scene.buildings.length) })}
        </p>
      )}
      <label className={`${ROW} ${canBelow ? 'cursor-pointer' : 'text-muted'}`}>
        <input type="checkbox" checked={below} disabled={!canBelow} onChange={() => useFactoryMap.getState().setHeightBelow(!below)} className="size-4" />
        <span className="min-w-0 flex-1">{t('factoryMap.height.below')}</span>
      </label>
    </div>
  );
}

function PanelDetails({ worldId, version, owner }: { worldId: string; version: string; owner: boolean }) {
  const { t, i18n } = useTranslation();
  const lang = langOf(i18n.language);
  const bounds = useDataset(version)?.ds.bounds;
  const layers = useFactoryMap(s => s.layers);
  const colorMode = useFactoryMap(s => s.colorMode);
  const { toggleLayer, setColorMode } = useFactoryMap.getState();
  const highlightCount = useFactoryView(s => s.highlight.length);
  const data = useMapData(worldId, version, bounds, true);
  const scene = data.scene;
  const legend = useMemo(() => (scene ? legendOf(scene) : null), [scene]);
  // The page's counts, so map and page always agree (the ids for "show on the map" come from the scene).
  const totals = data.current?.snapshot === scene?.snapshot ? data.current?.analysis.totals : undefined;
  const layersLabel = useId();
  const num = new Intl.NumberFormat(i18n.language);
  const show = (ids: readonly string[]) => useFactoryView.getState().showOnMap(ids);

  return (
    <>
      {scene && <HeightSection worldId={worldId} scene={scene} settled={!data.loading} />}

      <SegmentedControl<ColorMode>
        label={t('factoryMap.colorMode')}
        value={colorMode}
        onChange={setColorMode}
        options={[{ value: 'category', label: t('factoryMap.colorModes.category') }, { value: 'productivity', label: t('factoryMap.colorModes.productivity') }]}
      />

      {legend && colorMode === 'category' && (
        <ul aria-label={t('factoryMap.legend')} className="flex flex-col text-sm" data-testid="factory-legend">
          {MAP_KINDS.filter(k => k !== 'structure').map(k => (
            <li key={k} className="flex h-7 items-center gap-2 px-2 max-[899px]:h-9">
              <span aria-hidden="true" className={`size-3 shrink-0 border border-bg ${KIND_BG[k]}`} />
              <span className="min-w-0 flex-1 truncate">{t(`factoryMap.kinds.${k}`)}</span>
              <span className="font-display tabular-nums">{num.format(legend.kinds.get(k)?.length ?? 0)}</span>
            </li>
          ))}
        </ul>
      )}

      {legend && colorMode === 'productivity' && (
        <div className="flex flex-col gap-2" data-testid="factory-legend">
          <ul aria-label={t('factoryMap.legend')} className="flex flex-col">
            {/* Problems first: standing, throttled, nearly full, full. */}
            {[...BANDS].sort((a, b) => bandLook(b).rank - bandLook(a).rank).map(b => {
              const ids = legend.bands.get(b) ?? [];
              return (
                <li key={b}>
                  <button type="button" className={ROW} disabled={ids.length === 0} onClick={() => show(ids)} title={t('factoryMap.showOnMapHint')}>
                    <BandSwatch band={b} />
                    <span className="min-w-0 flex-1 truncate">{t(`factory.band.${b}`)}</span>
                    <span className="font-display tabular-nums">{num.format(totals?.bands[b] ?? ids.length)}</span>
                  </button>
                </li>
              );
            })}
            {legend.paused.length > 0 && (
              <li>
                <button type="button" className={ROW} onClick={() => show(legend.paused)} title={t('factory.reasonHint.paused')}>
                  <BandSwatch band="paused" />
                  <span className="min-w-0 flex-1 truncate">{t(stateKey('paused'))}</span>
                  <span className="font-display tabular-nums">{num.format(totals?.paused ?? legend.paused.length)}</span>
                </button>
              </li>
            )}
            <li className="flex h-8 items-center gap-2 px-2 text-sm text-muted max-[899px]:h-11">
              <BandSwatch band={null} />
              <span className="min-w-0 flex-1 truncate">{t('factoryMap.noProduction')}</span>
            </li>
          </ul>
          <ul aria-label={t('factoryMap.reasonsLabel')} className="flex flex-col">
            {reasonOrder(legend).map(r => {
              const ids = legend.reasons.get(r) ?? [];
              if (ids.length === 0) return null;
              return (
                <li key={r}>
                  <button type="button" className={ROW} onClick={() => show(ids)} title={t(`factory.reasonHint.${r}`, { defaultValue: '' }) || undefined}>
                    <ReasonIcon reason={r} />
                    <span className="min-w-0 flex-1 truncate">{t(`factory.reason.${r}`)}</span>
                    <span className="font-display tabular-nums">{num.format(totals?.reasons[r] ?? ids.length)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {highlightCount > 0 && (
        <Button size="sm" variant="ghost" className="self-start" onClick={() => useFactoryView.getState().clearHighlight()}>
          {t('factoryMap.clearHighlight', { count: highlightCount })}
        </Button>
      )}

      <LinesSection data={data} owner={owner} version={version} />

      <div>
        <div id={layersLabel} className="mb-1 text-xs text-muted">{t('factoryMap.layersLabel')}</div>
        <ul aria-labelledby={layersLabel} className="flex flex-col">
          {FACTORY_LAYERS.map(l => (
            <li key={l}>
              <label className={`${ROW} cursor-pointer`}>
                <input type="checkbox" checked={layers[l]} onChange={() => toggleLayer(l)} className="size-4" />
                <span className="min-w-0 flex-1">{t(`factoryMap.layers.${l}`)}</span>
              </label>
            </li>
          ))}
        </ul>
      </div>

      {scene && scene.stations.length + scene.vehicles.length > 0 && (
        <Fold title={t('factoryMap.panel.transport')} summary={t('factoryMap.panel.transportSummary', { stations: scene.stations.length, vehicles: scene.vehicles.length })}>
          <ul className="flex flex-col" data-testid="factory-vehicles">
            {scene.vehicles.map(v => (
              <li key={v.v.id}>
                <button type="button" className={ROW} onClick={e => { useFactoryMap.getState().select({ kind: 'vehicle', id: v.v.id }, { focus: true, opener: e.currentTarget }); show([v.v.id, ...v.v.route]); }}>
                  <span className="min-w-0 flex-1 truncate">{vehicleName(scene, v.v.id, lang)}</span>
                  <span className="text-xs text-muted">{t('factoryMap.panel.stops', { count: v.v.route.length })}</span>
                </button>
              </li>
            ))}
            {scene.stations.map(st => (
              <li key={st.s.id}>
                <button type="button" className={ROW} onClick={e => { useFactoryMap.getState().select({ kind: 'building', id: st.s.id }, { focus: true, opener: e.currentTarget }); show([st.s.id]); }}>
                  <span aria-hidden="true" className="w-3 shrink-0 text-muted">{st.s.loading === false ? '↓' : '↑'}</span>
                  <span className="min-w-0 flex-1 truncate">{stationName(scene, st.s.id, lang)}</span>
                  <span className="text-xs text-muted tabular-nums">{t('factoryMap.perMin', { value: num.format(Math.round(st.flow.itemsPerMin ?? 0)) })}</span>
                </button>
              </li>
            ))}
          </ul>
        </Fold>
      )}
    </>
  );
}
