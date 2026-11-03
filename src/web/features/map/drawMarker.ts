import type { CollectibleType, MarkerShape } from '../../../shared/collectibleTypes.js';
import type { MarkerVisual } from './markerStyle.js';

/*
 * Marker drawing (spec §10.1) as pure functions on a 2D context. Coordinates are CSS pixels around
 * the marker centre. The geometry constants are shared with the SVG icons (TypeIcon.tsx).
 */

/** Resolved colours: the theme tokens, read at runtime (no raw hex here). */
export interface MarkerPalette { bg: string; fg: string; accent: string; conflict: string; power: string; free: string; types: Record<string, string> }

export const SHAPE = {
  circleR: 8,
  squareHalf: 7,
  squareRadius: 3,
  diamondHalf: 9,
  triangle: { top: -8.5, half: 8.5, bottom: 7 },
  /** The triangle's centroid sits below the marker centre; its glyph goes there. */
  triangleCentroidY: (-8.5 + 7 + 7) / 3,
} as const;

export const PIP_R = 1.7;
export const PIP_X: Record<1 | 2 | 3, readonly number[]> = { 1: [0], 2: [-2.4, 2.4], 3: [-4.4, 0, 4.4] };
export const RING_R = 3.2;
export const DISK_R = 2.6;

/** An Archimedean spiral for the Somersloop glyph. */
export const SWIRL: readonly (readonly [number, number])[] = Array.from({ length: 25 }, (_, i) => {
  const t = i / 24;
  const a = t * 2.6 * Math.PI;
  const r = 0.8 + t * 4.2;
  return [Math.cos(a) * r, Math.sin(a) * r] as const;
});

/** The check mark inside a collected marker. */
export const CHECK: readonly (readonly [number, number])[] = [[-3.6, 0.2], [-1, 2.8], [3.8, -2.6]];

const OUTLINE = 2;
const DOT_R = 5;
const SELECT_R = 12.5;
const SELECT_W = 3;
const BADGE = { x: 7, y: -7, r: 5 };
const ROUTE_BADGE = { x: -8, y: -8, r: 6.5 };

/** Game-icon markers: the icon on a dark disk (3 px padding around it) with a ring in the type colour. */
const ICON_SIZE = 32;
const ICON_PADDING = 3;
const ICON_RING = 2;
/** The disk's radius: half the icon, the padding, and the inner half of the ring. */
const ICON_DISC_R = ICON_SIZE / 2 + ICON_PADDING + ICON_RING / 2;
export const ICON = { size: ICON_SIZE, padding: ICON_PADDING, discR: ICON_DISC_R, ring: ICON_RING, collectedAlpha: 0.4 } as const;
const ICON_BADGE = { x: 15, y: -15, r: 5.5 };
const ICON_ROUTE_BADGE = { x: -16, y: -16, r: 7 };
const ICON_SELECT_R = ICON_DISC_R + 4;
const POD_BADGE = { x: 7, y: 6, r: 4.5 };
const ICON_POD_BADGE = { x: 14, y: 14, r: 6 };

/** A lightning bolt, centred on (0, 0), about 8 px high at scale 1. */
const BOLT: readonly (readonly [number, number])[] = [[0.9, -4.2], [-2.4, 0.6], [-0.2, 0.6], [-0.9, 4.2], [2.4, -0.8], [0.2, -0.8]];

type Badge = { x: number; y: number; r: number };

function shapePath(ctx: CanvasRenderingContext2D, shape: MarkerShape, x: number, y: number): void {
  ctx.beginPath();
  switch (shape) {
    case 'circle':
      ctx.arc(x, y, SHAPE.circleR, 0, Math.PI * 2);
      break;
    case 'square': {
      const h = SHAPE.squareHalf;
      ctx.roundRect(x - h, y - h, h * 2, h * 2, SHAPE.squareRadius);
      break;
    }
    case 'diamond': {
      const h = SHAPE.diamondHalf;
      ctx.moveTo(x, y - h);
      ctx.lineTo(x + h, y);
      ctx.lineTo(x, y + h);
      ctx.lineTo(x - h, y);
      ctx.closePath();
      break;
    }
    case 'triangle': {
      const { top, half, bottom } = SHAPE.triangle;
      ctx.moveTo(x, y + top);
      ctx.lineTo(x + half, y + bottom);
      ctx.lineTo(x - half, y + bottom);
      ctx.closePath();
      break;
    }
  }
}

function polyline(ctx: CanvasRenderingContext2D, pts: readonly (readonly [number, number])[], x: number, y: number): void {
  ctx.beginPath();
  pts.forEach(([px, py], i) => (i === 0 ? ctx.moveTo(x + px, y + py) : ctx.lineTo(x + px, y + py)));
}

function circle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
}

