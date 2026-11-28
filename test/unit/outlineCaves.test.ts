import { describe, expect, it } from 'vitest';
import { entrancePoint, mergeOutlineCaves, outlineEntrancePoints, readOutlineCaves, type GeometryCave, type OutlineCave } from '../../scripts/outline-caves.js';
import type { CaveLayer } from '../../scripts/cave-geometry.js';

// Synthetic data only (the real outlines are third-party maintainer data). Units: UE cm.
const square = (x0: number, y0: number, s: number) => [[x0, y0], [x0 + s, y0], [x0 + s, y0 + s], [x0, y0 + s]];

describe('outline caves: input', () => {
  it('reads the outline file and rejects bad caves', () => {
    const caves = readOutlineCaves({ _source: {}, caves: [{ id: 3, outline: square(0, 0, 100), entrances: [[[0, 0], [10, 0]]] }] });
    expect(caves).toEqual([{ id: 3, outline: square(0, 0, 100), entrances: [[[0, 0], [10, 0]]] }]);
    expect(() => readOutlineCaves({ caves: [{ id: 3, outline: [[0, 0]], entrances: [] }] })).toThrow(/cave 3/);
    expect(() => readOutlineCaves({ caves: [{ id: 'x', outline: square(0, 0, 1), entrances: [] }] })).toThrow(/id/);
    expect(() => readOutlineCaves({ caves: [{ id: 1, outline: square(0, 0, 1), entrances: [[[0, 0], [1, 1]]] }, { id: 1, outline: square(0, 0, 1), entrances: [] }] })).toThrow(/twice/);
    expect(() => readOutlineCaves({})).toThrow(/caves/);
  });

  it('places an entrance halfway along its line, a closed line at its centre, with the height where given', () => {
    expect(entrancePoint([[0, 0], [100, 0]])).toEqual({ x: 50, y: 0 });
    expect(entrancePoint([[0, 0, 10], [100, 0, 30]])).toEqual({ x: 50, y: 0, z: 20 });
    expect(entrancePoint([[0, 0], [100, 0], [100, 300]])).toEqual({ x: 100, y: 100 });
    expect(entrancePoint([[0, 0], [100, 0], [100, 100], [0, 0]])).toEqual({ x: 200 / 3, y: 100 / 3 });
  });

  it('lists the entrance points of all caves in order', () => {
    const caves: OutlineCave[] = [
      { id: 1, outline: square(0, 0, 10), entrances: [[[0, 0], [2, 0]], [[0, 4], [0, 6]]] },
      { id: 2, outline: square(0, 0, 10), entrances: [[[8, 8], [10, 8]]] },
    ];
    expect(outlineEntrancePoints(caves)).toEqual([{ x: 1, y: 0 }, { x: 0, y: 5 }, { x: 9, y: 8 }]);
    expect(outlineEntrancePoints([{ id: 3, outline: square(0, 0, 10), entrances: [[[0, 0, 4], [2, 0, 6]]] }])).toEqual([{ x: 1, y: 0, z: 5 }]);
  });
});

describe('outline caves: merged with the game geometry', () => {
  // Two volume groups of the game: g1 under x 0..10000, g2 under x 20000..30000 (y 0..10000).
  const geometry: GeometryCave[] = [
    { id: 'cave-001', min: [0, 0, 0], max: [10000, 10000, 1000], elements: [{ hull: square(0, 0, 10000), zMin: 0, zMax: 1000 }] },
    { id: 'cave-002', min: [20000, 0, 0], max: [30000, 10000, 1000], elements: [{ hull: square(20000, 0, 10000), zMin: 0, zMax: 1000 }] },
  ];
  // Outline caves: 7 inside g1 (with a hole), 9 far from any volume.
  const outlines: OutlineCave[] = [
    { id: 7, outline: square(1000, 1000, 4000), holes: [square(2000, 2000, 1000)], entrances: [[[1000, 1000], [1000, 2000]]] },
    { id: 9, outline: square(60000, 0, 2000), entrances: [[[60000, 0, 500], [60000, 1000, 500]]] },
  ];
  // The sampling found cave-001 (overlapping outline 7) and cave-002, which no outline has; cave-003 is a second
  // sampled cave in an outline-less place without entrances.
  const sampled: CaveLayer = {
    caves: [
      { id: 'cave-001', rings: [square(500, 500, 6000)], entrances: [{ x: 500, y: 600, z: 1 }] },
      { id: 'cave-002', rings: [square(21000, 1000, 3000)], entrances: [{ x: 21000, y: 1500, z: 2 }] },
    ],
    itemsInCaves: new Set(['in7', 'outside', 'in2', 'hole7']),
    underground: new Set(['deep9', 'deepEdge9', 'deepNowhere']),
    probeZ: [120, null],
  };
  const items = [
    { name: 'in7', x: 3000, y: 4000 }, // in the cave by the sampling and inside outline 7
    { name: 'outside', x: 6400, y: 6400 }, // by the sampling, outside every outline: a part of a cave the outline misses
    { name: 'hole7', x: 2500, y: 2500 }, // by the sampling, in the hole of outline 7
    { name: 'surface7', x: 3000, y: 3000 }, // inside outline 7, but the sampling says not in a cave (on the hill above)
    { name: 'deep9', x: 61000, y: 1000 }, // deep underground inside outline 9, outside every volume
    { name: 'deepEdge9', x: 62500, y: 1000 }, // deep underground, 5 m outside outline 9: still in (hand-drawn edge)
    { name: 'deepNowhere', x: 70000, y: 1000 }, // deep underground, far from every outline and volume
    { name: 'in2', x: 22000, y: 2000 }, // in the cave only the geometry has
  ];
  const r = mergeOutlineCaves({ outlines, sampled, geometry, items, landscapeZ: () => 777 });

  it('takes outlines and entrances from the outline caves, heights from the geometry, then the outline data, then the landscape', () => {
    expect(r.caves.map(c => [c.id, c.n, c.model])).toEqual([['sc-007', 7, 'cave-001'], ['sc-009', 9, undefined], ['cave-002', 10, 'cave-002']]);
    expect(r.caves[0]!.rings).toEqual([square(1000, 1000, 4000), square(2000, 2000, 1000)]);
    expect(r.caves[0]!.entrances).toEqual([{ x: 1000, y: 1500, z: 120 }]);
    expect(r.caves[1]!.entrances).toEqual([{ x: 60000, y: 500, z: 500 }]);
  });

  it('keeps sampled caves no outline overlaps, with their own outline and entrances', () => {
    expect(r.geometryOnly).toEqual(['cave-002']);
    expect(r.caves[2]!.rings).toEqual([square(21000, 1000, 3000)]);
    expect(r.caves[2]!.entrances).toEqual([{ x: 21000, y: 1500, z: 2 }]);
  });

  it('marks items in a cave where the geometry says so, and deep underground items inside an outline', () => {
    expect([...r.itemsInCaves].sort()).toEqual(['deep9', 'deepEdge9', 'hole7', 'in2', 'in7', 'outside']);
  });

  it('uses the landscape for an entrance without floor or given height', () => {
    const r2 = mergeOutlineCaves({ outlines: [{ id: 4, outline: square(0, 0, 100), entrances: [[[0, 0], [0, 100]]] }], sampled: { ...sampled, caves: [], probeZ: [null] }, geometry, items: [], landscapeZ: () => 777 });
    expect(r2.caves[0]!.entrances[0]!.z).toBe(777);
  });
});
