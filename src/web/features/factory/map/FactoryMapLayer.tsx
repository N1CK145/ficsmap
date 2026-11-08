import L from 'leaflet';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ImageOverlay, Pane, useMap } from 'react-leaflet';
import type { FactorySnapshot } from '../../../../shared/factory/snapshot.js';
import type { WorldCtx } from '../../../app/feature.js';
import { useUiStore } from '../../../app/store.js';
import { useIsMobile, useMediaQuery } from '../../../app/useMediaQuery.js';
import { IMAGE_BOUNDS } from '../../map/imageBounds.js';
import { prefersReducedMotion } from '../../map/motion.js';
import { requestDetailZoom } from '../../map/zoom.js';
import { useItemIcons, type ItemIcons } from '../../machineWiki/icons.js';
import { useFactoryWorld } from '../timeline.js';
import { useFactoryView } from '../view.js';
import { changesBox, placeDiff } from './diff.js';
import { useMapData } from './mapData.js';
import { FactoryCanvasLayer, FOG_PANE, FOG_PANE_Z, type FactoryFrame } from './FactoryCanvasLayer.js';
import { pickFactory } from './pick.js';
import { factoryPicture, onFactoryPictureLoad } from './pictures.js';
import { boundsOfIds, type Scene, type SceneStation } from './scene.js';
import { vehicleRoute } from './routes.js';
import { useFactoryMap, ZOOM_KEY, type FactorySelection } from './useFactoryMap.js';
import { HoverTip } from './HoverTip.js';
import { langOf, vehicleName } from './names.js';

const HOVER_CLASS = 'ficsmap-marker-hover';
/** Fitting to highlighted buildings stops at this zoom (a single machine fills the view otherwise). */
const FIT_MAX_ZOOM = 8;

/** Map units → `[lat, lng]` (CRS.Simple: lng = x, lat = -y). */
const ll = (mx: number, my: number): L.LatLngTuple => [-my, mx];

/**
 * The factory map while its layer group is on: the shown snapshot on a canvas (`FactoryCanvasLayer`), the explored
 * area as a veil, hover and click on buildings, stations and vehicles (selection is shown by `FactoryInfo`), the
 * selected vehicle's route, and the Fabrik page's "On the map" (`useFactoryView.showOnMap`): it switches the layer
 * on, outlines those buildings and fits the map to them. Asks the map for the detail zoom while on.
 */
export function FactoryMapLayer({ ctx }: { ctx: WorldCtx }) {
  const map = useMap();
  const visible = useFactoryMap(s => s.visible);
  const highlightSeq = useFactoryView(s => s.highlightSeq);
  const fittedSeq = useFactoryMap(s => s.fittedSeq);
  // Another world resets the shared choice (as on the Fabrik page).
  useFactoryWorld(ctx.worldId);

  // The detail zoom while the layers are on.
  useEffect(() => {
    requestDetailZoom(ZOOM_KEY, visible, map);
  }, [map, visible]);

  // "On the map" from the Fabrik page switches the layers on; `ActiveFactory` fits once the scene is there.
  useEffect(() => {
    if (highlightSeq > fittedSeq && !visible) useFactoryMap.getState().setVisible(true);
  }, [highlightSeq, fittedSeq, visible]);

  // Esc closes the info window, unless something else (a dialog, a field, the search) took the key.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!useFactoryMap.getState().selection || !escapeClosesInfo(e)) return;
      e.preventDefault();
      useFactoryMap.getState().select(null);
    };
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // A collectible selected on the map closes the building's info (one box at a time).
  useEffect(() => useUiStore.subscribe((s, prev) => {
    if (s.selectedActor !== null && s.selectedActor !== prev.selectedActor) useFactoryMap.getState().select(null);
  }), []);

  return visible ? <ActiveFactory ctx={ctx} /> : null;
}

/**
 * Whether an Esc press is the info window's to close it: not when something handled it already, nor when it comes from
 * a field (the search, a select) or from inside a dialog.
 */
export function escapeClosesInfo(e: Pick<KeyboardEvent, 'key' | 'defaultPrevented' | 'target'>): boolean {
  if (e.key !== 'Escape' || e.defaultPrevented) return false;
  const target = e.target instanceof Element ? e.target : null;
  return !target?.closest('input, select, textarea, [contenteditable="true"], dialog, [role="dialog"], [role="alertdialog"]');
}

