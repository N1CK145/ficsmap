import { describe, expect, it } from 'vitest';
import { MAX_ROUTE_STOPS, nearestNeighbour, optimizeRoute, pathLength, type RoutePoint } from '../../src/shared/route.js';

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function randomStops(n: number, seed: number): RoutePoint[] {
  const r = lcg(seed);
  return Array.from({ length: n }, (_, i) => ({ id: `p${i}`, x: r() * 100000, y: r() * 100000, z: r() * 5000 }));
}

const origin = { x: 0, y: 0, z: 0 };

describe('route', () => {
  it('exports the stop limit', () => {
    expect(MAX_ROUTE_STOPS).toBe(30);
  });

  it('handles 0 and 1 stops', () => {
    expect(optimizeRoute(origin, [])).toEqual([]);
    expect(optimizeRoute(origin, [{ id: 'a', x: 5, y: 5, z: 5 }])).toEqual(['a']);
  });

  it('pathLength is the open path length', () => {
    expect(pathLength(origin, [])).toBe(0);
    expect(pathLength(origin, [{ x: 3, y: 4, z: 0 }, { x: 3, y: 4, z: 12 }])).toBeCloseTo(17);
  });

  it('returns a permutation of the input ids', () => {
    const stops = randomStops(30, 7);
    const ids = optimizeRoute(origin, stops);
    expect([...ids].sort()).toEqual(stops.map((s) => s.id).sort());
  });

  it('is never longer than nearest neighbour and is deterministic', () => {
    for (const seed of [1, 2, 3, 42]) {
      const stops = randomStops(30, seed);
      const byId = new Map(stops.map((s) => [s.id, s]));
      const opt = optimizeRoute(origin, stops).map((id) => byId.get(id)!);
      expect(pathLength(origin, opt)).toBeLessThanOrEqual(pathLength(origin, nearestNeighbour(origin, stops)) + 1e-9);
      expect(optimizeRoute(origin, stops)).toEqual(optimizeRoute(origin, stops));
    }
  });

  it('orders collinear points from the start', () => {
    const stops: RoutePoint[] = [4, 1, 3, 5, 2].map((v) => ({ id: `c${v}`, x: v * 100, y: 0, z: 0 }));
    expect(optimizeRoute(origin, stops)).toEqual(['c1', 'c2', 'c3', 'c4', 'c5']);
  });

  it('does not mutate its input', () => {
    const stops = randomStops(10, 5);
    const copy = stops.map((s) => ({ ...s }));
    optimizeRoute(origin, stops);
    expect(stops).toEqual(copy);
  });

  it('finishes 30 stops in under 50 ms', () => {
    const stops = randomStops(30, 99);
    const t = performance.now();
    optimizeRoute(origin, stops);
    expect(performance.now() - t).toBeLessThan(50);
  });
});
