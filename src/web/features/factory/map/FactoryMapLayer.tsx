import L from 'leaflet';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ImageOverlay, Pane, useMap } from 'react-leaflet';
import type { ProductionLines } from '../../../../shared/factory/lines.js';
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
import { changeAreas, placeDiff } from './diff.js';
import { useMapData } from './mapData.js';
import { FactoryCanvasLayer, FOG_PANE, FOG_PANE_Z, type FactoryFrame, type FrameLine } from './FactoryCanvasLayer.js';
import { pickFactory } from './pick.js';
import { factoryPicture, onFactoryPictureLoad } from './pictures.js';
import { boundsOfIds, type SceneStation } from './scene.js';
import { lineById, lineGeometry, lineName, lineOf, pickLineSpline, sceneLineById, shownLine } from './lineView.js';
import { LINES_FROM } from './lod.js';
import { vehicleRoute } from './routes.js';
import { useFactoryMap, ZOOM_KEY, type FactorySelection } from './useFactoryMap.js';
import { HoverTip } from './HoverTip.js';
import { langOf, stationNumber, vehicleName } from './names.js';

const HOVER_CLASS = 'ficsmap-marker-hover';
/** Hit distance around a belt or pipe of a production line, CSS px. */
const BELT_HIT_PX = 5;
/** Fitting to highlighted buildings stops at this zoom (a single machine fills the view otherwise). */
const FIT_MAX_ZOOM = 8;
/**
 * On phones the line card opens as a peek over the map at most this share of the map's height (`FactoryInfo`), above
 * the timeline's place and the bottom sheet's peek (`PHONE_BOTTOM_PX`): the map keeps what it shows above it.
 */
export const PEEK_SHARE = 0.32;
export const PHONE_BOTTOM_PX = 136;

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
  const lineId = useFactoryView(s => s.lineId);
  const fittedLineId = useFactoryMap(s => s.fittedLineId);
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
  // A production line chosen elsewhere (the line diagram's "Karte") does the same.
  useEffect(() => {
    if (lineId !== null && lineId !== fittedLineId && !visible) useFactoryMap.getState().setVisible(true);
  }, [lineId, fittedLineId, visible]);

  // Esc closes the info window, unless something else (a dialog, a field, the search) took the key: a building's
  // window first (back to its line's card when a line is chosen), then the line.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (escapeStepsBack(e)) e.preventDefault(); };
    document.addEventListener('keydown', onKey);
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

/**
 * A click (or tap) on the map: on a building of a production line other than the chosen one it chooses that line (its
 * card opens, the line lights up); on anything else, or again within the chosen line, it opens that building, station
 * or vehicle. A click on empty ground closes a building's window; a chosen line stays until Esc or ×.
 */
export function clickFactory(hit: FactorySelection | null, lines: ProductionLines | null | undefined, belt: string | null = null): void {
  const fm = useFactoryMap.getState();
  const view = useFactoryView.getState();
  // A building, else a belt or pipe of a line (they are no building of their own).
  const id = hit?.kind === 'building' ? hit.id : hit === null ? belt : null;
  const line = lineOf(lines, id, view.lineId);
  if (line && line.id !== view.lineId) {
    // The building (or belt) tapped stays the anchor: the map pans it clear of the card.
    fm.openLine(line.id, { anchor: id });
    return;
  }
  fm.select(hit);
}

/**
 * Esc on the factory map: closes a building's window (back to its line's card when a line is chosen), else the chosen
 * line. True when it did something (the caller then takes the key).
 */
