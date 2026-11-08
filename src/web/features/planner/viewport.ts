import { wheelDeltaPx } from '../map/wheelZoom.js';
import { initialScroll, type DiagramDirection, type DiagramLayout, type DiagramNode, type GraphLink } from './diagramLayout.js';

/**
 * The view onto a diagram, like a map's: content point (cx, cy) shows at box point (x + cx·k, y + cy·k). Pure math for
 * `FlowDiagram`'s panning and zooming (`test/unit/diagramViewport.test.ts`).
 */
export interface View { x: number; y: number; k: number }
export interface Size { width: number; height: number }
export interface Point { x: number; y: number }
export interface Rect extends Point, Size {}
export interface ScaleLimits { min: number; max: number }

/** Zoomed in no further: 12 px labels at 24 px, still sharp. */
export const MAX_SCALE = 2;
/** Zoomed out at least this far (an overview); further only where the whole diagram needs it to fit. */
export const MIN_SCALE = 0.25;
/** Never smaller than this, even to fit a huge diagram. */
const FLOOR_SCALE = 0.02;
/** How far the content can be dragged past the box's edge. */
export const SLACK = 48;
/** Room around the diagram when it is fitted, and around a node brought into view. */
export const FIT_PAD = 16;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const hasSize = (s: Size) => s.width > 0 && s.height > 0;

/** The scale at which the whole diagram fits the box (with `FIT_PAD` around it), never above 1. */
export function fitScale(content: Size, box: Size): number {
  if (!hasSize(content) || !hasSize(box)) return 1;
  const k = Math.min((box.width - 2 * FIT_PAD) / content.width, (box.height - 2 * FIT_PAD) / content.height, 1);
  return Math.max(FLOOR_SCALE, k);
}

/** Zoom limits: `MAX_SCALE` in, out to `MIN_SCALE` or as far as fitting the whole diagram needs. */
export function scaleLimits(content: Size, box: Size): ScaleLimits {
  return { min: Math.min(MIN_SCALE, fitScale(content, box)), max: MAX_SCALE };
}

/**
 * Keep the content in reach: a side larger than the box can be dragged until its far edge is `SLACK` inside the box;
 * a side smaller than the box stays centred (with up to `SLACK` of play when it nearly fills it).
 */
export function clampView(view: View, content: Size, box: Size): View {
  if (!hasSize(box)) return view;
  const axis = (pos: number, size: number, room: number) => {
    const free = room - size;
    return clamp(pos, Math.min(free - SLACK, free / 2), Math.max(SLACK, free / 2));
  };
  return { k: view.k, x: axis(view.x, content.width * view.k, box.width), y: axis(view.y, content.height * view.k, box.height) };
}

/** Zoom to scale `k` (within `limits`) so the content under `at` (a box point) stays there. */
export function zoomAt(view: View, k: number, at: Point, limits: ScaleLimits): View {
  const next = clamp(k, limits.min, limits.max);
  const f = next / view.k;
  return { k: next, x: at.x - (at.x - view.x) * f, y: at.y - (at.y - view.y) * f };
}

/** The whole diagram in the box, centred. */
export function fitView(content: Size, box: Size): View {
  const k = fitScale(content, box);
  return { k, x: (box.width - content.width * k) / 2, y: (box.height - content.height * k) / 2 };
}

/** The smallest pan that brings `rect` (content coordinates) into the box with `FIT_PAD` around it; its top left wins where it does not fit. */
export function revealRect(view: View, rect: Rect, box: Size): View {
  if (!hasSize(box)) return view;
  const axis = (pos: number, start: number, size: number, room: number) => {
    const a = pos + start * view.k;
    const b = a + size * view.k;
    if (a < FIT_PAD || b - a > room - 2 * FIT_PAD) return pos + FIT_PAD - a;
    if (b > room - FIT_PAD) return pos - (b - (room - FIT_PAD));
    return pos;
  };
  return { k: view.k, x: axis(view.x, rect.x, rect.width, box.width), y: axis(view.y, rect.y, rect.height, box.height) };
}

/**
 * How much one wheel event zooms, at the user's wheel speed (`speed`, 0.25–3, app/prefs.ts): the delta in pixels as the
 * map counts it (`wheelDeltaPx`: a line 100/3 px, a page `pagePx`), so a mouse's notch (100 px) at 1× is about 1.2×,
 * at 3× about 1.8×; a trackpad pinch (a wheel event with `ctrlKey` and small deltas) in proportion. At most 2× either
 * way per event.
 */
