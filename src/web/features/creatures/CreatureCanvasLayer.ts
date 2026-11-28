import L from 'leaflet';
import { CREATURE_FAMILIES, type CreatureFamily } from '../../../shared/creatures.js';

export const CREATURE_PANE = 'ficsmap-creatures';
/** Like the resource nodes (455): above the collectible markers (450), below the vehicle route (460). */
export const CREATURE_PANE_Z = 452;
const CULL_PX = 20;
/** From this zoom on the creature's picture; below it a dot in the family's colour. */
export const PICTURE_ZOOM = 5;
/** Half the diagonal of the low-zoom diamond. */
const DOT_R = 6;
const PICTURE_PX = 22;
/** Corner cut of the picture's plate (the windows' chamfer, small). */
const CUT = 5;
/** Beyond the marker; a finger needs more. */
const pickSlack = () => (typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches ? 12 : 4);

export interface DrawCreature {
  id: string;
  lat: number;
  lng: number;
  family: CreatureFamily;
  /** Picture URL (`/data/<v>/icons/<class>.png`). */
  icon: string;
  kills: number;
  /** Spawn points dead right now. */
  dead: number;
}

/** A diamond around (x, y) with half-diagonal r. */
function diamond(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.lineTo(x + r, y);
  ctx.lineTo(x, y + r);
  ctx.lineTo(x - r, y);
  ctx.closePath();
}

/** A square of half-side h around (x, y) with its corners cut by c (an octagon, like the windows' chamfer). */
function plate(ctx: CanvasRenderingContext2D, x: number, y: number, h: number, c: number): void {
  ctx.beginPath();
  ctx.moveTo(x - h + c, y - h);
  ctx.lineTo(x + h - c, y - h);
  ctx.lineTo(x + h, y - h + c);
  ctx.lineTo(x + h, y + h - c);
  ctx.lineTo(x + h - c, y + h);
  ctx.lineTo(x - h + c, y + h);
  ctx.lineTo(x - h, y + h - c);
  ctx.lineTo(x - h, y - h + c);
  ctx.closePath();
}

const images = new Map<string, HTMLImageElement>();
function image(url: string, onLoad: () => void): HTMLImageElement {
  let img = images.get(url);
  if (!img) {
    img = new Image();
    img.src = url;
    images.set(url, img);
  }
  if (!img.complete) img.addEventListener('load', onLoad, { once: true });
  return img;
}

function readPalette(): { bg: string; fg: string; conflict: string; disc: string; family: Record<CreatureFamily, string> } | null {
  const style = getComputedStyle(document.documentElement);
  const token = (n: string) => style.getPropertyValue(`--color-${n}`).trim();
  const family = Object.fromEntries(CREATURE_FAMILIES.map(f => [f, token(`cr-${f}`)])) as Record<CreatureFamily, string>;
  const p = { bg: token('bg'), fg: token('fg'), conflict: token('conflict'), disc: token('cr-disc'), family };
  return [p.bg, p.fg, p.conflict, p.disc, ...Object.values(family)].every(c => c !== '') ? p : null;
}

/** Radius of a marker at a zoom (for drawing and picking). */
export function creatureRadius(zoom: number): number {
  return zoom >= PICTURE_ZOOM ? PICTURE_PX / 2 + 2 : DOT_R;
}

/**
 * The creature spawners on one canvas in their own pane, redrawn (one frame at most) on move and zoom. Their shapes
 * are their own, so they never read as collectibles (circles): below zoom PICTURE_ZOOM a diamond in the family's
 * colour, hollow for a spawner never killed and filled for one killed before; from it the creature's picture on a
 * light plate with cut corners, framed in the family's colour, with the number of kills. Dead right now: a red stroke
 * across, drawn at full strength with a dark edge, at every zoom.
 */
export class CreatureCanvasLayer extends L.Layer {
  private canvas: HTMLCanvasElement | null = null;
  private frame = 0;
  private animatingZoom = false;
  private palette: ReturnType<typeof readPalette> = null;

  constructor(private readonly getItems: () => readonly DrawCreature[], private readonly getHighlight: () => string | null) {
    super();
  }

  override onAdd(map: L.Map): this {
    const pane = map.getPane(CREATURE_PANE) ?? map.createPane(CREATURE_PANE);
    pane.style.zIndex = String(CREATURE_PANE_Z);
    pane.style.pointerEvents = 'none';
    this.canvas = L.DomUtil.create('canvas', 'leaflet-zoom-animated', pane);
    this.draw();
    return this;
  }

  override onRemove(): this {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.canvas?.remove();
    this.canvas = null;
    return this;
  }

  override getEvents(): Record<string, L.LeafletEventHandlerFn> {
    return {
      move: this.redraw, zoom: this.redraw, viewreset: this.redraw, resize: this.redraw,
      zoomanim: this.onZoomAnim as L.LeafletEventHandlerFn, zoomend: this.onZoomEnd,
    };
  }

