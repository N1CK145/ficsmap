import 'leaflet/dist/leaflet.css';
import './map.css';
import L from 'leaflet';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { AttributionControl, MapContainer, TileLayer, ZoomControl, useMap } from 'react-leaflet';
import { useShallow } from 'zustand/react/shallow';
import { typeById, type CollectibleType } from '../../../shared/collectibleTypes.js';
import type { DatasetIndex, Item } from '../../../shared/dataset.js';
import { latLngToWorld, worldToLatLng } from '../../../shared/geo.js';
import { collect, type MapMode, type WorldCtx } from '../../app/feature.js';
import { useFeatures } from '../../app/FeaturesContext.js';
import { loadView, saveView, type PersistedView } from '../../app/persist.js';
import { useUiStore, type UiState } from '../../app/store.js';
import { useRemotePulse } from '../live/pulse.js';
import { hasMismatch, isCollected, useMarks, type MarksCache } from '../marks/useMarks.js';
import { useRouteIndex } from '../routes/useRoutes.js';
import { clickClaimed } from './clickClaims.js';
import { IMAGE_BOUNDS } from './imageBounds.js';
import { CONFLICT_PULSE_MS, newConflicts } from './conflictPulse.js';
import { DOT_ZOOM, markerState, markerVisual, podBadge, type MarkerState } from './markerStyle.js';
import { MarkerLayer, type DrawMarker } from './MarkerLayer.js';
import { prefersReducedMotion } from './motion.js';
import { currentMaxZoom } from './zoom.js';

const MAX_BOUNDS = L.latLngBounds(IMAGE_BOUNDS).pad(0.1);
/** Hit radius: covers the 42 px icon marker (mouse); half of the 44 px touch hit area (spec §10.1). */
const MOUSE_RADIUS = 21;
const TOUCH_RADIUS = 22;
const SAVE_DELAY_MS = 300;
/** On the map container while a marker is under the mouse (map.css). */
const HOVER_CLASS = 'ficsmap-marker-hover';

/**
 * The world map (spec §10, §11): the tiled in-game map in CRS.Simple with all collectibles drawn on
 * one canvas. The features' `mapLayers` render inside the map (they can use react-leaflet's
 * `useMap()`), `mapControls` stack under the zoom buttons, `mapOverlays` place themselves over it, and the active map mode's `Banner` runs
 * across the top. The viewport and filters are remembered per world.
 *
 * Controls, overlays and the banner are portalled into an overlay next to the Leaflet container: they keep the
 * map context (useMap) but their DOM events never reach Leaflet, so a click there is not a map
 * click, and React's own event handling works as anywhere else.
 */
export function MapView({ ctx }: { ctx: WorldCtx }) {
  const { t } = useTranslation();
  const features = useFeatures();
  const { layers, controls, overlays, modes } = useMemo(() => ({
    layers: collect(features, 'mapLayers'),
    controls: collect(features, 'mapControls'),
    overlays: collect(features, 'mapOverlays'),
    modes: collect(features, 'mapModes'),
  }), [features]);
  const interactionMode = useUiStore(s => s.interactionMode);
  const activeMode = modes.find(m => m.id === interactionMode);
  const Banner = activeMode?.Banner;
  // Read once: MapContainer takes its initial view only at creation.
  const [initial] = useState(() => {
    const v = loadView(ctx.worldId);
    return v?.center && v.zoom !== undefined ? { center: v.center, zoom: v.zoom } : { bounds: IMAGE_BOUNDS };
  });
  const version = encodeURIComponent(ctx.me.datasetVersion);
  const [overlay, setOverlay] = useState<HTMLDivElement | null>(null);

  return (
    <div className={`ficsmap-map-root absolute inset-0 ${Banner ? 'ficsmap-banner-on' : ''} ${activeMode?.onMapClick ? 'ficsmap-map-pick' : ''}`}>
      <MapContainer
        {...initial}
        crs={L.CRS.Simple}
        minZoom={0}
        // 7, or more while a layer that draws fine detail is on (zoom.ts); layers change it later with setMaxZoom.
        maxZoom={currentMaxZoom()}
        // Whole zoom levels only: scaled tiles at fractional zooms show seams.
        zoomSnap={1}
        maxBounds={MAX_BOUNDS}
        zoomControl={false}
        attributionControl={false}
        // isolate: Leaflet's pane z-indices stay inside the map, under the overlay.
        className="ficsmap-map isolate h-full w-full"
      >
        <TileLayer
          url={`/data/${version}/tiles/{z}/{x}/{y}.webp`}
          tileSize={256}
          maxNativeZoom={5}
          noWrap
          bounds={IMAGE_BOUNDS}
          className="ficsmap-tiles"
          attribution={t('map.attribution')}
        />
        <ZoomControl position="topright" zoomInTitle={t('map.zoomIn')} zoomOutTitle={t('map.zoomOut')} />
        <AttributionControl position="bottomright" prefix={false} />
        <Markers ctx={ctx} modes={modes} />
        {layers.map(l => <l.Component key={l.id} ctx={ctx} />)}
        {overlay && createPortal(
          <>
            {Banner && <BannerBar><Banner /></BannerBar>}
            {controls.length > 0 && (
              <div className="ficsmap-map-controls pointer-events-auto absolute right-[10px] flex flex-col items-end gap-2">
                {controls.map(c => <c.Component key={c.id} ctx={ctx} />)}
              </div>
            )}
            {overlays.map(o => <o.Component key={o.id} ctx={ctx} />)}
          </>,
          overlay,
        )}
        <ViewPersistence worldId={ctx.worldId} />
        <SizeWatcher />
      </MapContainer>
      <div ref={setOverlay} className="pointer-events-none absolute inset-0 z-[1000]" />
    </div>
  );
}

