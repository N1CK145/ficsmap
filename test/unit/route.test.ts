import { describe, expect, it } from 'vitest';
import { leg, MAX_ROUTE_STOPS, nearestNeighbour, optimizeRoute, pathLength, type RoutePoint } from '../../src/shared/route.js';

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

describe('route through caves', () => {
  // A cave east of the start with its only entrance at x 1000; inside it, stops lie at x 1000..3000.
  const cave = { id: 'c1', entrances: [{ x: 1000, y: 0, z: 0 }] };
  const other = { id: 'c2', entrances: [{ x: 1000, y: 2000, z: 0 }, { x: 5000, y: 2000, z: 0 }] };
  const inCave = (id: string, x: number, y = 500): RoutePoint => ({ id, x, y, z: 0, cave });

  it('walks to a cave stop through the best entrance, and stays inside between stops of one cave', () => {
    expect(leg(origin, { x: 0, y: 500, z: 0 })).toEqual({ length: 500, via: [] });
    const a = inCave('a', 1000);
    expect(leg(origin, a)).toEqual({ length: 1000 + 500, via: [{ x: 1000, y: 0, z: 0 }] });
    expect(leg(a, origin)).toEqual({ length: 1500, via: [{ x: 1000, y: 0, z: 0 }] });
    expect(leg(a, inCave('b', 1000, 1500))).toEqual({ length: 1000, via: [] });
    // cave to another cave: out through one entrance, in through the other's nearest
    const b: RoutePoint = { id: 'b', x: 1000, y: 2500, z: 0, cave: other };
    expect(leg(a, b)).toEqual({ length: 500 + 2000 + 500, via: [{ x: 1000, y: 0, z: 0 }, { x: 1000, y: 2000, z: 0 }] });
    // a cave without entrances is walked like the open map
    expect(leg(origin, { x: 0, y: 300, z: 0, cave: { id: 'c3', entrances: [] } })).toEqual({ length: 300, via: [] });
  });

  it('measures and optimises with the cave legs', () => {
    expect(pathLength(origin, [inCave('a', 1000), inCave('b', 1000, 1500)])).toBe(1500 + 1000);
    // Straight-line, b (behind the cave wall, 600 from the start) would come first; through the entrance
    // it is about 2170 away, so the open-map stop o (1200 away) goes first and then the cave.
    const stops: RoutePoint[] = [inCave('b', 0, 600), { id: 'o', x: 0, y: -1200, z: 0 }];
    expect(optimizeRoute(origin, stops)).toEqual(['o', 'b']);
    expect(optimizeRoute(origin, stops.map(({ cave: _, ...p }) => p))).toEqual(['b', 'o']);
  });

  it('keeps the stops of one cave together', () => {
    const stops: RoutePoint[] = [inCave('c', 3000), { id: 'o', x: 2000, y: -300, z: 0 }, inCave('d', 3000, 1500), inCave('e', 1200)];
    const order = optimizeRoute(origin, stops);
    const at = (id: string) => order.indexOf(id);
    const caveStops = ['c', 'd', 'e'].map(at).sort((x, y) => x - y);
    expect(caveStops[2]! - caveStops[0]!).toBe(2);
  });
});
