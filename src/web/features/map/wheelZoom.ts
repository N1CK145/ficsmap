/**
 * The map's own mouse wheel zoom (instead of Leaflet's `scrollWheelZoom`): wheel deltas, scaled by the user's wheel
 * speed (app/prefs.ts), add up, and every `WHEEL_PX_PER_LEVEL` zoom one whole level. So at 1× one normal mouse notch
 * (100 px) is one level, at 0.5× two notches are one level, at 2× one notch is two levels. The map keeps whole zoom
 * levels (`zoomSnap` 1), so tiles and marker sizes stay crisp.
 *
 * Pure: `wheelZoomStep` takes the state and one event and returns the new state and the levels to zoom now.
 */

/** Wheel pixels (after the speed) for one zoom level: one notch of a usual mouse at 1×. */
export const WHEEL_PX_PER_LEVEL = 100;
/** A line of `deltaMode` 1 (Firefox with a mouse: 3 lines a notch), so a notch is 100 px there too. */
export const WHEEL_LINE_PX = 100 / 3;
/**
 * After this long without wheel events a half-turned step is forgotten. Long enough for slow, deliberate notches: at
 * 0.5× two notches half a second apart still make a level.
 */
export const WHEEL_IDLE_RESET_MS = 1000;
/**
 * After a zoom, wheel input of this long only fills up at most one more level, which is zoomed once the time is up.
 * A touchpad fling sends events for a second or more; this keeps it from running through every level.
 */
export const WHEEL_COOLDOWN_MS = 120;
/** The most levels a single event zooms (a big jump at 3× or a page-sized delta). */
export const WHEEL_MAX_LEVELS = 3;

export interface WheelZoomState {
  /** Accumulated wheel distance after the speed; positive zooms in. */
  px: number;
  /** Time of the last wheel event (ms). */
  lastAt: number;
  /** No zoom before this time (ms). */
  coolUntil: number;
}

export const WHEEL_ZOOM_IDLE: WheelZoomState = { px: 0, lastAt: -Infinity, coolUntil: -Infinity };

export interface WheelInput {
  deltaY: number;
  /** `WheelEvent.deltaMode`: 0 pixels, 1 lines, 2 pages. */
  deltaMode: number;
}

/** A wheel delta in pixels; `pagePx` is the height of a page (the map's height). Positive scrolls down. */
export function wheelDeltaPx({ deltaY, deltaMode }: WheelInput, pagePx: number): number {
  if (deltaMode === 1) return deltaY * WHEEL_LINE_PX;
  if (deltaMode === 2) return deltaY * pagePx;
  return deltaY;
}

const EPSILON = 1e-6;

/**
 * One wheel event (`input`), or with `input` null a tick at the end of the cooldown that zooms what is waiting.
 * Returns the new state and the whole levels to zoom now (positive in, negative out).
 */
export function wheelZoomStep(
  state: WheelZoomState, input: WheelInput | null, opts: { speed: number; now: number; pagePx: number },
): { state: WheelZoomState; levels: number } {
  const { speed, now, pagePx } = opts;
  let { px, lastAt } = state;
  const { coolUntil } = state;
  if (input) {
    if (now - lastAt > WHEEL_IDLE_RESET_MS) px = 0;
    // Scrolling down zooms out.
    const add = -wheelDeltaPx(input, pagePx) * speed;
    // A turn the other way starts over.
    if (add !== 0 && px !== 0 && Math.sign(add) !== Math.sign(px)) px = 0;
    px += add;
    lastAt = now;
  }
  if (now < coolUntil) {
    // At most one level waits for the end of the cooldown.
    px = Math.max(-WHEEL_PX_PER_LEVEL, Math.min(WHEEL_PX_PER_LEVEL, px));
    return { state: { px, lastAt, coolUntil }, levels: 0 };
  }
  const whole = Math.trunc(px / WHEEL_PX_PER_LEVEL + Math.sign(px) * EPSILON);
  const levels = Math.max(-WHEEL_MAX_LEVELS, Math.min(WHEEL_MAX_LEVELS, whole));
  if (levels === 0) return { state: { px, lastAt, coolUntil }, levels: 0 };
  // What is left over stays for the next step, but less than one level.
  const rest = px - levels * WHEEL_PX_PER_LEVEL;
  const capped = Math.abs(rest) < WHEEL_PX_PER_LEVEL - EPSILON ? rest : 0;
  return { state: { px: Math.abs(capped) < EPSILON ? 0 : capped, lastAt, coolUntil: now + WHEEL_COOLDOWN_MS }, levels };
}
