import {
  WHEEL_COOLDOWN_MS, WHEEL_IDLE_RESET_MS, WHEEL_ZOOM_IDLE, wheelDeltaPx, wheelZoomStep, type WheelInput, type WheelZoomState,
} from '../../src/web/features/map/wheelZoom.js';

const PAGE = 800;

/** Feeds events (deltaY, time) through the accumulator and returns the levels zoomed per event and the last state. */
function run(events: [number, number, number?][], speed: number, from: WheelZoomState = WHEEL_ZOOM_IDLE) {
  let state = from;
  const levels = events.map(([deltaY, now, deltaMode = 0]) => {
    const input: WheelInput = { deltaY, deltaMode };
    const r = wheelZoomStep(state, input, { speed, now, pagePx: PAGE });
    state = r.state;
    return r.levels;
  });
  return { levels, state };
}

describe('wheelDeltaPx', () => {
  it('turns lines and pages into pixels', () => {
    expect(wheelDeltaPx({ deltaY: 100, deltaMode: 0 }, PAGE)).toBe(100);
    expect(wheelDeltaPx({ deltaY: 3, deltaMode: 1 }, PAGE)).toBeCloseTo(100);
    expect(wheelDeltaPx({ deltaY: -1, deltaMode: 2 }, PAGE)).toBe(-PAGE);
  });
});

describe('wheelZoomStep', () => {
  it('zooms one level per 100 px notch at 1×; scrolling up zooms in, down out', () => {
    expect(run([[-100, 0]], 1).levels).toEqual([1]);
    expect(run([[100, 0]], 1).levels).toEqual([-1]);
  });

  it('takes two notches per level at 0.5× and gives two levels per notch at 2×', () => {
    expect(run([[-100, 0], [-100, 50]], 0.5).levels).toEqual([0, 1]);
    expect(run([[-100, 0]], 2).levels).toEqual([2]);
  });

  it('keeps what is left over: four notches at 0.75× zoom three levels', () => {
    expect(run([[-100, 0], [-100, 200], [-100, 400], [-100, 600]], 0.75).levels).toEqual([0, 1, 1, 1]);
  });

  it('treats a Firefox notch (3 lines) like a 100 px one, also at awkward speeds', () => {
    expect(run([[-3, 0, 1]], 1).levels).toEqual([1]);
    expect(run([[-3, 0, 1], [-3, 50, 1]], 0.5).levels).toEqual([0, 1]);
  });

  it('adds up small touchpad deltas', () => {
    const events: [number, number][] = Array.from({ length: 10 }, (_, i) => [-10, i * 16]);
    expect(run(events, 1).levels).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 1]);
  });

  it('forgets a half step after the idle time', () => {
    expect(run([[-100, 0], [-100, WHEEL_IDLE_RESET_MS + 1]], 0.5).levels).toEqual([0, 0]);
    expect(run([[-100, 0], [-100, WHEEL_IDLE_RESET_MS]], 0.5).levels).toEqual([0, 1]);
  });

  it('starts over when the direction changes', () => {
    expect(run([[-100, 0], [100, 50], [100, 100]], 0.5).levels).toEqual([0, 0, -1]);
  });

  it('holds at most one level during the cooldown and zooms it on the tick after it', () => {
    // A fling: big deltas every 16 ms.
    const fling: [number, number][] = Array.from({ length: 6 }, (_, i) => [-150, i * 16]);
    const { levels, state } = run(fling, 1);
    expect(levels).toEqual([1, 0, 0, 0, 0, 0]);
    expect(state.px).toBe(100);
    expect(wheelZoomStep(state, null, { speed: 1, now: WHEEL_COOLDOWN_MS - 1, pagePx: PAGE }).levels).toBe(0);
    const tick = wheelZoomStep(state, null, { speed: 1, now: WHEEL_COOLDOWN_MS, pagePx: PAGE });
    expect(tick.levels).toBe(1);
    expect(tick.state.px).toBe(0);
    expect(tick.state.coolUntil).toBe(2 * WHEEL_COOLDOWN_MS);
  });

  it('zooms at most three levels at once, without carrying the excess', () => {
    const r = run([[-2, 0, 2]], 1);
    expect(r.levels).toEqual([3]);
    expect(Math.abs(r.state.px)).toBeLessThan(100);
  });

  it('a tick with nothing waiting does nothing', () => {
    expect(wheelZoomStep(WHEEL_ZOOM_IDLE, null, { speed: 1, now: 0, pagePx: PAGE }).levels).toBe(0);
  });
});