/**
 * The mode banner's bar across the top of the map: at least 40 px, taller when its text wraps (a
 * phone, German copy). Its real height goes into `--ficsmap-banner-h`, which moves the top
 * controls and the item panel below it (map.css).
 */
function BannerBar({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const root = document.documentElement;
    const update = () => root.style.setProperty('--ficsmap-banner-h', `${el.offsetHeight}px`);
    update();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    observer?.observe(el);
    return () => {
      observer?.disconnect();
      root.style.removeProperty('--ficsmap-banner-h');
    };
  }, []);
  return (
    <div ref={ref} className="pointer-events-auto absolute inset-x-0 top-0 flex min-h-10 flex-col bg-accent text-on-accent shadow-[0_4px_16px_rgb(0_0_0/0.4)]">
      <div className="flex flex-1 items-center justify-center px-3 py-1 text-center text-sm leading-snug font-semibold">{children}</div>
      {/* Hazard stripes along the lower edge: a mode is on and changes what a map click does. */}
      <div aria-hidden="true" className="h-1 shrink-0 hazard" />
    </div>
  );
}

interface BaseMarker { item: Item; lat: number; lng: number; type: CollectibleType }

type MarkerFilters = Pick<UiState, 'typeFilter' | 'visibility' | 'biomeScope' | 'onlyConflicts' | 'selectedActor' | 'searchHighlight'> & {
  /** A mode that takes points anywhere is on: the markers fade like non-matches of a search, so its points stand out. */
  picking: boolean;
};

/** Draw order: uncollected, collected, conflicts, search matches, then the selected marker on top. */
function rank(m: DrawMarker): number {
  if (m.visual.selected) return 4;
  if (m.visual.highlight) return 3;
  return m.visual.badge === 'conflict' ? 2 : m.visual.badge === 'check' ? 1 : 0;
}

function itemState(marks: MarksCache | undefined, actor: string): MarkerState {
  if (!marks) return 'uncollected';
  return markerState(isCollected(marks, actor), hasMismatch(marks, actor));
}

interface Pulses { remote: ReadonlyMap<string, number>; conflict: ReadonlyMap<string, number> }

/** Every dataset item as a drawable marker. Marks for actors not in the dataset are never drawn. */
function buildMarkers(
  base: readonly BaseMarker[], marks: MarksCache | undefined, f: MarkerFilters, zoom: number, pulses: Pulses | null,
  routeIndex: ReadonlyMap<string, number>,
): DrawMarker[] {
  const out: DrawMarker[] = base.map(({ item, lat, lng, type }) => {
    const visual = markerVisual(itemState(marks, item.name), {
      visibility: f.visibility,
      zoom,
      selected: f.selectedActor === item.name,
      inScope: f.biomeScope === null || item.biome === f.biomeScope,
      typeEnabled: f.typeFilter.has(item.type),
      onlyConflicts: f.onlyConflicts,
      routeIndex: routeIndex.get(item.name) ?? null,
      search: f.searchHighlight === null ? (f.picking ? false : null) : f.searchHighlight.has(item.name),
    });
    const pod = podBadge(item.extra?.pod);
    const m: DrawMarker = { id: item.name, lat, lng, type, visual: pod ? { ...visual, pod } : visual };
    const until = pulses?.remote.get(item.name);
    if (until !== undefined) m.pulseUntil = until;
    const conflictUntil = pulses?.conflict.get(item.name);
    if (conflictUntil !== undefined) m.conflictPulseUntil = conflictUntil;
    return m;
  });
  return out.filter(m => m.visual.draw).sort((a, b) => rank(a) - rank(b));
}

