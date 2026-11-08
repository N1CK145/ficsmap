import { describe, expect, it } from 'vitest';
import { biomeNameOf, biomesFromAreas, type MapAreas } from '../../scripts/map-areas.js';

describe('biomes from the game map areas', () => {
  it('names areas by the game display name, with the class name only as a fallback', () => {
    expect(biomeNameOf({ index: 0, class: 'Area_Savanna_1_C', nameKey: 'Locations/RockyDesert', name: 'Rocky Desert', nameDe: 'Felswüste' }))
      .toEqual({ en: 'Rocky Desert', de: 'Felswüste' });
    expect(biomeNameOf({ index: 0, class: 'Area_RedBambooFields_2_C' })).toEqual({ en: 'Red Bamboo Fields' });
    expect(biomeNameOf({ index: 0, class: 'Area_NoMansLand_1_C', nameKey: 'Locations/NoMansLand', name: "No Man's Land" })).toBeNull();
    expect(biomeNameOf({ index: 0, class: 'Area_Other_C', nameKey: 'Locations/NoMansLand', name: "No Man's Land" })).toBeNull();
    expect(biomeNameOf({ index: 0, class: 'None' })).toBeNull();
  });

  // 10 x 10 pixels of 10 m: sea (0) around, grass (1, 3 = two sub-areas) on the left, swamp (2) on the right
  const W = 10;
  const index = new Uint8Array(W * W);
  for (let j = 2; j < 8; j++) for (let i = 2; i < 8; i++) index[j * W + i] = i < 4 ? 1 : i < 5 ? 3 : 2;
  const m: MapAreas = {
    width: W, height: W, index,
    areas: [
      { index: 0, class: 'Area_NoMansLand_1_C' }, { index: 1, class: 'Area_GrassFields_1_C', name: 'Grass Fields', nameDe: 'Grasfelder' },
      { index: 2, class: 'Area_Swamp_1_C' }, { index: 3, class: 'Area_GrassFields_2_C', name: 'Grass Fields', nameDe: 'Grasfelder' },
    ],
  };
  const world = { minX: 0, minY: 0, maxX: 10_000, maxY: 10_000 };
  const { biomes, assign } = biomesFromAreas(m, world, 1500);

  it('merges the sub-areas of a biome, in palette order, and traces their outlines', () => {
    expect(biomes.map(b => b.id)).toEqual(['grass-fields', 'swamp']);
    expect(biomes[0]!.nameDe).toBe('Grasfelder');
    expect(biomes[1]!.nameDe).toBeUndefined();
    const area = (r: number[][]) => Math.abs(r.reduce((a, p, k) => { const q = r[(k + 1) % r.length]!; return a + p[0]! * q[1]! - q[0]! * p[1]!; }, 0) / 2);
    expect(biomes[0]!.rings).toHaveLength(1);
    expect(area(biomes[0]!.rings[0]!)).toBe(3000 * 6000); // 3 x 6 pixels of 10 m
    expect(area(biomes[1]!.rings[0]!)).toBe(3000 * 6000);
  });

  it('assigns the biome under a point, on the sea the nearest within the snap distance', () => {
    expect(assign(2500, 5000)).toBe(0);
    expect(assign(4500, 5000)).toBe(0); // grass sub-area 2
    expect(assign(7500, 5000)).toBe(1);
    expect(assign(8500, 5000)).toBe(1); // sea, one pixel (10 m) from the swamp
    expect(assign(9500, 5000)).toBe(-1); // sea, 20 m from the swamp
    expect(assign(500, 500)).toBe(-1); // sea, too far
  });

  it('joins land the game names no area to the nearest biome, but not the sea', () => {
    // land: the sea pixel column 8 (next to the swamp) and an island at (0, 0); everything else is sea
    const isLand = (x: number, y: number) => (Math.floor(x / 1000) === 8 && Math.floor(y / 1000) === 5) || (x < 1000 && y < 1000);
    const r = biomesFromAreas(m, world, 0, isLand);
    expect(r.filled).toBe(2);
    expect(r.assign(8500, 5500)).toBe(1); // next to the swamp
    expect(r.assign(500, 500)).toBe(0); // island, nearest is grass (2 px away diagonally vs. swamp further)
    expect(r.assign(9500, 9500)).toBe(-1); // sea stays without a biome
  });
});

