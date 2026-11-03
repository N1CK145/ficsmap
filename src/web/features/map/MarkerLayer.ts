import L from 'leaflet';
import { COLLECTIBLE_TYPES, type CollectibleType } from '../../../shared/collectibleTypes.js';
import { PULSE_MS } from '../live/pulse.js';
import { CONFLICT_PULSE_MS } from './conflictPulse.js';
import { drawMarker, NO_PULSES, type MarkerPalette, type MarkerPulses } from './drawMarker.js';
import { DOT_ZOOM, type MarkerVisual } from './markerStyle.js';
import { pickNearest } from './pick.js';
import { onTypeImageLoad, typeImage } from './typeImages.js';

/** One marker as the layer draws it: plain data, no React. */
export interface DrawMarker {
  id: string;
  lat: number;
  lng: number;
  type: CollectibleType;
  visual: MarkerVisual;
  /** Unix ms until which a remote-change ring shows. */
  pulseUntil?: number;
  /** Unix ms until which the conflict badge pulses. */
  conflictPulseUntil?: number;
}

const PANE = 'ficsmap-markers';
/** Above tiles (200) and overlays (400), below Leaflet markers and popups. */
const PANE_Z = '450';
/** Markers this far outside the viewport are skipped; covers the badges and the pulse ring. */
const CULL_PX = 56;

function readPalette(): MarkerPalette | null {
  const style = getComputedStyle(document.documentElement);
  const token = (name: string) => style.getPropertyValue(`--color-${name}`).trim();
  const types: Record<string, string> = {};
  for (const t of COLLECTIBLE_TYPES) types[t.colorToken] = token(t.colorToken);
  const p: MarkerPalette = { bg: token('bg'), fg: token('fg'), accent: token('accent'), conflict: token('conflict'), power: token('power'), free: token('free'), types };
  // The stylesheet may not be applied yet; try again on the next draw instead of caching blanks.
  const complete = [p.bg, p.fg, p.accent, p.conflict, p.power, p.free, ...Object.values(types)].every(c => c !== '');
  return complete ? p : null;
}

/** Progress (0..1) of an animation of `duration` ms ending at `until`, or null when not running. */
function progress(until: number | undefined, duration: number, now: number): number | null {
  if (until === undefined || until <= now) return null;
  return Math.max(0, 1 - (until - now) / duration);
}

/**
 * All collectible markers on one <canvas> (spec §10.1: ~1.8k markers, no clustering). The canvas
 * covers the map container and is redrawn (coalesced to one frame) on move, zoom, resize and when
 * `redraw()` is called after data changes. During a zoom animation it is scaled like the tiles.
 * Clicks are not handled here; the map view asks `pick()` which marker is under a point.
 */
export class MarkerLayer extends L.Layer {
  private canvas: HTMLCanvasElement | null = null;
  private frame = 0;
  private animatingZoom = false;
  private palette: MarkerPalette | null = null;
  private unsubscribeImages: (() => void) | null = null;

  /** `datasetVersion`: where the types' game icons are loaded from; without it markers are shapes. */
  constructor(private readonly getMarkers: () => readonly DrawMarker[], private readonly datasetVersion?: string) {
    super();
  }

  override onAdd(map: L.Map): this {
    const pane = map.getPane(PANE) ?? map.createPane(PANE);
    pane.style.zIndex = PANE_Z;
    pane.style.pointerEvents = 'none';
    this.canvas = L.DomUtil.create('canvas', 'leaflet-zoom-animated', pane);
    if (this.datasetVersion !== undefined) this.unsubscribeImages = onTypeImageLoad(() => this.redraw());
    this.draw();
    return this;
  }

  override onRemove(): this {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.unsubscribeImages?.();
    this.unsubscribeImages = null;
    this.canvas?.remove();
    this.canvas = null;
    return this;
  }

  override getEvents(): Record<string, L.LeafletEventHandlerFn> {
    return {
      move: this.redraw,
      zoom: this.redraw,
      viewreset: this.redraw,
      resize: this.redraw,
      zoomanim: this.onZoomAnim as L.LeafletEventHandlerFn,
      zoomend: this.onZoomEnd,
    };
  }

  /** Schedules a redraw in the next animation frame; several calls in one frame draw once. */
  redraw(): this {
    if (!this.frame && this.canvas) {
      this.frame = requestAnimationFrame(() => {
        this.frame = 0;
        this.draw();
      });
    }
    return this;
  }

  /** The drawn marker nearest to a container point within `radiusPx`. */
  pick(x: number, y: number, radiusPx: number): string | null {
    const map = this._map as L.Map | undefined;
    if (!map) return null;
    const points: { id: string; px: number; py: number }[] = [];
    for (const m of this.getMarkers()) {
      if (!m.visual.draw) continue;
      const p = map.latLngToContainerPoint([m.lat, m.lng]);
      points.push({ id: m.id, px: p.x, py: p.y });
    }
    return pickNearest(points, x, y, radiusPx);
  }

  private onZoomAnim(e: L.ZoomAnimEvent): void {
    const map = this._map as L.Map | undefined;
    if (!map || !this.canvas) return;
    this.animatingZoom = true;
    // Where the canvas's top-left corner lands after the zoom, in the (unchanged) map pane.
    const topLeft = map.containerPointToLatLng([0, 0]);
    const target = map.project(topLeft, e.zoom).subtract(map.project(e.center, e.zoom)).add(map.getSize().divideBy(2));
    L.DomUtil.setTransform(this.canvas, map.containerPointToLayerPoint(target), map.getZoomScale(e.zoom, map.getZoom()));
  }

  private onZoomEnd(): void {
    this.animatingZoom = false;
    this.redraw();
  }

  private draw(): void {
    const map = this._map as L.Map | undefined;
    const canvas = this.canvas;
    // A frame in the middle of a zoom animation would undo its transform; zoomend redraws.
    if (!map || !canvas || this.animatingZoom) return;

    const size = map.getSize();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(size.x * dpr);
    const h = Math.round(size.y * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      canvas.style.width = `${size.x}px`;
      canvas.style.height = `${size.y}px`;
    }
    L.DomUtil.setPosition(canvas, map.containerPointToLayerPoint([0, 0]));

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.x, size.y);
    this.palette ??= readPalette();
    const palette = this.palette;
    if (!palette) return;

    const now = Date.now();
    // Dots follow the zoom of this frame; the markers' own flag may still be from the last zoom.
    const dot = map.getZoom() < DOT_ZOOM;
    let pulsing = false;
    for (const m of this.getMarkers()) {
      if (!m.visual.draw) continue;
      const p = map.latLngToContainerPoint([m.lat, m.lng]);
      if (p.x < -CULL_PX || p.y < -CULL_PX || p.x > size.x + CULL_PX || p.y > size.y + CULL_PX) continue;
      const remote = progress(m.pulseUntil, PULSE_MS, now);
      const conflict = progress(m.conflictPulseUntil, CONFLICT_PULSE_MS, now);
      const pulses: MarkerPulses = remote === null && conflict === null ? NO_PULSES : { remote, conflict };
      if (pulses !== NO_PULSES) pulsing = true;
      const v = m.visual.dot === dot ? m.visual : { ...m.visual, dot };
      const img = this.datasetVersion !== undefined && !dot ? typeImage(this.datasetVersion, m.type) : null;
      drawMarker(ctx, p.x, p.y, m.type, v, palette, pulses, img);
    }
    // Pulses animate: keep drawing frames until they are over.
    if (pulsing) this.redraw();
  }
}