function baseMarkers(index: DatasetIndex): BaseMarker[] {
  return index.items.map(item => {
    const [lat, lng] = worldToLatLng(item.x, item.y, index.ds.bounds);
    return { item, lat, lng, type: typeById(item.type) };
  });
}

/** The marker canvas, its data, and marker clicks and hover. */
function Markers({ ctx, modes }: { ctx: WorldCtx; modes: readonly MapMode[] }) {
  const map = useMap();
  const marks = useMarks(ctx.worldId);
  const filters = useUiStore(useShallow((s): MarkerFilters => ({
    typeFilter: s.typeFilter, visibility: s.visibility, biomeScope: s.biomeScope, onlyConflicts: s.onlyConflicts, selectedActor: s.selectedActor,
    searchHighlight: s.searchHighlight, picking: modes.some(m => m.id === s.interactionMode && m.onMapClick !== undefined),
  })));
  const pulse = useRemotePulse(s => s.pulse);
  const routeIndex = useRouteIndex(ctx.worldId);
  const [reducedMotion] = useState(prefersReducedMotion);
  const [zoom, setZoom] = useState(() => map.getZoom());

  const base = useMemo(() => baseMarkers(ctx.index), [ctx.index]);
  const conflictPulse = useConflictPulse(base, marks, reducedMotion);
  const markers = useMemo(
    () => buildMarkers(base, marks, filters, zoom, reducedMotion ? null : { remote: pulse, conflict: conflictPulse }, routeIndex),
    [base, marks, filters, zoom, reducedMotion, pulse, conflictPulse, routeIndex],
  );

  const markersRef = useRef(markers);
  const layerRef = useRef<MarkerLayer | null>(null);
  const ctxRef = useRef(ctx);
  const modesRef = useRef(modes);
  useEffect(() => {
    ctxRef.current = ctx;
    modesRef.current = modes;
  });

  useEffect(() => {
    const layer = new MarkerLayer(() => markersRef.current, ctxRef.current.me.datasetVersion);
    layer.addTo(map);
    layerRef.current = layer;

    const activeMode = () => modesRef.current.find(m => m.id === useUiStore.getState().interactionMode);

    const pickAt = (e: L.LeafletMouseEvent) => {
      const pointerType = (e.originalEvent as Partial<PointerEvent>).pointerType;
      return layer.pick(e.containerPoint.x, e.containerPoint.y, pointerType === 'touch' ? TOUCH_RADIUS : MOUSE_RADIUS);
    };

    const onClick = (e: L.LeafletMouseEvent) => {
      const mode = activeMode();
      const z = map.getZoom();
      if (mode?.onMapClick) {
        // Points anywhere: a marker icon gives its position, everything else (dots included) the clicked one.
        const item = z < DOT_ZOOM ? undefined : ctxRef.current.index.byName.get(pickAt(e) ?? '');
        if (item) mode.onMarkerClick(item, ctxRef.current);
        else mode.onMapClick(latLngToWorld(e.latlng.lat, e.latlng.lng, ctxRef.current.index.ds.bounds), ctxRef.current);
        return;
      }
      // A layer drawn above the markers (resource nodes) takes clicks on what it shows while just looking around.
      if (useUiStore.getState().interactionMode === 'inspect' && clickClaimed(e.containerPoint.x, e.containerPoint.y)) return;
      const id = pickAt(e);
      if (id === null) return;
      if (z < DOT_ZOOM) {
        map.setZoomAround(e.latlng, z + 2);
        return;
      }
      const item = ctxRef.current.index.byName.get(id);
      if (!item) return;
      // Without a registered mode (only in tests) a click selects the item.
      if (mode) mode.onMarkerClick(item, ctxRef.current);
      else useUiStore.getState().select(item.name);
    };

    let hoverFrame = 0;
    let hoverPoint: L.Point | null = null;
    let dragging = false;
    const container = map.getContainer();
    const setHover = (hit: boolean) => {
      container.classList.toggle(HOVER_CLASS, hit);
      const cursor = activeMode()?.cursor;
      if (hit && cursor) container.style.setProperty('--ficsmap-marker-cursor', cursor);
      else container.style.removeProperty('--ficsmap-marker-cursor');
    };
    const onMouseMove = (e: L.LeafletMouseEvent) => {
      hoverPoint = e.containerPoint;
      if (hoverFrame || dragging) return;
      hoverFrame = requestAnimationFrame(() => {
        hoverFrame = 0;
        if (!hoverPoint || dragging) return;
        // A mode taking points anywhere does not snap to dots, so they get no pointer.
        const dotsArePoints = activeMode()?.onMapClick !== undefined && map.getZoom() < DOT_ZOOM;
        setHover(!dotsArePoints && layer.pick(hoverPoint.x, hoverPoint.y, MOUSE_RADIUS) !== null);
      });
    };
    const onMouseOut = () => {
      hoverPoint = null;
      setHover(false);
    };
    // While the map is dragged Leaflet's grabbing cursor shows, not the marker one.
    const onDragStart = () => {
      dragging = true;
      setHover(false);
    };
    const onDragEnd = () => { dragging = false; };
    const onZoomEnd = () => setZoom(map.getZoom());

    map.on('click', onClick);
    map.on('mousemove', onMouseMove);
    map.on('mouseout', onMouseOut);
    map.on('dragstart', onDragStart);
    map.on('dragend', onDragEnd);
    map.on('zoomend', onZoomEnd);
    return () => {
      map.off('click', onClick);
      map.off('mousemove', onMouseMove);
      map.off('mouseout', onMouseOut);
      map.off('dragstart', onDragStart);
      map.off('dragend', onDragEnd);
      map.off('zoomend', onZoomEnd);
      if (hoverFrame) cancelAnimationFrame(hoverFrame);
      setHover(false);
      layer.remove();
      layerRef.current = null;
    };
  }, [map]);

  // Before paint, so a frame the layer draws never uses the previous markers.
  useLayoutEffect(() => {
    markersRef.current = markers;
    layerRef.current?.redraw();
  }, [markers]);

  return null;
}