/** The factory layers while they are on (the dataset parts and snapshots load only then). */
function ActiveFactory({ ctx }: { ctx: WorldCtx }) {
  const map = useMap();
  const { t, i18n } = useTranslation();
  const lang = langOf(i18n.language);
  const mobile = useIsMobile();
  const layers = useFactoryMap(s => s.layers);
  const colorMode = useFactoryMap(s => s.colorMode);
  const selection = useFactoryMap(s => s.selection);
  const highlightIds = useFactoryView(s => s.highlight);
  const highlightSeq = useFactoryView(s => s.highlightSeq);
  const fittedSeq = useFactoryMap(s => s.fittedSeq);
  const version = ctx.me.datasetVersion;
  const bounds = ctx.index.ds.bounds;
  const data = useMapData(ctx.worldId, version, bounds, true);
  const scene = data.scene;
  const icons = useItemIcons(version, !!scene);
  const [hover, setHover] = useState<FactorySelection | null>(null);
  const [pulse, setPulse] = useState<number | null>(null);
  const coarse = useMediaQuery('(pointer: coarse)');
  const fitChangesSeq = useFactoryMap(s => s.fitChangesSeq);
  /** When the map last fitted to something (`performance.now()`): a selection made with it needs no pan on top. */
  const lastFit = useRef(-Infinity);

  // "On the map" from the Fabrik page: fit once the scene is there. A vehicle among the ids (a route: the vehicle and
  // its stations) is selected, so its route shows.
  useEffect(() => {
    if (highlightSeq <= fittedSeq || !scene) return;
    const fm = useFactoryMap.getState();
    fm.setFittedSeq(highlightSeq);
    // Machines to look at: the colours that tell their productivity.
    if (highlightIds.some(id => scene.byId.get(id)?.band)) fm.setColorMode('productivity');
    const vehicles = highlightIds.filter(id => scene.vehicleById.has(id));
    if (vehicles.length === 1 && fm.selection?.id !== vehicles[0]) fm.select({ kind: 'vehicle', id: vehicles[0]! });
    const box = boundsOfIds(scene, highlightIds);
    if (!box) return;
    lastFit.current = performance.now();
    fitBox(map, box, mobile, vehicles.length === 1);
    // The halo pulses once where the map lands (a steady halo with reduced motion).
    setPulse(prefersReducedMotion() ? null : performance.now());
  }, [map, highlightSeq, fittedSeq, scene, highlightIds, mobile]);

  const highlight = useMemo(() => new Set(highlightIds), [highlightIds]);
  const diff = useMemo(
    () => (data.geometry && data.compare && data.buildings && scene ? placeDiff(data.diff, data.geometry, data.compare, data.buildings, scene.t) : null),
    [data.diff, data.geometry, data.compare, data.buildings, scene],
  );
  // "Go to the changes": fit to the changed buildings (else to the changed floor pieces).
  const fittedChanges = useRef(fitChangesSeq);
  useEffect(() => {
    if (fitChangesSeq === fittedChanges.current || !scene || !diff) return;
    fittedChanges.current = fitChangesSeq;
    const box = changesBox(scene, diff);
    if (box) {
      lastFit.current = performance.now();
      fitBox(map, box, mobile, false);
    }
  }, [map, fitChangesSeq, scene, diff, mobile]);

  // A selection made anywhere stays in view: pan the map so the building is clear of the info window.
  useEffect(() => {
    if (!scene || !selection) return;
    const at = selection.kind === 'vehicle' ? scene.vehicleById.get(selection.id) : scene.byId.get(selection.id);
    if (!at) return;
    let id = requestAnimationFrame(() => {
      id = requestAnimationFrame(() => {
        if (performance.now() - lastFit.current < 1500) return;
        const box = document.querySelector('.ficsmap-factory-info')?.getBoundingClientRect();
        const mapBox = map.getContainer().getBoundingClientRect();
        const size = map.getSize();
        const pad = 24;
        let right = pad, bottom = pad;
        if (box && box.width > 0) {
          // On the right (wide screens) or at the bottom (phones, a sheet above the sheet's peek).
          if (box.left - mapBox.left > size.x / 2) right = Math.max(pad, mapBox.right - box.left + pad);
          else bottom = Math.max(pad, mapBox.bottom - box.top + pad);
        }
        map.panInside(ll(at.cx, at.cy), { paddingTopLeft: [pad, pad], paddingBottomRight: [right, bottom], animate: !prefersReducedMotion() });
      });
    });
    return () => cancelAnimationFrame(id);
    // Only when the selection changes, not on every new scene of the same selection.
  }, [map, selection?.kind, selection?.id]);

  const route = useMemo(() => (scene && selection?.kind === 'vehicle' ? vehicleRoute(scene, selection.id) : null), [scene, selection]);
  const number = useMemo(() => new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 0 }), [i18n.language]);

  const frame = useMemo((): FactoryFrame => ({
    scene,
    layers, colorMode, diff, highlight,
    pulse: highlight.size > 0 ? pulse : null,
    selected: selection?.id ?? null,
    hover: hover?.id ?? null,
    route,
    picture: (sb, px) => pictureOf(icons, sb.entry?.icon, px),
    itemPicture: (item, px) => pictureOf(icons, item, px),
    label: sb => sb.entry?.name[lang] ?? sb.b.cls,
    stationLabel: st => stationLabel(st, t, number),
    vehicleLabel: v => (scene ? vehicleName(scene, v.v.id, lang) : v.v.cls),
    fontPx: coarse ? 13 : 12,
    loading: data.loading,
  }), [scene, layers, colorMode, diff, highlight, pulse, selection, hover, route, icons, lang, t, number, coarse, data.loading]);

  const frameRef = useRef(frame);
  const sceneRef = useRef(scene);
  const layerRef = useRef<FactoryCanvasLayer | null>(null);

  useEffect(() => {
    const layer = new FactoryCanvasLayer(() => frameRef.current);
    layer.addTo(map);
    layerRef.current = layer;
    // For measurements in a browser's console: the last draw's duration.
    (window as unknown as { __ficsmapFactoryLayer?: FactoryCanvasLayer }).__ficsmapFactoryLayer = layer;
    const unsubscribeImages = onFactoryPictureLoad(() => layer.redraw());
    const container = map.getContainer();
    const at = (p: L.Point): FactorySelection | null => {
      const sc = sceneRef.current;
      const m = layer.toMapUnits(p.x, p.y);
      return sc && m ? pickFactory(sc, frameRef.current.layers, m.mx, m.my, m.s, map.getZoom()) : null;
    };
    let frameId = 0;
    let point: L.Point | null = null;
    let dragging = false;
    const onMove = (e: L.LeafletMouseEvent) => {
      point = e.containerPoint;
      if (frameId || dragging) return;
      frameId = requestAnimationFrame(() => {
        frameId = 0;
        if (!point || dragging) return;
        const hit = at(point);
        container.classList.toggle(HOVER_CLASS, hit !== null);
        setHover(h => (h?.id === hit?.id ? h : hit));
      });
    };
    const onOut = () => {
      point = null;
      container.classList.remove(HOVER_CLASS);
      setHover(null);
    };
    let actorBefore: string | null = null;
    const onPreClick = () => { actorBefore = useUiStore.getState().selectedActor; };
    const onClick = (e: L.LeafletMouseEvent) => {
      // A collectible marker drawn above the factory took this click.
      const actor = useUiStore.getState().selectedActor;
      if (actor !== null && actor !== actorBefore) return;
      if (useUiStore.getState().interactionMode !== 'inspect') return;
      const hit = at(e.containerPoint);
      useFactoryMap.getState().select(hit);
      if (hit && actor !== null) useUiStore.getState().select(null);
    };
    const onDragStart = () => { dragging = true; onOut(); };
    const onDragEnd = () => { dragging = false; };
    map.on('mousemove', onMove);
    map.on('mouseout', onOut);
    map.on('preclick', onPreClick);
    map.on('click', onClick);
    map.on('dragstart', onDragStart);
    map.on('dragend', onDragEnd);
    return () => {
      map.off('mousemove', onMove);
      map.off('mouseout', onOut);
      map.off('preclick', onPreClick);
      map.off('click', onClick);
      map.off('dragstart', onDragStart);
      map.off('dragend', onDragEnd);
      cancelAnimationFrame(frameId);
      unsubscribeImages();
      container.classList.remove(HOVER_CLASS);
      layer.remove();
      layerRef.current = null;
      setHover(null);
    };
  }, [map]);

  // Before paint, so the layer never draws a frame with stale data.
  useLayoutEffect(() => {
    frameRef.current = frame;
    sceneRef.current = scene;
    layerRef.current?.redraw();
  }, [frame, scene]);

  if (!scene) return null;
  return (
    <>
      {layers.fog && scene.snapshot.fog && <Fog snapshot={scene.snapshot} />}
      {hover && hover.id !== selection?.id && <HoverTip scene={scene} hit={hover} lang={lang} />}
    </>
  );
}