/** Pips (slugs) in white with a dark edge, or the type's glyph in the dark outline colour. */
function drawGlyph(ctx: CanvasRenderingContext2D, t: CollectibleType, x: number, y: number, p: MarkerPalette): void {
  if (t.pips > 0) {
    ctx.fillStyle = p.fg;
    ctx.strokeStyle = p.bg;
    ctx.lineWidth = 1;
    for (const dx of PIP_X[t.pips as 1 | 2 | 3]) {
      circle(ctx, x + dx, y, PIP_R);
      ctx.fill();
      ctx.stroke();
    }
    return;
  }
  ctx.strokeStyle = p.bg;
  ctx.fillStyle = p.bg;
  ctx.lineCap = 'round';
  switch (t.glyph) {
    case 'swirl':
      polyline(ctx, SWIRL, x, y);
      ctx.lineWidth = 1.6;
      ctx.stroke();
      break;
    case 'ring':
      circle(ctx, x, y, RING_R);
      ctx.lineWidth = 1.8;
      ctx.stroke();
      break;
    case 'disk':
      circle(ctx, x, y + SHAPE.triangleCentroidY, DISK_R);
      ctx.fill();
      break;
    case 'none':
      break;
  }
}

/** A red ring growing out of the conflict badge (or the dot); `progress` runs from 0 to 1. */
function drawBadgePulse(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, progress: number, p: MarkerPalette): void {
  const alpha = ctx.globalAlpha;
  circle(ctx, x, y, r + 1 + progress * 7);
  ctx.globalAlpha = alpha * (1 - progress);
  ctx.strokeStyle = p.conflict;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.globalAlpha = alpha;
}

function drawConflictBadge(ctx: CanvasRenderingContext2D, x: number, y: number, p: MarkerPalette, pulse: number | null, badge: Badge = BADGE): void {
  const bx = x + badge.x;
  const by = y + badge.y;
  if (pulse !== null) drawBadgePulse(ctx, bx, by, badge.r, pulse, p);
  circle(ctx, bx, by, badge.r);
  ctx.fillStyle = p.conflict;
  ctx.fill();
  ctx.strokeStyle = p.bg;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  // "!" drawn as a bar and a dot, so it does not depend on a loaded font.
  ctx.strokeStyle = p.fg;
  ctx.lineWidth = 1.8;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(bx, by - 2.6);
  ctx.lineTo(bx, by + 0.5);
  ctx.stroke();
  circle(ctx, bx, by + 2.5, 0.95);
  ctx.fillStyle = p.fg;
  ctx.fill();
}

/** Drop pods: a bolt on a yellow disk (opened with power) or a plain green dot (needs nothing). */
function drawPodBadge(ctx: CanvasRenderingContext2D, x: number, y: number, kind: 'power' | 'free', p: MarkerPalette, badge: Badge): void {
  const bx = x + badge.x;
  const by = y + badge.y;
  circle(ctx, bx, by, badge.r);
  ctx.fillStyle = kind === 'power' ? p.power : p.free;
  ctx.fill();
  ctx.strokeStyle = p.bg;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  if (kind === 'power') {
    const s = badge.r / 5.5;
    ctx.beginPath();
    BOLT.forEach(([px, py], i) => (i === 0 ? ctx.moveTo(bx + px * s, by + py * s) : ctx.lineTo(bx + px * s, by + py * s)));
    ctx.closePath();
    ctx.fillStyle = p.bg;
    ctx.fill();
  }
}

/** Stop `n` of the shown route; the start (0) reads "S". */
function drawRouteBadge(ctx: CanvasRenderingContext2D, x: number, y: number, n: number, p: MarkerPalette, badge: Badge = ROUTE_BADGE): void {
  const bx = x + badge.x;
  const by = y + badge.y;
  circle(ctx, bx, by, badge.r);
  ctx.fillStyle = p.accent;
  ctx.fill();
  ctx.strokeStyle = p.bg;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = p.bg;
  ctx.font = '700 9px "Barlow Condensed", ui-sans-serif, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(n === 0 ? 'S' : String(n), bx, by + 0.5);
}

/** An expanding, fading neutral ring; `progress` runs from 0 to 1 over the pulse. */
function drawPulse(ctx: CanvasRenderingContext2D, x: number, y: number, progress: number, dot: boolean, p: MarkerPalette, from = dot ? DOT_R + 1 : SELECT_R - 2): void {
  circle(ctx, x, y, from + progress * 14);
  ctx.globalAlpha = (1 - progress) * 0.9;
  ctx.strokeStyle = p.fg;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.globalAlpha = 1;
}

/** Animation progress (0..1) of a marker's pulses, or null when one is not running. */
export interface MarkerPulses {
  /** The neutral ring of a change by another member. */
  remote: number | null;
  /** The one-time pulse of the conflict badge. */
  conflict: number | null;
}

export const NO_PULSES: MarkerPulses = { remote: null, conflict: null };

/** The check mark of a collected marker, white over a dark edge. */
function drawCheck(ctx: CanvasRenderingContext2D, x: number, y: number, p: MarkerPalette, scale = 1): void {
  ctx.beginPath();
  CHECK.forEach(([px, py], i) => (i === 0 ? ctx.moveTo(x + px * scale, y + py * scale) : ctx.lineTo(x + px * scale, y + py * scale)));
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = p.bg;
  ctx.lineWidth = 3.5 * scale;
  ctx.stroke();
  ctx.strokeStyle = p.fg;
  ctx.lineWidth = 2 * scale;
  ctx.stroke();
}

