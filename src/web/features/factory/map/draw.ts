import { BANDS, type Band, type Reason } from '../../../../shared/factory/analysis.js';
import { REASON_PATHS } from '../icons.js';
import type { LineKind, MapKind } from './style.js';
import { BAND_TOKEN, KIND_TOKEN, LINE_TOKEN, MAP_KINDS } from './style.js';

/** The colours the factory canvas uses, read from the theme tokens once the stylesheet is applied. */
export interface FactoryPalette {
  bg: string; panel: string; fg: string; muted: string; accent: string; conflict: string; free: string; power: string;
  vehicle: string;
  onAccent: string;
  kinds: Record<MapKind, string>;
  bands: Record<Band, string>;
  lines: Record<LineKind, string>;
  floorEdge: string;
}

export function readFactoryPalette(): FactoryPalette | null {
  const style = getComputedStyle(document.documentElement);
  const token = (name: string) => style.getPropertyValue(`--color-${name}`).trim();
  const p: FactoryPalette = {
    bg: token('bg'), panel: token('panel'), fg: token('fg'), muted: token('muted'), accent: token('accent'),
    conflict: token('conflict'), free: token('free'), power: token('power'), vehicle: token('cat-vehicles'), onAccent: token('on-accent'),
    kinds: Object.fromEntries(MAP_KINDS.map(k => [k, token(KIND_TOKEN[k])])) as Record<MapKind, string>,
    bands: Object.fromEntries(BANDS.map(b => [b, token(BAND_TOKEN[b])])) as Record<Band, string>,
    lines: Object.fromEntries((Object.keys(LINE_TOKEN) as LineKind[]).map(k => [k, token(LINE_TOKEN[k])])) as Record<LineKind, string>,
    floorEdge: token('fac-floor-edge'),
  };
  const all = [p.bg, p.panel, p.fg, p.muted, p.accent, p.conflict, p.free, p.power, p.vehicle, p.onAccent, p.floorEdge,
    ...Object.values(p.kinds), ...Object.values(p.bands), ...Object.values(p.lines)];
  // The stylesheet may not be applied yet; try again on the next draw instead of caching blanks.
  return all.every(c => c !== '') ? p : null;
}

/** `#rrggbb` darkened towards black by `amount` (0..1), for outlines in the fill's own hue. */
export function shade(hex: string, amount: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1]!, 16);
  const f = (v: number) => Math.round(v * (1 - amount)).toString(16).padStart(2, '0');
  return `#${f((n >> 16) & 255)}${f((n >> 8) & 255)}${f(n & 255)}`;
}

const reasonPaths = new Map<Reason, Path2D>();

/**
 * A reason glyph (the factory page's reason icons, `REASON_PATHS`) in a dark disk of radius `r` CSS px centred at
 * (x, y), ringed in the machine's band colour, so the kind of problem reads without colour.
 */
export function drawReasonGlyph(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, reason: Reason, ring: string, p: FactoryPalette): void {
  let path = reasonPaths.get(reason);
  if (!path) reasonPaths.set(reason, (path = new Path2D(REASON_PATHS[reason])));
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = p.bg;
  ctx.fill();
  ctx.lineWidth = Math.max(1, r / 5);
  ctx.strokeStyle = ring;
  ctx.stroke();
  // The 16-unit icon in a square of 1.25 r.
  const k = (r * 1.25) / 16;
  ctx.translate(x - 8 * k, y - 8 * k);
  ctx.scale(k, k);
  ctx.strokeStyle = reason === 'noPower' ? p.power : p.fg;
  ctx.lineWidth = 1.8;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke(path);
  ctx.restore();
}

