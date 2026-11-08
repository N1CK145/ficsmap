import { describe, expect, it } from 'vitest';
import type { DiagramNode } from '../../src/web/features/planner/diagramLayout.js';
import {
  FIT_PAD, MAX_SCALE, MIN_SCALE, SLACK, clampView, fitScale, fitView, initialView, overflowSides, pinchView, revealRect, scaleLimits, wheelFactor,
  zoomAt, type View,
} from '../../src/web/features/planner/viewport.js';

const box = { width: 400, height: 300 };
/** The content point shown at a box point. */
const under = (v: View, p: { x: number; y: number }) => ({ x: (p.x - v.x) / v.k, y: (p.y - v.y) / v.k });

describe('zoomAt', () => {
  it('keeps the content under the pointer where it is', () => {
    const v = { x: -120, y: 30, k: 1 };
    const at = { x: 250, y: 90 };
    const z = zoomAt(v, 1.5, at, { min: 0.25, max: 2 });
    expect(z.k).toBe(1.5);
    expect(under(z, at).x).toBeCloseTo(under(v, at).x);
    expect(under(z, at).y).toBeCloseTo(under(v, at).y);
  });

  it('stops at the limits', () => {
    const v = { x: 0, y: 0, k: 1 };
    expect(zoomAt(v, 9, { x: 0, y: 0 }, { min: 0.25, max: 2 }).k).toBe(2);
    expect(zoomAt(v, 0.01, { x: 0, y: 0 }, { min: 0.25, max: 2 }).k).toBe(0.25);
    // At a limit the view does not move either.
    expect(zoomAt({ x: 10, y: 20, k: 2 }, 3, { x: 100, y: 100 }, { min: 0.25, max: 2 })).toEqual({ x: 10, y: 20, k: 2 });
  });
});

describe('scaleLimits and fit', () => {
  it('zooms in to 2× and out to a quarter, or further where the whole diagram needs it', () => {
    expect(scaleLimits({ width: 800, height: 400 }, box)).toEqual({ min: MIN_SCALE, max: MAX_SCALE });
    const huge = { width: 10000, height: 2000 };
    expect(scaleLimits(huge, box).min).toBeCloseTo((400 - 2 * FIT_PAD) / 10000);
  });

  it('fits the whole diagram, centred, never above 100 %', () => {
    const content = { width: 1600, height: 300 };
    const v = fitView(content, box);
    expect(v.k).toBeCloseTo((400 - 2 * FIT_PAD) / 1600);
    expect(v.x).toBeCloseTo(FIT_PAD);
    expect(v.y).toBeCloseTo((300 - 300 * v.k) / 2);
    expect(fitScale({ width: 100, height: 100 }, box)).toBe(1);
    expect(fitScale({ width: 100, height: 100 }, { width: 0, height: 0 })).toBe(1);
  });
});

describe('clampView', () => {
  const content = { width: 1000, height: 300 };

  it('lets a wider diagram go no further than a little past its edges', () => {
    expect(clampView({ x: 500, y: 0, k: 1 }, content, box).x).toBe(SLACK);
    expect(clampView({ x: -5000, y: 0, k: 1 }, content, box).x).toBe(400 - 1000 - SLACK);
    expect(clampView({ x: -300, y: 0, k: 1 }, content, box).x).toBe(-300);
  });

  it('keeps a smaller diagram centred', () => {
    const v = clampView({ x: -200, y: 400, k: 0.2 }, content, box);
    expect(v.x).toBeCloseTo((400 - 200) / 2);
    expect(v.y).toBeCloseTo((300 - 60) / 2);
  });
});

describe('revealRect', () => {
  const view = { x: 0, y: 0, k: 1 };

  it('pans no more than needed to show a node, with room around it', () => {
    expect(revealRect(view, { x: 600, y: 20, width: 200, height: 50 }, box)).toEqual({ x: 400 - FIT_PAD - 800, y: 0, k: 1 });
    expect(revealRect({ x: -500, y: -100, k: 1 }, { x: 100, y: 50, width: 100, height: 50 }, box)).toEqual({ x: FIT_PAD - 100, y: FIT_PAD - 50, k: 1 });
    // Already in view: unchanged.
    expect(revealRect(view, { x: 50, y: 50, width: 100, height: 50 }, box)).toEqual(view);
  });

  it('counts the scale', () => {
    expect(revealRect({ x: 0, y: 0, k: 2 }, { x: 300, y: 0, width: 100, height: 50 }, box).x).toBe(400 - FIT_PAD - 800);
  });
});

