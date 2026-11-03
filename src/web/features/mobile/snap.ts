/** The bottom sheet's heights (spec §10.11): peek shows the progress chips, half the panels, full the list. */
export type Snap = 'peek' | 'half' | 'full';

export const SNAPS: readonly Snap[] = ['peek', 'half', 'full'];

/** Peek height in px; the Quick Check button and toasts sit above it. */
export const PEEK_PX = 96;

/** The round 56 px Quick Check button's distance from the viewport bottom: 16 px above the peek. */
export const QUICK_CHECK_BOTTOM_PX = PEEK_PX + 16;

/** Toasts on mobile clear the peek and the Quick Check button. */
export const TOAST_OFFSET_PX = QUICK_CHECK_BOTTOM_PX + 56;

/** Faster than this (px/ms) a release is a flick. */
const FLICK_PX_PER_MS = 0.5;

/** The pixel heights for a viewport: peek 96 px, half 50vh, full 92vh. */
export function snapHeights(viewportPx: number): Record<Snap, number> {
  return { peek: PEEK_PX, half: Math.round(viewportPx * 0.5), full: Math.round(viewportPx * 0.92) };
}

/** The size after `snap` for the handle button: peek → half → full → peek. */
export function nextSnap(snap: Snap): Snap {
  return SNAPS[(SNAPS.indexOf(snap) + 1) % SNAPS.length] ?? 'peek';
}

/**
 * Where a released sheet settles. `offsetPx` is its height at release (from the viewport bottom),
 * `velocityPxPerMs` how fast that height was changing (positive: growing, the finger moving up).
 * A flick (|v| > 0.5) goes to the next snap past the release point in that direction, or stays at
 * the last one; a slower release goes to the nearest snap.
 */
export function nearestSnap(offsetPx: number, velocityPxPerMs: number, heights: Record<Snap, number>): Snap {
  const byHeight = [...SNAPS].sort((a, b) => heights[a] - heights[b]);
  if (velocityPxPerMs > FLICK_PX_PER_MS) {
    return byHeight.find(s => heights[s] > offsetPx) ?? byHeight[byHeight.length - 1]!;
  }
  if (velocityPxPerMs < -FLICK_PX_PER_MS) {
    return [...byHeight].reverse().find(s => heights[s] < offsetPx) ?? byHeight[0]!;
  }
  return byHeight.reduce((best, s) => (Math.abs(heights[s] - offsetPx) < Math.abs(heights[best] - offsetPx) ? s : best));
}
