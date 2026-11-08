import { useId, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Fold } from '../../../components/Fold.js';
import { SegmentedControl } from '../../../components/SegmentedControl.js';
import { useDataset } from '../../map/useDataset.js';
import { useMe, useWorld } from '../../worlds/queries.js';
import { useFactoryView } from '../view.js';
import { ReasonIcon } from '../icons.js';
import { BAND_FILL } from '../parts.js';
import { useTimeline } from '../timeline.js';
import { useMapData } from './mapData.js';
import { langOf, stationName, vehicleName } from './names.js';
import { bandHatch, KIND_BG } from './ProdParts.js';
import type { Scene } from './scene.js';
import { BANDS, REASONS, type Band, type Reason } from '../../../../shared/factory/analysis.js';
import { MAP_KINDS, type MapKind } from './style.js';
import { EmptyFactory } from './Timeline.js';
import { FACTORY_LAYERS, useFactoryMap, type ColorMode } from './useFactoryMap.js';

const ROW = 'flex h-8 w-full items-center gap-2 chamfer px-2 text-left text-sm select-none focus-ring hover:bg-raised';

interface Legend {
  kinds: Map<MapKind, string[]>;
  bands: Map<Band, string[]>;
  reasons: Map<Reason, string[]>;
}

/** Building ids per map kind, per productivity band (machines only) and per reason. */
export function legendOf(scene: Scene): Legend {
  const l: Legend = { kinds: new Map(), bands: new Map(), reasons: new Map() };
  const add = <K,>(m: Map<K, string[]>, k: K, id: string) => (m.get(k) ?? m.set(k, []).get(k)!).push(id);
  for (const sb of scene.buildings) {
    add(l.kinds, sb.kind, sb.b.id);
    if (sb.band) add(l.bands, sb.band, sb.b.id);
    for (const r of sb.reasons) add(l.reasons, r, sb.b.id);
  }
  return l;
}

/**
 * The Factory panel: the factory layers' switch, the colour mode with its legend (counts; a click on a productivity
 * band or a reason outlines those machines on the map and fits to them), the layers one by one, and the stations and
 * vehicles as lists (a click selects and shows one). Without snapshots it explains how to get them.
 */
export function FactoryPanel({ worldId }: { worldId: string }) {
  const { t } = useTranslation();
  const version = useMe().data?.datasetVersion;
  const owner = useWorld(worldId).data?.isOwner ?? false;
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
      {sel.ordered.length > 0 && visible && version !== undefined && <PanelDetails worldId={worldId} version={version} />}
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

function PanelDetails({ worldId, version }: { worldId: string; version: string }) {
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
  const layersLabel = useId();
  const num = new Intl.NumberFormat(i18n.language);
  const show = (ids: readonly string[]) => useFactoryView.getState().showOnMap(ids);

  return (
    <>
      <SegmentedControl<ColorMode>
        label={t('factoryMap.colorMode')}
        value={colorMode}
        onChange={setColorMode}
        options={[{ value: 'category', label: t('factoryMap.colorModes.category') }, { value: 'productivity', label: t('factoryMap.colorModes.productivity') }]}
      />

      {legend && colorMode === 'category' && (
        <ul aria-label={t('factoryMap.legend')} className="flex flex-col text-sm" data-testid="factory-legend">
          {MAP_KINDS.filter(k => k !== 'structure').map(k => (
            <li key={k} className="flex h-7 items-center gap-2 px-2">
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
            {[...BANDS].reverse().map(b => {
              const ids = legend.bands.get(b) ?? [];
              return (
                <li key={b}>
                  <button type="button" className={ROW} disabled={ids.length === 0} onClick={() => show(ids)} title={t('factoryMap.showOnMapHint')}>
                    <span aria-hidden="true" className={`size-3 shrink-0 border border-bg ${BAND_FILL[b]}`} style={{ backgroundImage: bandHatch(b) }} />
                    <span className="min-w-0 flex-1 truncate">{t(`factory.band.${b}`)}</span>
                    <span className="font-display tabular-nums">{num.format(ids.length)}</span>
                  </button>
                </li>
              );
            })}
            <li className="flex h-8 items-center gap-2 px-2 text-sm text-muted">
              <span aria-hidden="true" className="size-3 shrink-0 border border-bg bg-fac-minor" />
              <span className="min-w-0 flex-1 truncate">{t('factoryMap.noProduction')}</span>
            </li>
          </ul>
          <ul aria-label={t('factoryMap.reasonsLabel')} className="flex flex-col">
            {REASONS.map(r => {
              const ids = legend.reasons.get(r) ?? [];
              if (ids.length === 0) return null;
              return (
                <li key={r}>
                  <button type="button" className={ROW} onClick={() => show(ids)} title={t(`factory.reasonHint.${r}`)}>
                    <ReasonIcon reason={r} />
                    <span className="min-w-0 flex-1 truncate">{t(`factory.reason.${r}`)}</span>
                    <span className="font-display tabular-nums">{num.format(ids.length)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {highlightCount > 0 && (
        <button type="button" className="self-start chamfer px-1 text-xs text-muted focus-ring hover:text-fg" onClick={() => useFactoryView.getState().clearHighlight()}>
          {t('factoryMap.clearHighlight', { count: highlightCount })}
        </button>
      )}

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
                <button type="button" className={ROW} onClick={() => { useFactoryMap.getState().select({ kind: 'vehicle', id: v.v.id }); show([v.v.id, ...v.v.route]); }}>
                  <span className="min-w-0 flex-1 truncate">{vehicleName(scene, v.v.id, lang)}</span>
                  <span className="text-xs text-muted">{t('factoryMap.panel.stops', { count: v.v.route.length })}</span>
                </button>
              </li>
            ))}
            {scene.stations.map(st => (
              <li key={st.s.id}>
                <button type="button" className={ROW} onClick={() => { useFactoryMap.getState().select({ kind: 'building', id: st.s.id }); show([st.s.id]); }}>
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