export function escapeStepsBack(e: Pick<KeyboardEvent, 'key' | 'defaultPrevented' | 'target'>): boolean {
  if (!useFactoryMap.getState().visible || !escapeClosesInfo(e)) return false;
  if (useFactoryMap.getState().selection) {
    useFactoryMap.getState().select(null);
    return true;
  }
  if (useFactoryView.getState().lineId !== null) {
    useFactoryView.getState().selectLine(null);
    return true;
  }
  return false;
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
  /** The belt or pipe of a production line under the pointer when no building is (spline id). */
  const [hoverBelt, setHoverBelt] = useState<string | null>(null);
  const [pulse, setPulse] = useState<number | null>(null);
  const coarse = useMediaQuery('(pointer: coarse)');
  const fitChangesSeq = useFactoryMap(s => s.fitChangesSeq);
  const changeArea = useFactoryMap(s => s.changeArea);
  const lines = data.lines;
  const lineId = useFactoryView(s => s.lineId);
  const fittedLineId = useFactoryMap(s => s.fittedLineId);
  const hoverLineId = useFactoryMap(s => s.hoverLineId);
  const lineAnchor = useFactoryMap(s => s.lineAnchor);
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
    // Clear of the info window when one is (or will be) open: a vehicle, or a line's card ("On the map" of its machines).
    fitBox(map, box, mobile, vehicles.length === 1 || fm.selection !== null || useFactoryView.getState().lineId !== null);
    // The halo pulses once where the map lands (a steady halo with reduced motion).
    setPulse(prefersReducedMotion() ? null : performance.now());
  }, [map, highlightSeq, fittedSeq, scene, highlightIds, mobile]);

  const highlight = useMemo(() => new Set(highlightIds), [highlightIds]);
  const diff = useMemo(
    () => (data.geometry && data.compare && data.buildings && scene ? placeDiff(data.diff, data.geometry, data.compare, data.buildings, scene.t) : null),
    [data.diff, data.geometry, data.compare, data.buildings, scene],
  );
  // The areas of changes, densest first; the timeline's "Go to the changes" steps through them.
  const areas = useMemo(() => (scene && diff ? changeAreas(scene, diff) : []), [scene, diff]);
  useEffect(() => { useFactoryMap.getState().setChangeAreaCount(areas.length); }, [areas]);
  const fittedChanges = useRef(fitChangesSeq);
  useEffect(() => {
    if (fitChangesSeq === fittedChanges.current) return;
    fittedChanges.current = fitChangesSeq;
    const box = areas[changeArea];
    if (box) {
      lastFit.current = performance.now();
      fitBox(map, box, mobile, false);
    }
  }, [map, fitChangesSeq, changeArea, areas, mobile]);

  // A production line chosen anywhere but by a click on the map (the panel's list, "Zur Linie", the line diagram's
  // "Karte"): fit once its geometry is there.
  // A line that arrives from elsewhere (not opened on the map: the diagram's "Karte") also takes the focus to its card,
  // as a click in the panel's list does.
  useEffect(() => {
    if (lineId === null || lineId === fittedLineId || !scene || lines === undefined) return;
    const fm = useFactoryMap.getState();
    fm.setFittedLineId(lineId);
    if (fm.openedLineId !== lineId) useFactoryMap.setState({ openedLineId: lineId, pendingFocus: true, lineAnchor: null });
    const line = lines ? lineById(lines, lineId) : undefined;
    const box = line ? lineGeometry(scene, line).box : null;
    if (!box) return;
    lastFit.current = performance.now();
    // After the map has its size (it may just have been created by the navigation from the page).
    whenSized(map, () => fitBox(map, box, mobile, true));
  }, [map, fittedLineId, scene, lines, lineId, mobile]);

  // Closing or choosing anything ends the hover: its tip and lit line never outlive what was pointed at.
  const selectionId = selection?.id ?? null;
  useEffect(() => {
    setHover(null);
    setHoverBelt(null);
  }, [selectionId, lineId]);

  // The line of the building under the pointer lights up (the panel's list marks its row too).
  useEffect(() => {
    if (hover === null && hoverBelt === null && useFactoryMap.getState().hoverLineId === null) return;
    const id = hover?.kind === 'building' ? hover.id : hover === null ? hoverBelt : null;
    useFactoryMap.getState().hoverLine(lineOf(lines, id, useFactoryView.getState().lineId)?.id ?? null);
  }, [hover, hoverBelt, lines]);
  useEffect(() => () => useFactoryMap.getState().hoverLine(null), []);

  const frameLine = useMemo((): FrameLine | null => {
    const line = scene ? shownLine(lines, hoverLineId, lineId) : undefined;
    return scene && line ? { geom: lineGeometry(scene, line), focus: hover?.kind === 'building' ? hover.id : null } : null;
  }, [scene, lines, hoverLineId, lineId, hover]);

  // A selection made anywhere stays in view: pan the map so the building is clear of the info window. A line chosen by
  // a tap on the map does the same for the building (or belt) tapped, so a second tap reaches it, not the card.
  useEffect(() => {
    if (!scene) return;
    let at: { cx: number; cy: number } | undefined;
    if (selection) at = selection.kind === 'vehicle' ? scene.vehicleById.get(selection.id) : scene.byId.get(selection.id);
    else if (lineId !== null && lineAnchor !== null) {
      const l = scene.byId.has(lineAnchor) ? undefined : sceneLineById(scene).get(lineAnchor);
      at = scene.byId.get(lineAnchor) ?? (l ? { cx: (l.minX + l.maxX) / 2, cy: (l.minY + l.maxY) / 2 } : undefined);
    }
    if (!at) return;
    const target = at;
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
        map.panInside(ll(target.cx, target.cy), { paddingTopLeft: [pad, pad], paddingBottomRight: [right, bottom], animate: !prefersReducedMotion() });
      });
    });
    return () => cancelAnimationFrame(id);
    // Only when the selection or the anchor changes, not on every new scene of the same selection.
  }, [map, selection?.kind, selection?.id, lineId, lineAnchor, !!scene]);

  const route = useMemo(() => (scene && selection?.kind === 'vehicle' ? vehicleRoute(scene, selection.id) : null), [scene, selection]);
  const number = useMemo(() => new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 0 }), [i18n.language]);

  const frame = useMemo((): FactoryFrame => ({
    scene,
    layers, colorMode, diff, highlight,
    pulse: highlight.size > 0 ? pulse : null,
    selected: selection?.id ?? null,
    hover: hover?.id ?? null,
    route,
    line: frameLine,
    picture: (sb, px) => pictureOf(icons, sb.entry?.icon, px),
    itemPicture: (item, px) => pictureOf(icons, item, px),
    label: sb => sb.entry?.name[lang] ?? sb.b.cls,
    stationLabel: (st, numbered) => stationLabel(st, t, number, numbered && scene ? stationNumber(scene, st.s.id) : null),
    vehicleLabel: v => (scene ? vehicleName(scene, v.v.id, lang) : v.v.cls),
    fontPx: coarse ? 14 : 13,
    loading: data.loading,
  }), [scene, layers, colorMode, diff, highlight, pulse, selection, hover, route, frameLine, icons, lang, t, number, coarse, data.loading]);

  const frameRef = useRef(frame);
  const sceneRef = useRef(scene);
  const linesRef = useRef(lines);
  linesRef.current = lines;
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
    // A belt or pipe of a production line, where belts show.
    const beltAt = (p: L.Point): string | null => {
      const sc = sceneRef.current;
      const m = layer.toMapUnits(p.x, p.y);
      if (!sc || !m || !frameRef.current.layers.lines || map.getZoom() < LINES_FROM) return null;
      return pickLineSpline(sc, linesRef.current, m.mx, m.my, BELT_HIT_PX / m.s);
    };
    let frameId = 0;
    let point: L.Point | null = null;
    let dragging = false;
    // Hover is the mouse's only: a touch or pen never leaves a tip or a lit line behind (pointer events tell them
    // apart; the compatibility mouse events after a tap would not).
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      // Over the zoom keys or another control inside the map: nothing on the map is pointed at.
      if (e.target instanceof Element && e.target.closest('.leaflet-control')) { onOut(); return; }
      point = map.mouseEventToContainerPoint(e as unknown as MouseEvent);
      if (frameId || dragging) return;
      frameId = requestAnimationFrame(() => {
        frameId = 0;
        if (!point || dragging) return;
        const hit = at(point);
        const belt = hit ? null : beltAt(point);
        container.classList.toggle(HOVER_CLASS, hit !== null || belt !== null);
        setHover(h => (h?.id === hit?.id ? h : hit));
        setHoverBelt(belt);
      });
    };
    function onOut() {
      point = null;
      container.classList.remove(HOVER_CLASS);
      setHover(null);
      setHoverBelt(null);
    }
    let actorBefore: string | null = null;
    const onPreClick = () => { actorBefore = useUiStore.getState().selectedActor; };
    const onClick = (e: L.LeafletMouseEvent) => {
      // A collectible marker drawn above the factory took this click.
      const actor = useUiStore.getState().selectedActor;
      if (actor !== null && actor !== actorBefore) return;
      if (useUiStore.getState().interactionMode !== 'inspect') return;
      const hit = at(e.containerPoint);
      if (hit && actor !== null) useUiStore.getState().select(null);
      clickFactory(hit, linesRef.current, hit ? null : beltAt(e.containerPoint));
    };
    const onDragStart = () => { dragging = true; onOut(); };
    const onDragEnd = () => { dragging = false; };
    // The overlays (info window, timeline) lie beside the map's container, not in it: entering them leaves the map.
    container.addEventListener('pointermove', onMove);
    container.addEventListener('pointerleave', onOut);
    map.on('preclick', onPreClick);
    map.on('click', onClick);
    map.on('dragstart', onDragStart);
    map.on('dragend', onDragEnd);
    return () => {
      container.removeEventListener('pointermove', onMove);
      container.removeEventListener('pointerleave', onOut);
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

  const hoverLine = hover?.kind === 'building' ? lineOf(lines, hover.id, lineId) : undefined;
  const hoverLineText = hoverLine && data.labels
    ? t('factoryMap.lines.tip', { name: lineName(hoverLine, data.labels, lang), count: hoverLine.machines.length }) : undefined;

  if (!scene) return null;
  return (
    <>
      {layers.fog && scene.snapshot.fog && <Fog snapshot={scene.snapshot} />}
      {hover && hover.id !== selection?.id && (
        <HoverTip scene={scene} hit={hover} lang={lang} line={hoverLineText} cluster={hoverLine ? lineGeometry(scene, hoverLine).buildings : undefined} />
      )}
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
 * has one, else its number (`no`, from zoom 7: "Nr. 4", as the Fabrik page counts "Lkw-Station 4"), and the picture
 * of what lies in it; a problem station (no vehicles, nothing moved) in red.
 */
export function stationLabel(
  st: SceneStation, t: (k: string, o?: Record<string, unknown>) => string, number: Intl.NumberFormat, no: number | null = null,
): StationLabel {
  const dir = st.s.loading === false ? '↓' : '↑';
  const fill = stationFill(st);
  const rate = st.state === 'idle' ? t('factoryMap.station.idleShort')
    : fill !== null && st.state === 'active'
      ? t('factoryMap.station.rateFillShort', { rate: number.format(st.flow.itemsPerMin ?? 0), dir, fill: number.format(Math.round(fill * 100)) })
      : t('factoryMap.station.rateShort', { rate: number.format(st.flow.itemsPerMin ?? 0), dir });
  const head = st.s.name ?? (no !== null ? t('factoryMap.station.number', { n: no }) : null);
  return { text: head ? `${head} · ${rate}` : rate, problem: st.state !== 'active', item: st.flow.cargo?.[0]?.item ?? null };
}

/** Runs `fn` once the map has a size (a map created this moment may not have one yet: a fit would go to zoom 0). */
function whenSized(map: L.Map, fn: () => void): void {
  const size = map.getSize();
  if (size.x > 0 && size.y > 0) { fn(); return; }
  map.invalidateSize();
  if (map.getSize().x > 0 && map.getSize().y > 0) { fn(); return; }
  map.once('resize', fn);
}

/**
 * Fits the map to a box of map units, clear of the timeline, the info window (`withInfo`: on the right, on phones the
 * peek of the line card, `PEEK_SHARE`) and on phones the sheet.
 */
function fitBox(map: L.Map, box: { minX: number; minY: number; maxX: number; maxY: number }, mobile: boolean, withInfo: boolean): void {
  const pad = 0.6;
  const h = map.getSize().y;
  map.fitBounds(L.latLngBounds(ll(box.minX - pad, box.maxY + pad), ll(box.maxX + pad, box.minY - pad)), {
    paddingTopLeft: [24, 72],
    paddingBottomRight: mobile ? [24, withInfo ? PHONE_BOTTOM_PX + Math.round(h * PEEK_SHARE) + 24 : 24 + Math.round(h / 2)] : [withInfo ? 372 : 24, 140],
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