function pictureOf(icons: ItemIcons | null, cls: string | undefined, px: number): HTMLImageElement | null {
  if (!icons || !cls || !icons.has(cls)) return null;
  // Device pixels, so pictures stay sharp on 2x screens.
  return factoryPicture(icons.urls(cls, px * (window.devicePixelRatio || 1)).src);
}

/** A station's line on its plate (`FactoryFrame.stationLabel`). */
export interface StationLabel {
  text: string;
  /** No vehicle stops here, or vehicles dock and move nothing: drawn in the danger colour. */
  problem: boolean;
  /** What lies in the station (the most), for its picture in front of the line; null when empty or unknown. */
  item: string | null;
}

/** How full its vehicles leave or arrive (the mean of the visits that know it), 0..1, or null. */
export function stationFill(st: SceneStation): number | null {
  const fills = st.flow.visits.map(v => v.fill).filter((f): f is number => f !== null && f !== undefined);
  return fills.length > 0 ? fills.reduce((a, b) => a + b, 0) / fills.length : null;
}

/**
 * "↑ 312 /min · 80 %" (loading, how full) or "↓ …" (unloading), with the player's name for the station first when it
 * has one and the picture of what lies in it; a problem station (no vehicles, nothing moved) in red.
 */
export function stationLabel(st: SceneStation, t: (k: string, o?: Record<string, unknown>) => string, number: Intl.NumberFormat): StationLabel {
  const dir = st.s.loading === false ? '↓' : '↑';
  const fill = stationFill(st);
  const rate = st.state === 'idle' ? t('factoryMap.station.idleShort')
    : fill !== null && st.state === 'active'
      ? t('factoryMap.station.rateFillShort', { rate: number.format(st.flow.itemsPerMin ?? 0), dir, fill: number.format(Math.round(fill * 100)) })
      : t('factoryMap.station.rateShort', { rate: number.format(st.flow.itemsPerMin ?? 0), dir });
  return { text: st.s.name ? `${st.s.name} · ${rate}` : rate, problem: st.state !== 'active', item: st.flow.cargo?.[0]?.item ?? null };
}