/** A station: a square plate with an arrow up (loading) or down (unloading), `s` CSS px across. */
export function drawStationSymbol(
  ctx: CanvasRenderingContext2D, x: number, y: number, s: number, loading: boolean | undefined, ring: string, p: FactoryPalette, dashed: boolean,
): void {
  const h = s / 2;
  ctx.save();
  ctx.fillStyle = p.panel;
  ctx.strokeStyle = ring;
  ctx.lineWidth = 2;
  if (dashed) ctx.setLineDash([3, 2]);
  ctx.beginPath();
  ctx.rect(x - h, y - h, s, s);
  ctx.fill();
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.strokeStyle = p.fg;
  ctx.lineWidth = Math.max(1.5, s / 9);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const a = s * 0.28;
  ctx.beginPath();
  if (loading === false) {
    ctx.moveTo(x, y - a); ctx.lineTo(x, y + a);
    ctx.moveTo(x - a * 0.8, y + a * 0.2); ctx.lineTo(x, y + a); ctx.lineTo(x + a * 0.8, y + a * 0.2);
  } else {
    ctx.moveTo(x, y + a); ctx.lineTo(x, y - a);
    ctx.moveTo(x - a * 0.8, y - a * 0.2); ctx.lineTo(x, y - a); ctx.lineTo(x + a * 0.8, y - a * 0.2);
  }
  ctx.stroke();
  ctx.restore();
}

/** A vehicle: an arrow head pointing along its heading (`yawDeg`, 0 = east, clockwise on screen), `s` CSS px long. */
export function drawVehicleArrow(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, yawDeg: number, fill: string, p: FactoryPalette): void {
  const a = (yawDeg * Math.PI) / 180;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(a);
  ctx.beginPath();
  ctx.moveTo(s / 2, 0);
  ctx.lineTo(-s / 2, s * 0.4);
  ctx.lineTo(-s * 0.25, 0);
  ctx.lineTo(-s / 2, -s * 0.4);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.strokeStyle = p.bg;
  ctx.lineWidth = 1.5;
  ctx.lineJoin = 'round';
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

/** A map marker: a diamond in the player's colour with a light edge; stamps are smaller disks. */
export function drawMarkerPin(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, stamp: boolean, p: FactoryPalette): void {
  ctx.save();
  ctx.beginPath();
  if (stamp) ctx.arc(x, y, 4, 0, Math.PI * 2);
  else {
    ctx.moveTo(x, y - 7); ctx.lineTo(x + 6, y); ctx.lineTo(x, y + 7); ctx.lineTo(x - 6, y); ctx.closePath();
  }
  ctx.fillStyle = color;
  ctx.strokeStyle = p.fg;
  ctx.lineWidth = 1.5;
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

/** A crate: a small box with a cross. */
export function drawCrate(ctx: CanvasRenderingContext2D, x: number, y: number, p: FactoryPalette): void {
  ctx.save();
  ctx.fillStyle = p.panel;
  ctx.strokeStyle = p.fg;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.rect(x - 5, y - 5, 10, 10);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x - 5, y - 5); ctx.lineTo(x + 5, y + 5);
  ctx.moveTo(x + 5, y - 5); ctx.lineTo(x - 5, y + 5);
  ctx.stroke();
  ctx.restore();
}

/** A label on a dark plate at (x, y), centred or starting there (`align`); `font` is a CSS font. */
export function drawLabel(
  ctx: CanvasRenderingContext2D, text: string, x: number, y: number, font: string, p: FactoryPalette, color = p.fg, align: 'center' | 'left' = 'center',
): void {
  ctx.save();
  ctx.font = font;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  const w = ctx.measureText(text).width;
  const left = align === 'center' ? x - w / 2 : x;
  ctx.fillStyle = `${p.bg}D9`;
  ctx.fillRect(left - 3, y - 8, w + 6, 16);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y + 0.5);
  ctx.restore();
}

/** A text cut with "…" to fit `maxWidth` px in the context's current font. */
export function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string | null {
  if (ctx.measureText(text).width <= maxWidth) return text;
  for (let n = text.length - 1; n >= 3; n--) {
    const t = `${text.slice(0, n).trimEnd()}…`;
    if (ctx.measureText(t).width <= maxWidth) return t;
  }
  return null;
}
