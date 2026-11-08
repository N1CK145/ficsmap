import { describe, expect, it } from 'vitest';
import { cavesToGeojson, cleanElements, type RawCaveElement } from '../../src/shared/caves.js';

const square = (x: number, y: number, size: number, zMin = 0, zMax = 1000): RawCaveElement => ({
  hull: [[x, y], [x + size, y], [x + size, y + size], [x, y + size]], zMin, zMax,
});

describe('cleanElements', () => {
  it('drops an element far larger than the rest of its volume in X/Y (broken brush)', () => {
    const els = [square(0, 0, 1000), square(1000, 0, 1000), square(2000, 0, 1000), square(0, 0, 45000)];
    expect(cleanElements(els)).toHaveLength(3);
  });
  it('keeps a large element under 300 m next to small ones (a hall drawn as one box)', () => {
    const els = [square(0, 0, 19000), square(19000, 0, 1000), square(19000, 1000, 300)];
    expect(cleanElements(els)).toHaveLength(3);
  });
  it('drops an element far taller than the rest', () => {
    const els = [square(0, 0, 1000), square(1000, 0, 1000), square(2000, 0, 1000), square(0, 0, 1000, 0, 4e7)];
    expect(cleanElements(els)).toHaveLength(3);
  });
  it('keeps volumes with fewer than three elements as they are', () => {
    expect(cleanElements([square(0, 0, 10), square(0, 0, 10000)])).toHaveLength(2);
  });
});

describe('cavesToGeojson', () => {
  it('writes one closed multi-ring polygon per cave and its entrances with height, rounded', () => {
    const gj = cavesToGeojson([{
      id: 'cave-001',
      rings: [[[0.4, 0], [10, 0], [10, 10]], [[2, 2], [3, 2], [3, 3]]],
      entrances: [{ x: 1.6, y: 2, z: -950.4 }],
    }]);
    expect(gj.features).toEqual([
      {
        type: 'Feature', properties: { kind: 'cave', id: 'cave-001' },
        geometry: { type: 'Polygon', coordinates: [[[0, 0], [10, 0], [10, 10], [0, 0]], [[2, 2], [3, 2], [3, 3], [2, 2]]] },
      },
      { type: 'Feature', properties: { kind: 'entrance', cave: 'cave-001', z: -950 }, geometry: { type: 'Point', coordinates: [2, 2] } },
    ]);
  });
});
