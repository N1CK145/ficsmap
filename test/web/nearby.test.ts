import type { Item } from '../../src/shared/dataset.js';
import { nearby } from '../../src/web/features/itemPanel/nearby.js';

/** An item `m` metres east of the origin and `zM` metres up (100 units = 1 m). */
const at = (name: string, m: number, zM = 0): Item => ({ name, type: 'somersloop', x: m * 100, y: 0, z: zM * 100, biome: 0, seq: 1 });

describe('nearby', () => {
  const self = at('self', 0);

  it('excludes the item itself', () => {
    expect(nearby(self, [self, at('a', 10)]).map(n => n.item.name)).toEqual(['a']);
  });

  it('returns at most 6 within 150 m, nearest first', () => {
    const items = [self, ...[70, 10, 60, 30, 20, 50, 40].map(m => at(`m${m}`, m))];
    const result = nearby(self, items);
    expect(result.map(n => n.item.name)).toEqual(['m10', 'm20', 'm30', 'm40', 'm50', 'm60']);
    expect(result[0]!.distM).toBeCloseTo(10);
  });

  it('excludes a candidate at 151 m and keeps one at 150 m', () => {
    expect(nearby(self, [self, at('far', 151), at('edge', 150)]).map(n => n.item.name)).toEqual(['edge']);
  });

  it('gives the signed height difference', () => {
    const [below, above] = nearby(self, [self, at('below', 0, -18), at('above', 0, 25)]);
    expect(below).toMatchObject({ dzM: -18, distM: 18 });
    expect(above).toMatchObject({ dzM: 25, distM: 25 });
  });
});