export function wheelFactor(e: { deltaY: number; deltaMode: number; ctrlKey: boolean }, speed = 1, pagePx = 800): number {
  const px = wheelDeltaPx(e, pagePx);
  return clamp(Math.exp(-px * speed * (e.ctrlKey ? 0.01 : 0.002)), 0.5, 2);
}

/**
 * Two fingers: the view at the gesture's start (`start`, fingers at `from`) scaled by how far apart the fingers are
 * now (`to`), the content under their first midpoint following their midpoint.
 */
export function pinchView(start: View, from: readonly [Point, Point], to: readonly [Point, Point], limits: ScaleLimits): View {
  const dist = (p: readonly [Point, Point]) => Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
  const mid = (p: readonly [Point, Point]) => ({ x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 });
  const d0 = dist(from);
  const k = clamp(d0 > 0 ? (start.k * dist(to)) / d0 : start.k, limits.min, limits.max);
  const m0 = mid(from);
  const m1 = mid(to);
  const cx = (m0.x - start.x) / start.k;
  const cy = (m0.y - start.y) / start.k;
  return { k, x: m1.x - cx * k, y: m1.y - cy * k };
}

/** Which sides the content continues past the box (for the fades). */
export function overflowSides(view: View, content: Size, box: Size): { left: boolean; right: boolean; top: boolean; bottom: boolean } {
  if (!hasSize(box)) return { left: false, right: false, top: false, bottom: false };
  return {
    left: view.x < -1,
    right: view.x + content.width * view.k > box.width + 1,
    top: view.y < -1,
    bottom: view.y + content.height * view.k > box.height + 1,
  };
}

/**
 * Where a diagram opens, at 100 %: a narrower one centred; a wider one with the `focus` node in the middle (the
 * factory's bottleneck), else whole nodes of its top row (`initialScroll`), never with a node cut at the left edge.
 * The top first where it is taller than the box, else centred; the `focus` node is in view either way. Left to right
 * (`direction`) the same with the axes swapped: whole nodes of the first column, the left first. Where the diagram
 * starts at the top of the box, it starts `topInset` lower (room for the zoom keys over the top right corner).
 */
export function initialView(
  layout: Pick<DiagramLayout<GraphLink>, 'nodes' | 'width' | 'height'>, box: Size, focus: string | null, direction: DiagramDirection = 'down',
  topInset = 0,
): View {
  if (!hasSize(box)) return { x: 0, y: 0, k: 1 };
  if (direction === 'right') {
    const turn = <T extends { x: number; y: number; width: number; height: number }>(r: T): T => ({ ...r, x: r.y, y: r.x, width: r.height, height: r.width });
    const v = initialView({ nodes: layout.nodes.map(turn), width: layout.height, height: layout.width }, { width: box.height, height: box.width }, focus);
    return { x: v.y, y: v.x >= 0 ? Math.max(v.x, topInset) : v.x, k: 1 };
  }
  const y = layout.height > box.height ? topInset : Math.max(topInset, Math.round((box.height - layout.height) / 2));
  if (layout.width <= box.width) return withFocus({ x: Math.round((box.width - layout.width) / 2), y, k: 1 }, layout, box, focus);
  const target: DiagramNode | undefined = focus ? layout.nodes.find(n => n.item === focus) : undefined;
  let left = target ? target.x + target.width / 2 - box.width / 2 : initialScroll(layout, box.width);
  left = clamp(left, 0, layout.width - box.width);
  const cut = layout.nodes.find(n => n.x < left && n.x + n.width > left);
  if (cut && (!target || cut.x >= target.x + target.width - box.width)) left = Math.max(0, cut.x - FIT_PAD);
  return withFocus({ x: -Math.round(left), y, k: 1 }, layout, box, focus);
}

/** The focus node (if any) panned into view along the flow too. */
function withFocus(view: View, layout: Pick<DiagramLayout<GraphLink>, 'nodes'>, box: Size, focus: string | null): View {
  const target = focus ? layout.nodes.find(n => n.item === focus) : undefined;
  return target ? revealRect(view, target, box) : view;
}
