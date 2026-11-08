import L from 'leaflet';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ImageOverlay, Pane, useMap } from 'react-leaflet';
import type { FactorySnapshot } from '../../../../shared/factory/snapshot.js';
import type { WorldCtx } from '../../../app/feature.js';
import { useUiStore } from '../../../app/store.js';
import { useIsMobile } from '../../../app/useMediaQuery.js';
import { IMAGE_BOUNDS } from '../../map/imageBounds.js';
import { prefersReducedMotion } from '../../map/motion.js';
import { requestDetailZoom } from '../../map/zoom.js';
import { useItemIcons, type ItemIcons } from '../../machineWiki/icons.js';
import { useFactoryWorld } from '../timeline.js';
import { useFactoryView } from '../view.js';
import { placeDiff } from './diff.js';
import { useMapData } from './mapData.js';
import { FactoryCanvasLayer, FOG_PANE, FOG_PANE_Z, type FactoryFrame } from './FactoryCanvasLayer.js';
import { pickFactory } from './pick.js';
import { factoryPicture, onFactoryPictureLoad } from './pictures.js';
import { boundsOfIds, type Scene, type SceneBuilding, type SceneStation } from './scene.js';
import { routePath } from './routes.js';
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

  // A collectible selected on the map closes the building's info (one box at a time).
  useEffect(() => useUiStore.subscribe((s, prev) => {
    if (s.selectedActor !== null && s.selectedActor !== prev.selectedActor) useFactoryMap.getState().select(null);
  }), []);

  return visible ? <ActiveFactory ctx={ctx} /> : null;
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

  // "On the map" from the Fabrik page: fit once the scene is there. A vehicle among the ids (a route: the vehicle and
  // its stations) is selected, so its route shows.
  useEffect(() => {
    if (highlightSeq <= fittedSeq || !scene) return;
    useFactoryMap.getState().setFittedSeq(highlightSeq);
    const vehicles = highlightIds.filter(id => scene.vehicleById.has(id));
    if (vehicles.length === 1) useFactoryMap.getState().select({ kind: 'vehicle', id: vehicles[0]! });
    const box = boundsOfIds(scene, highlightIds);
    if (!box) return;
    const pad = 0.6;
    const fit = L.latLngBounds(ll(box.minX - pad, box.maxY + pad), ll(box.maxX + pad, box.minY - pad));
    map.fitBounds(fit, {
      paddingTopLeft: [24, 24],
      // Clear of the timeline at the bottom, on wide screens also of the info window on the right (a vehicle is
      // selected), on phones of the sheet.
      paddingBottomRight: mobile ? [24, 24 + Math.round(map.getSize().y / 2)] : [vehicles.length === 1 ? 372 : 24, 120],
      maxZoom: FIT_MAX_ZOOM,
      animate: !prefersReducedMotion(),
    });
  }, [map, highlightSeq, fittedSeq, scene, highlightIds, mobile]);

  const highlight = useMemo(() => new Set(highlightIds), [highlightIds]);
  const diff = useMemo(
    () => (data.geometry && data.compare && data.buildings && scene ? placeDiff(data.diff, data.geometry, data.compare, data.buildings, scene.t) : null),
    [data.diff, data.geometry, data.compare, data.buildings, scene],
  );
  const route = useMemo(() => (scene && selection?.kind === 'vehicle' ? vehicleRoute(scene, selection.id) : null), [scene, selection]);
  const number = useMemo(() => new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 0 }), [i18n.language]);

  const frame = useMemo((): FactoryFrame => ({
    scene,
    layers, colorMode, diff, highlight,
    selected: selection?.id ?? null,
    hover: hover?.id ?? null,
    route,
    picture: (sb, px) => pictureOf(icons, sb, px),
    label: sb => sb.entry?.name[lang] ?? sb.b.cls,
    stationLabel: st => stationLabel(st, t, number),
    vehicleLabel: v => (scene ? vehicleName(scene, v.v.id, lang) : v.v.cls),
    loading: data.loading,
  }), [scene, layers, colorMode, diff, highlight, selection, hover, route, icons, lang, t, number, data.loading]);

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
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') useFactoryMap.getState().select(null); };
    map.on('mousemove', onMove);
    map.on('mouseout', onOut);
    map.on('preclick', onPreClick);
    map.on('click', onClick);
    map.on('dragstart', onDragStart);
    map.on('dragend', onDragEnd);
    document.addEventListener('keydown', onKey);
    return () => {
      map.off('mousemove', onMove);
      map.off('mouseout', onOut);
      map.off('preclick', onPreClick);
      map.off('click', onClick);
      map.off('dragstart', onDragStart);
      map.off('dragend', onDragEnd);
      document.removeEventListener('keydown', onKey);
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

function pictureOf(icons: ItemIcons | null, sb: SceneBuilding, px: number): HTMLImageElement | null {
  const cls = sb.entry?.icon;
  if (!icons || !cls || !icons.has(cls)) return null;
  // Device pixels, so pictures stay sharp on 2x screens.
  return factoryPicture(icons.urls(cls, px * (window.devicePixelRatio || 1)).src);
}

/** "↑ 312 /min" (loading) or "↓ …" (unloading), with the player's name for the station first when it has one. */
export function stationLabel(st: SceneStation, t: (k: string, o?: Record<string, unknown>) => string, number: Intl.NumberFormat): string {
  const rate = st.state === 'idle' ? t('factoryMap.station.idleShort')
    : t('factoryMap.station.rateShort', { rate: number.format(st.flow.itemsPerMin ?? 0), dir: st.s.loading === false ? '↓' : '↑' });
  return st.s.name ? `${st.s.name} · ${rate}` : rate;
}

/** The selected vehicle's way along the roads between its stops, in map units, and its stops with their numbers. */
function vehicleRoute(scene: Scene, id: string): FactoryFrame['route'] {
  const v = scene.vehicleById.get(id);
  if (!v || v.v.route.length === 0) return null;
  const legs = routePath(scene.snapshot, v.v.route).map(leg => {
    const out = new Float32Array(leg.length * 2);
    leg.forEach((p, i) => { out[i * 2] = scene.t.x(p.x); out[i * 2 + 1] = scene.t.y(p.y); });
    return out;
  });
  const labels = new Map<string, number[]>();
  v.v.route.forEach((sid, i) => (labels.get(sid) ?? labels.set(sid, []).get(sid)!).push(i + 1));
  const stops = [...labels].flatMap(([sid, nums]) => {
    const st = scene.stationById.get(sid);
    return st ? [{ cx: st.cx, cy: st.cy, label: nums.join('·') }] : [];
  });
  return { legs, stops };
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