describe('wheelFactor', () => {
  it('zooms in for a wheel turned up, out for down, about 1.2× a notch', () => {
    expect(wheelFactor({ deltaY: -100, deltaMode: 0, ctrlKey: false })).toBeCloseTo(Math.exp(0.2));
    expect(wheelFactor({ deltaY: 100, deltaMode: 0, ctrlKey: false })).toBeCloseTo(Math.exp(-0.2));
    // A notch in lines (3 lines) is a notch too, as the map counts it; a trackpad pinch (Ctrl) zooms in proportion.
    expect(wheelFactor({ deltaY: -3, deltaMode: 1, ctrlKey: false })).toBeCloseTo(Math.exp(0.2));
    expect(wheelFactor({ deltaY: -10, deltaMode: 0, ctrlKey: true })).toBeCloseTo(Math.exp(0.1));
    // At most 2× per event.
    expect(wheelFactor({ deltaY: -5000, deltaMode: 0, ctrlKey: false })).toBe(2);
  });

  it('zooms more per notch at a higher wheel speed', () => {
    const notch = { deltaY: -100, deltaMode: 0, ctrlKey: false };
    expect(wheelFactor(notch, 3)).toBeCloseTo(Math.exp(0.6));
    expect(wheelFactor(notch, 0.25)).toBeCloseTo(Math.exp(0.05));
    expect(wheelFactor(notch, 3)).toBeGreaterThan(wheelFactor(notch, 1));
    expect(wheelFactor(notch, 1)).toBeGreaterThan(wheelFactor(notch, 0.25));
  });
});

describe('pinchView', () => {
  it('scales by the fingers\' distance and follows their midpoint', () => {
    const start = { x: 0, y: 0, k: 1 };
    const v = pinchView(start, [{ x: 100, y: 100 }, { x: 200, y: 100 }], [{ x: 50, y: 120 }, { x: 250, y: 120 }], { min: 0.25, max: 2 });
    expect(v.k).toBe(2);
    // The content point under the first midpoint (150, 100) is under the new one (150, 120).
    expect(under(v, { x: 150, y: 120 })).toEqual({ x: 150, y: 100 });
  });
});

describe('overflowSides', () => {
  it('names the sides the diagram continues past the box', () => {
    expect(overflowSides({ x: -10, y: 0, k: 1 }, { width: 1000, height: 300 }, box)).toEqual({ left: true, right: true, top: false, bottom: false });
    expect(overflowSides({ x: 0, y: 0, k: 1 }, { width: 1000, height: 300 }, { width: 0, height: 0 }).right).toBe(false);
  });
});

describe('initialView', () => {
  const at = (item: string, row: number, x: number, width = 200): DiagramNode => ({ item, row, order: 0, x, y: row * 100, width, height: 80 });

  it('centres a diagram narrower than its box', () => {
    expect(initialView({ nodes: [at('a', 0, 0)], width: 300, height: 100 }, box, null)).toEqual({ x: 50, y: 100, k: 1 });
  });

  it('opens a wider one at its top row, or at the focus node, never with a node cut at the left', () => {
    const layout = { nodes: [at('a', 0, 0), at('b', 0, 1000), at('c', 1, 1600)], width: 2000, height: 600 };
    // The top row's nodes do not fit together: the one nearest the middle (b), centred.
    expect(initialView(layout, box, null)).toEqual({ x: -900, y: 0, k: 1 });
    // The focus node in the middle (c at 1600..1800 → 1500), then pushed right so no node is cut.
    expect(initialView(layout, box, 'c').x).toBe(-1500);
    expect(initialView({ ...layout, nodes: [...layout.nodes, at('d', 1, 1450)] }, box, 'c').x).toBe(-(1450 - FIT_PAD));
  });

  it('is plain 100 % where the box has no size yet', () => {
    expect(initialView({ nodes: [], width: 2000, height: 600 }, { width: 0, height: 0 }, null)).toEqual({ x: 0, y: 0, k: 1 });
  });
});
