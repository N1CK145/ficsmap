import type { NodeKind, Purity } from '../../../shared/resourceNodes.js';

/*
 * Resource node markers as pure functions on a 2D context (CSS pixels around the node). A node is a disk
 * in its resource's colour with a contrasting ring; its purity is a row of 1 (impure), 2 (normal) or 3
 * (pure) pips under it, and from LABEL_ZOOM the resource's short label sits in the disk, so neither depends
 * on colour. A well's core is a hollow ring (it has no purity). Below PIP_ZOOM nodes are dots whose size
 * grows with the purity. A node with an extractor on it (last save import) gets a small square above it, and from
 * LABEL_ZOOM a tag naming the building (Mk.2, Oil, ...) with one diamond per Power Shard next to it.
 */

export const PIP_ZOOM = 2;
export const LABEL_ZOOM = 4;

export type NodeSize = 'dot' | 'small' | 'full';
export function nodeSize(zoom: number): NodeSize {
  return zoom < PIP_ZOOM ? 'dot' : zoom < LABEL_ZOOM ? 'small' : 'full';
}

export const PURITY_PIPS: Record<Purity, 1 | 2 | 3> = { impure: 1, normal: 2, pure: 3 };

const RADIUS: Record<NodeSize, number> = { dot: 0, small: 6, full: 10 };
const DOT_R: Record<Purity, number> = { impure: 2.5, normal: 3.5, pure: 4.5 };
const SATELLITE_SCALE = 0.8;
const PIP = { small: { r: 1.9, gap: 5 }, full: { r: 2.4, gap: 6.2 } } as const;

/** Resolved theme colours (tokens read at runtime; no raw values here). */
export interface NodePalette { bg: string; fg: string; accent: string; shard: string; resources: Record<string, string> }

/** The extractor on a node as the map shows it: the building's short name and the Power Shards in it (all extractors). */
export interface DrawExtractor { label: string; shards: number }

export interface DrawNode {
  id: string;
  lat: number;
  lng: number;
  kind: NodeKind;
  purity: Purity | null;
  /** Colour token of the resource (resourceStyle.ts). */
  token: string;
  /** Short resource label for the disk. */
  label: string;
  /** The last save import changed resource or purity: a small accent badge. */
  changed: boolean;
  /** An extractor stands on the node (last save import). */
  extractor?: DrawExtractor;
}

/** Relative luminance (WCAG) of a `#rrggbb` colour; 1 (light) for anything else. */
export function luminance(color: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return 1;
  const n = parseInt(m[1]!, 16);
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}

/** Dark fills get a light ring and label, light fills a dark one. */
export function contrastOn(fill: string, p: Pick<NodePalette, 'bg' | 'fg'>): string {
  return luminance(fill) < 0.18 ? p.fg : p.bg;
}

/** The marker's disk radius at a size (0 for a core at dot size: cores are not drawn there). */
export function nodeRadius(n: Pick<DrawNode, 'kind' | 'purity'>, size: NodeSize): number {
  if (size === 'dot') return n.kind === 'core' ? 0 : DOT_R[n.purity ?? 'normal'];
  return RADIUS[size] * (n.kind === 'satellite' ? SATELLITE_SCALE : 1);
}

/** The pip centres' x offsets for a purity, centred on 0. */
export function pipOffsets(purity: Purity, gap: number): number[] {
  const n = PURITY_PIPS[purity];
  return Array.from({ length: n }, (_, i) => (i - (n - 1) / 2) * gap);
}

