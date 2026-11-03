import { describe, it, expect } from 'vitest';
import { indexDataset, type Dataset } from '../../src/shared/dataset.js';

const ds: Dataset = {
  version: '1', build: 1, bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 }, mapId: 'm', podRequirementsKnown: true,
  biomes: [{ id: 'a', name: { en: 'A', de: 'A' } }],
  items: [
    ['BP_Crystal_C_1', 'slug_blue', 1, 2, 3, 0, 1, { shards: 1 }],
    ['BP_WAT2_C_1', 'mercer_sphere', 4, 5, 6, 0, 2],
  ],
  aliases: { BP_MercerShrine_C_1: 'BP_WAT2_C_1' },
};

describe('indexDataset', () => {
  const idx = indexDataset(ds);
  it('builds byName with named fields', () => {
    expect(idx.items).toHaveLength(2);
    expect(idx.byName.get('BP_Crystal_C_1')).toEqual({
      name: 'BP_Crystal_C_1', type: 'slug_blue', x: 1, y: 2, z: 3, biome: 0, seq: 1, extra: { shards: 1 },
    });
  });
  it('resolves aliases to the sphere', () => {
    expect(idx.resolve('BP_MercerShrine_C_1')).toBe('BP_WAT2_C_1');
    expect(idx.resolve('BP_WAT2_C_1')).toBe('BP_WAT2_C_1');
  });
  it('resolve of an unknown name is undefined', () => {
    expect(idx.resolve('unknown')).toBeUndefined();
  });
  it('has ignores aliases', () => {
    expect(idx.has('BP_WAT2_C_1')).toBe(true);
    expect(idx.has('BP_MercerShrine_C_1')).toBe(false);
  });
});