/** A marker showing the type's game icon (zoomed in, icon loaded). Same states as the shape markers. */
function drawIconMarker(
  ctx: CanvasRenderingContext2D, x: number, y: number, img: CanvasImageSource, color: string, v: MarkerVisual, p: MarkerPalette, pulses: MarkerPulses,
): void {
  const conflictPulse = v.badge === 'conflict' ? pulses.conflict : null;
  const collected = v.badge !== 'none';
  ctx.globalAlpha = v.opacity * (collected ? 0.5 : 0.75);
  circle(ctx, x, y, ICON.discR);
  ctx.fillStyle = p.bg;
  ctx.fill();
  ctx.globalAlpha = v.opacity;
  ctx.strokeStyle = color;
  ctx.lineWidth = ICON.ring;
  ctx.stroke();
  ctx.globalAlpha = v.opacity * (collected ? ICON.collectedAlpha : 1);
  ctx.drawImage(img, x - ICON.size / 2, y - ICON.size / 2, ICON.size, ICON.size);
  ctx.globalAlpha = v.opacity;
  if (collected) drawCheck(ctx, x, y, p, 1.7);
  if (v.badge === 'conflict') drawConflictBadge(ctx, x, y, p, conflictPulse, ICON_BADGE);
  if (v.badge === 'none' && v.pod) drawPodBadge(ctx, x, y, v.pod, p, ICON_POD_BADGE);
  if (v.routeIndex !== null) drawRouteBadge(ctx, x, y, v.routeIndex, p, ICON_ROUTE_BADGE);
  ctx.globalAlpha = 1;
  if (v.selected) {
    circle(ctx, x, y, ICON_SELECT_R);
    ctx.strokeStyle = p.accent;
    ctx.lineWidth = SELECT_W;
    ctx.stroke();
  }
  if (pulses.remote !== null) drawPulse(ctx, x, y, pulses.remote, false, p, ICON_SELECT_R - 2);
}

/**
 * Draws one marker. The body and badges use `v.opacity`; the selection ring and the remote-change
 * ring are always fully opaque. With `img` (the type's game icon) a zoomed-in marker shows the icon;
 * without it, the type's shape.
 */
export function drawMarker(
  ctx: CanvasRenderingContext2D, x: number, y: number, t: CollectibleType, v: MarkerVisual, p: MarkerPalette, pulses: MarkerPulses,
  img: CanvasImageSource | null = null,
): void {
  if (img && !v.dot) {
    drawIconMarker(ctx, x, y, img, p.types[t.colorToken] ?? p.fg, v, p, pulses);
    return;
  }
  const pulse = pulses.remote;
  const conflictPulse = v.badge === 'conflict' ? pulses.conflict : null;
  const color = p.types[t.colorToken] ?? p.fg;

  if (v.dot) {
    ctx.globalAlpha = v.opacity;
    circle(ctx, x, y, DOT_R);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = v.badge === 'conflict' ? p.conflict : p.bg;
    ctx.lineWidth = v.badge === 'conflict' ? 1.5 : 1;
    ctx.stroke();
    if (conflictPulse !== null) drawBadgePulse(ctx, x, y, DOT_R, conflictPulse, p);
    ctx.globalAlpha = 1;
    if (v.selected) {
      circle(ctx, x, y, DOT_R + 3);
      ctx.strokeStyle = p.accent;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    if (pulse !== null) drawPulse(ctx, x, y, pulse, true, p);
    return;
  }

  ctx.globalAlpha = v.opacity;
  ctx.lineJoin = 'round';
  shapePath(ctx, t.shape, x, y);
  if (v.badge === 'none') {
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = p.bg;
    ctx.lineWidth = OUTLINE;
    ctx.stroke();
    drawGlyph(ctx, t, x, y, p);
    if (v.pod) drawPodBadge(ctx, x, y, v.pod, p, POD_BADGE);
  } else {
    // Collected: outline in the type colour over a dark halo, and a check mark.
    ctx.fillStyle = p.bg;
    ctx.globalAlpha = v.opacity * 0.6;
    ctx.fill();
    ctx.globalAlpha = v.opacity;
    ctx.strokeStyle = p.bg;
    ctx.lineWidth = OUTLINE + 2;
    ctx.stroke();
    ctx.strokeStyle = color;
    ctx.lineWidth = OUTLINE;
    ctx.stroke();
    drawCheck(ctx, x, y, p);
    if (v.badge === 'conflict') drawConflictBadge(ctx, x, y, p, conflictPulse);
  }
  if (v.routeIndex !== null) drawRouteBadge(ctx, x, y, v.routeIndex, p);
  ctx.globalAlpha = 1;

  if (v.selected) {
    circle(ctx, x, y, SELECT_R);
    ctx.strokeStyle = p.accent;
    ctx.lineWidth = SELECT_W;
    ctx.stroke();
  }
  if (pulse !== null) drawPulse(ctx, x, y, pulse, false, p);
}