  redraw(): this {
    if (!this.frame && this.canvas) {
      this.frame = requestAnimationFrame(() => { this.frame = 0; this.draw(); });
    }
    return this;
  }

  pick(x: number, y: number): string | null {
    const map = this._map as L.Map | undefined;
    if (!map) return null;
    const r = creatureRadius(map.getZoom()) + pickSlack();
    let best: string | null = null;
    let bestD = Infinity;
    for (const c of this.getItems()) {
      const p = map.latLngToContainerPoint([c.lat, c.lng]);
      const d = Math.hypot(p.x - x, p.y - y);
      if (d <= r && d < bestD) { best = c.id; bestD = d; }
    }
    return best;
  }

  private onZoomAnim(e: L.ZoomAnimEvent): void {
    const map = this._map as L.Map | undefined;
    if (!map || !this.canvas) return;
    this.animatingZoom = true;
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
    if (!map || !canvas || this.animatingZoom) return;
    const size = map.getSize();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(size.x * dpr), h = Math.round(size.y * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w; canvas.height = h;
      canvas.style.width = `${size.x}px`; canvas.style.height = `${size.y}px`;
    }
    L.DomUtil.setPosition(canvas, map.containerPointToLayerPoint([0, 0]));
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.x, size.y);
    this.palette ??= readPalette();
    const pal = this.palette;
    if (!pal) return;
    const pictures = map.getZoom() >= PICTURE_ZOOM;
    const highlight = this.getHighlight();
    let top: { c: DrawCreature; x: number; y: number } | null = null;
    const strike = (x: number, y: number, r: number) => {
      ctx.beginPath();
      ctx.moveTo(x - r, y - r);
      ctx.lineTo(x + r, y + r);
      ctx.lineCap = 'round';
      ctx.lineWidth = 4.5;
      ctx.strokeStyle = pal.bg;
      ctx.stroke();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = pal.conflict;
      ctx.stroke();
      ctx.lineCap = 'butt';
    };
    const one = (c: DrawCreature, x: number, y: number, hi: boolean) => {
      const colour = pal.family[c.family];
      if (!pictures) {
        const r = hi ? DOT_R + 2 : DOT_R;
        diamond(ctx, x, y, r);
        if (c.kills > 0) {
          ctx.fillStyle = colour;
          ctx.fill();
          ctx.lineWidth = 1;
          ctx.strokeStyle = pal.bg;
          ctx.stroke();
        } else {
          // Hollow and fainter: the many never-killed spawners stay behind the killed ones. A dark halo under the
          // coloured edge, so it shows on light ground too.
          ctx.globalAlpha = hi ? 1 : 0.55;
          ctx.lineWidth = 3.5;
          ctx.strokeStyle = pal.bg;
          ctx.stroke();
          ctx.lineWidth = 1.75;
          ctx.strokeStyle = colour;
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
        if (c.dead > 0) strike(x, y, r * 0.75);
        return;
      }
      const h = PICTURE_PX / 2 + 1;
      plate(ctx, x, y, h, CUT);
      ctx.fillStyle = pal.disc;
      ctx.fill();
      ctx.lineWidth = hi ? 3.5 : c.kills > 0 ? 2.5 : 1.5;
      ctx.strokeStyle = hi ? pal.fg : colour;
      ctx.stroke();
      const img = image(c.icon, () => this.redraw());
      if (img.complete && img.naturalWidth > 0) {
        ctx.globalAlpha = c.dead > 0 && !hi ? 0.55 : 1;
        ctx.drawImage(img, x - PICTURE_PX / 2 + 1, y - PICTURE_PX / 2 + 1, PICTURE_PX - 2, PICTURE_PX - 2);
        ctx.globalAlpha = 1;
      }
      if (c.dead > 0) strike(x, y, h * 0.75);
      if (c.kills > 0) {
        const label = c.kills > 99 ? '99+' : String(c.kills);
        ctx.font = '600 11px Barlow, system-ui, sans-serif';
        const tw = ctx.measureText(label).width;
        const bx = x + h - 4, by = y + h - 6;
        ctx.fillStyle = pal.fg;
        ctx.fillRect(bx - 2, by - 1, tw + 4, 13);
        ctx.fillStyle = pal.bg;
        ctx.textBaseline = 'top';
        ctx.fillText(label, bx, by);
      }
    };
    for (const c of this.getItems()) {
      const p = map.latLngToContainerPoint([c.lat, c.lng]);
      if (p.x < -CULL_PX || p.y < -CULL_PX || p.x > size.x + CULL_PX || p.y > size.y + CULL_PX) continue;
      if (c.id === highlight) top = { c, x: p.x, y: p.y };
      else one(c, p.x, p.y, false);
    }
    if (top) one(top.c, top.x, top.y, true);
  }
}
