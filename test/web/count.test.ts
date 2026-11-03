import type { Item } from '../../src/shared/dataset.js';
import type { CollectibleTypeId } from '../../src/shared/types.js';
import { countProgress } from '../../src/web/features/progress/count.js';

let n = 0;
const item = (type: CollectibleTypeId, biome: number): Item => ({ name: `A${++n}`, type, x: 0, y: 0, z: 0, biome, seq: n });

// 3 types across 2 biomes.
const items: Item[] = [
  item('somersloop', 0), item('somersloop', 0), item('somersloop', 1),
  item('mercer_sphere', 0), item('mercer_sphere', 1), item('mercer_sphere', 1),
  item('hard_drive', 1),
];
// Done: the first sloop (biome 0), the second mercer (biome 1), the hard drive (biome 1).
const done = new Set([items[0]!.name, items[4]!.name, items[6]!.name]);
const isDone = (name: string) => done.has(name);
const all = new Set<CollectibleTypeId>(['slug_blue', 'slug_yellow', 'slug_purple', 'somersloop', 'mercer_sphere', 'hard_drive']);

describe('countProgress', () => {
  it('counts per type and per biome', () => {
    const r = countProgress(items, isDone, { typeFilter: all, biome: null });
    expect(r.byType.somersloop).toEqual({ done: 1, total: 3 });
    expect(r.byType.mercer_sphere).toEqual({ done: 1, total: 3 });
    expect(r.byType.hard_drive).toEqual({ done: 1, total: 1 });
    expect(r.byType.slug_blue).toEqual({ done: 0, total: 0 });
    expect(r.byBiome).toEqual([{ done: 1, total: 3 }, { done: 2, total: 4 }]);
  });

  it('limits byType to the biome scope', () => {
    const r = countProgress(items, isDone, { typeFilter: all, biome: 1 });
    expect(r.byType.somersloop).toEqual({ done: 0, total: 1 });
    expect(r.byType.mercer_sphere).toEqual({ done: 1, total: 2 });
    expect(r.byType.hard_drive).toEqual({ done: 1, total: 1 });
    // The biome scope does not narrow the biome rows.
    expect(r.byBiome).toEqual([{ done: 1, total: 3 }, { done: 2, total: 4 }]);
  });

  it('limits byBiome to the type filter, but not byType', () => {
    const r = countProgress(items, isDone, { typeFilter: new Set(['somersloop']), biome: null });
    expect(r.byBiome).toEqual([{ done: 1, total: 2 }, { done: 0, total: 1 }]);
    expect(r.byType.mercer_sphere).toEqual({ done: 1, total: 3 });
  });

  it('has one byBiome entry per biome', () => {
    expect(countProgress(items, isDone, { typeFilter: all, biome: null }).byBiome).toHaveLength(2);
  });

  it('includes trailing biomes without items when the biome count is given', () => {
    const r = countProgress(items, isDone, { typeFilter: all, biome: null, biomeCount: 4 });
    expect(r.byBiome).toHaveLength(4);
    expect(r.byBiome[3]).toEqual({ done: 0, total: 0 });
  });
});
