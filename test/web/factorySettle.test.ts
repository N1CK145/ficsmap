import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SETTLE_MS, useFactoryView } from '../../src/web/features/factory/view.js';

const settled = () => useFactoryView.getState().settled;

describe('factory view: the settled choice the Fabrikplan panel shows', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useFactoryView.getState().reset();
  });
  afterEach(() => {
    useFactoryView.getState().reset();
    vi.useRealTimers();
  });

  it('follows a choice made elsewhere at once', () => {
    useFactoryView.getState().select(4);
    useFactoryView.getState().compareWith(3);
    expect(settled()).toEqual({ selectedId: 4, compareId: 3 });
  });

  it('waits until the timeline rested for SETTLE_MS after its last input', () => {
    const v = useFactoryView.getState();
    v.select(1, { input: true });
    vi.advanceTimersByTime(SETTLE_MS - 500);
    v.select(2, { input: true });
    // The comparison following the step waits with it.
    v.compareWith(1);
    vi.advanceTimersByTime(SETTLE_MS - 1);
    expect(settled()).toEqual({ selectedId: null, compareId: null });
    vi.advanceTimersByTime(1);
    expect(settled()).toEqual({ selectedId: 2, compareId: 1 });
  });

  it('holds still while the slider is pressed or the timeline plays, and rests from letting go', () => {
    const v = useFactoryView.getState();
    v.hold('drag', true);
    v.select(1, { input: true });
    vi.advanceTimersByTime(SETTLE_MS * 5);
    expect(settled().selectedId).toBeNull();
    v.hold('play', true);
    v.hold('drag', false);
    vi.advanceTimersByTime(SETTLE_MS * 5);
    expect(settled().selectedId).toBeNull();
    v.hold('play', false);
    vi.advanceTimersByTime(SETTLE_MS - 1);
    expect(settled().selectedId).toBeNull();
    vi.advanceTimersByTime(1);
    expect(settled().selectedId).toBe(1);
  });

  it('catches up at once on settle (the user turned to the panel), and reset drops a pending catch-up', () => {
    const v = useFactoryView.getState();
    v.select(5, { input: true });
    v.settle();
    expect(settled().selectedId).toBe(5);
    v.select(6, { input: true });
    v.reset();
    vi.advanceTimersByTime(SETTLE_MS);
    expect(settled()).toEqual({ selectedId: null, compareId: null });
  });
});