/** Fits the map to a box of map units, clear of the timeline, the info window (`withInfo`) and on phones the sheet. */
function fitBox(map: L.Map, box: { minX: number; minY: number; maxX: number; maxY: number }, mobile: boolean, withInfo: boolean): void {
  const pad = 0.6;
  map.fitBounds(L.latLngBounds(ll(box.minX - pad, box.maxY + pad), ll(box.maxX + pad, box.minY - pad)), {
    paddingTopLeft: [24, 72],
    paddingBottomRight: mobile ? [24, 24 + Math.round(map.getSize().y / 2)] : [withInfo ? 372 : 24, 140],
    maxZoom: FIT_MAX_ZOOM,
    animate: !prefersReducedMotion(),
  });
}

const fogCache = new WeakMap<FactorySnapshot, Promise<string | null>>();

/**
 * The explored area as a veil: unexplored ground under a dark wash (the save's fog of war, one grey channel per pixel,
 * see `FactorySnapshot.fog`), explored ground clear. Turned into an RGBA picture once per snapshot.
 */
export function fogVeil(snapshot: FactorySnapshot, color: string): Promise<string | null> {
  let p = fogCache.get(snapshot);
  if (!p) {
    p = new Promise(resolve => {
      if (!snapshot.fog) { resolve(null); return; }
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        const g = c.getContext('2d');
        if (!g) { resolve(null); return; }
        g.drawImage(img, 0, 0);
        const px = g.getImageData(0, 0, c.width, c.height);
        const m = /^#?([0-9a-f]{6})$/i.exec(color);
        const n = m ? parseInt(m[1]!, 16) : 0;
        for (let i = 0; i < px.data.length; i += 4) {
          const explored = px.data[i]!;
          px.data[i] = (n >> 16) & 255;
          px.data[i + 1] = (n >> 8) & 255;
          px.data[i + 2] = n & 255;
          px.data[i + 3] = Math.round((255 - explored) * 0.72);
        }
        g.putImageData(px, 0, 0);
        resolve(c.toDataURL('image/png'));
      };
      img.onerror = () => resolve(null);
      img.src = `data:image/png;base64,${snapshot.fog}`;
    });
    fogCache.set(snapshot, p);
  }
  return p;
}

function Fog({ snapshot }: { snapshot: FactorySnapshot }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    const color = getComputedStyle(document.documentElement).getPropertyValue('--color-bg').trim() || '#000000';
    void fogVeil(snapshot, color).then(u => { if (live) setUrl(u); });
    return () => { live = false; };
  }, [snapshot]);
  if (!url) return null;
  return (
    <Pane name={FOG_PANE} style={{ zIndex: FOG_PANE_Z, pointerEvents: 'none' }}>
      <ImageOverlay url={url} bounds={IMAGE_BOUNDS} interactive={false} className="ficsmap-factory-fog" />
    </Pane>
  );
}