/**
 * Actor → unix ms until which its conflict badge pulses: once, when the actor becomes a conflict
 * (spec §10.1). Conflicts already there on the first load do not pulse.
 */
function useConflictPulse(base: readonly BaseMarker[], marks: MarksCache | undefined, reducedMotion: boolean): ReadonlyMap<string, number> {
  const conflicts = useMemo(
    () => (marks ? new Set(base.filter(b => itemState(marks, b.item.name) === 'conflict').map(b => b.item.name)) : null),
    [base, marks],
  );
  const prev = useRef<ReadonlySet<string> | null>(null);
  const [until, setUntil] = useState<ReadonlyMap<string, number>>(() => new Map());
  useEffect(() => {
    if (!conflicts) return;
    const fresh = newConflicts(prev.current, conflicts);
    prev.current = conflicts;
    if (fresh.length === 0 || reducedMotion) return;
    const now = Date.now();
    setUntil(current => {
      const next = new Map([...current].filter(([, u]) => u > now));
      for (const actor of fresh) next.set(actor, now + CONFLICT_PULSE_MS);
      return next;
    });
  }, [conflicts, reducedMotion]);
  return until;
}

/**
 * Saves the viewport and filters per world (spec §10), 300 ms after the last change. Only store
 * states of this map's own world count: on a world switch the layout enters the next world (in a
 * layout effect) before this map unmounts, and its filters must not end up under this world.
 */
function ViewPersistence({ worldId }: { worldId: string }) {
  const map = useMap();
  useLayoutEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let snapshot: PersistedView | null = null;
    const save = () => {
      timer = undefined;
      if (snapshot) saveView(worldId, snapshot);
      snapshot = null;
    };
    const schedule = () => {
      const s = useUiStore.getState();
      if (s.worldId !== worldId) return;
      const c = map.getCenter();
      snapshot = {
        ...loadView(worldId),
        center: [c.lat, c.lng],
        zoom: map.getZoom(),
        typeFilter: [...s.typeFilter],
        visibility: s.visibility,
        biomeScope: s.biomeScope,
      };
      clearTimeout(timer);
      timer = setTimeout(save, SAVE_DELAY_MS);
    };
    map.on('moveend', schedule);
    const unsubscribe = useUiStore.subscribe((s, prev) => {
      if (s.worldId !== worldId) return;
      if (s.typeFilter !== prev.typeFilter || s.visibility !== prev.visibility || s.biomeScope !== prev.biomeScope) schedule();
    });
    return () => {
      map.off('moveend', schedule);
      unsubscribe();
      // The pending snapshot was taken from this world's state only (see schedule).
      if (timer !== undefined) {
        clearTimeout(timer);
        save();
      }
    };
  }, [map, worldId]);
  return null;
}

/** Leaflet only watches the window; the map also resizes when the sidebar opens or closes. */
function SizeWatcher() {
  const map = useMap();
  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(map.getContainer());
    return () => observer.disconnect();
  }, [map]);
  return null;
}