export function drawNode(ctx: CanvasRenderingContext2D, x: number, y: number, n: DrawNode, size: NodeSize, p: NodePalette, highlighted = false): void {
  const r = nodeRadius(n, size);
  if (r === 0) return;
  const fill = p.resources[n.token] ?? p.fg;
  const contrast = contrastOn(fill, p);

  if (highlighted) {
    ctx.beginPath();
    ctx.arc(x, y, r + 4, 0, Math.PI * 2);
    ctx.strokeStyle = p.accent;
    ctx.lineWidth = 2.5;
    ctx.stroke();
  }

  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  if (n.kind === 'core') {
    // A well's centre: a hollow ring in the resource colour.
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = p.bg;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = fill;
    ctx.lineWidth = size === 'full' ? 3 : 2;
    ctx.stroke();
    return;
  }
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = contrast;
  ctx.lineWidth = size === 'dot' ? 1 : 1.5;
  ctx.stroke();
  if (size === 'dot') return;

  if (size === 'full' && n.label) {
    ctx.fillStyle = contrast;
    ctx.font = `600 ${n.label.length > 2 ? 8 : 10}px "Barlow Condensed", ui-sans-serif, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(n.label, x, y + 0.5);
  }

  if (n.purity !== null) {
    const { r: pr, gap } = PIP[size];
    const py = y + r + pr + 2.5;
    for (const dx of pipOffsets(n.purity, gap)) {
      ctx.beginPath();
      ctx.arc(x + dx, py, pr, 0, Math.PI * 2);
      ctx.fillStyle = p.fg;
      ctx.fill();
      ctx.strokeStyle = p.bg;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  if (n.extractor) drawExtractor(ctx, x, y - r, n.extractor, size, p);

  if (n.changed) {
    const b = r * 0.72;
    ctx.beginPath();
    ctx.arc(x + b, y - b, size === 'full' ? 3.2 : 2.6, 0, Math.PI * 2);
    ctx.fillStyle = p.accent;
    ctx.fill();
    ctx.strokeStyle = p.bg;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

const TAG = { h: 11, pad: 3, font: 8, gap: 2 } as const;
const SHARD_R = 2.6;
const MARK = 5;

/**
 * Above a node (`top` = the disk's top edge): at `small` size a small square, at `full` size a tag with the
 * building's short name and one diamond per Power Shard to its right. Cores' pressurizers draw the same way.
 */
export function drawExtractor(ctx: CanvasRenderingContext2D, x: number, top: number, e: DrawExtractor, size: NodeSize, p: NodePalette): void {
  if (size === 'small') {
    ctx.beginPath();
    ctx.rect(x - MARK / 2, top - MARK - 1.5, MARK, MARK);
    ctx.fillStyle = p.fg;
    ctx.fill();
    ctx.strokeStyle = p.bg;
    ctx.lineWidth = 1;
    ctx.stroke();
    return;
  }
  ctx.font = `600 ${TAG.font}px "Barlow Condensed", ui-sans-serif, system-ui, sans-serif`;
  const textW = typeof ctx.measureText === 'function' ? ctx.measureText(e.label).width : e.label.length * 4.5;
  const shards = Math.min(e.shards, 3);
  const shardsW = shards > 0 ? TAG.gap + shards * (SHARD_R * 2 + 1) : 0;
  const w = textW + TAG.pad * 2;
  const left = x - (w + shardsW) / 2;
  const y = top - TAG.h - 1.5;
  ctx.beginPath();
  ctx.rect(left, y, w, TAG.h);
  ctx.fillStyle = p.bg;
  ctx.fill();
  ctx.strokeStyle = p.fg;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = p.fg;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(e.label, left + w / 2, y + TAG.h / 2 + 0.5);
  for (let i = 0; i < shards; i++) {
    const cx = left + w + TAG.gap + SHARD_R + i * (SHARD_R * 2 + 1);
    const cy = y + TAG.h / 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy - SHARD_R - 1);
    ctx.lineTo(cx + SHARD_R, cy);
    ctx.lineTo(cx, cy + SHARD_R + 1);
    ctx.lineTo(cx - SHARD_R, cy);
    ctx.closePath();
    ctx.fillStyle = p.shard;
    ctx.fill();
    ctx.strokeStyle = p.bg;
    ctx.lineWidth = 0.75;
    ctx.stroke();
  }
}
