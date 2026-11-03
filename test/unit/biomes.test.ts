import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { loadEditorBiomes, assignBiome, type BiomeShape } from '../../src/shared/biomes.js';

const c = { imageSize: 1000, world: { minX: 0, minY: 0, maxX: 1000, maxY: 1000 } };
const poly = (x: number, y: number, s = 10) => ({
  type: 'Polygon',
  coordinates: [[[x, y], [x + s, y], [x + s, y + s], [x, y + s], [x, y]]],
});
const feat = (name: string, group: string | null, geometry: unknown) => ({
  type: 'Feature', properties: { id: name, name, group }, geometry,
});

describe('loadEditorBiomes', () => {
  it('merges features sharing a group', () => {
    const fc = { type: 'FeatureCollection', features: [
      feat('Dunes A', 'Dunes', poly(0, 0)),
      feat('Dunes B', 'Dunes', poly(50, 50)),
    ] };
    const r = loadEditorBiomes(fc, c);
    expect(r).toHaveLength(1);
    expect(r[0]!.name).toBe('Dunes');
    expect(r[0]!.id).toBe('dunes');
    expect(r[0]!.rings).toHaveLength(2);
  });

  it('keeps own name when group is null, kebab-case ids, order of first appearance', () => {
    const fc = { type: 'FeatureCollection', features: [
      feat('Red Bamboo Fields', null, poly(0, 0)),
      feat('Rocky Desert', null, { type: 'MultiPolygon', coordinates: [poly(20, 0).coordinates, poly(40, 0).coordinates] }),
    ] };
    const r = loadEditorBiomes(fc, c);
    expect(r.map((b) => b.id)).toEqual(['red-bamboo-fields', 'rocky-desert']);
    expect(r[1]!.rings).toHaveLength(2);
  });

  it('converts image units to world units', () => {
    const c2 = { imageSize: 100, world: { minX: 1000, minY: 2000, maxX: 2000, maxY: 4000 } };
    const r = loadEditorBiomes({ features: [feat('A', null, poly(0, 0, 100))] }, c2);
    expect(r[0]!.rings[0]![0]).toEqual([1000, 2000]);
    expect(r[0]!.rings[0]![2]).toEqual([2000, 4000]);
  });

  // The biome outlines are maintainer data, not in the public repo.
  it.skipIf(!existsSync('data-src/biomes/biomes.editor.geojson'))('loads the real editor file', () => {
    const geo = JSON.parse(readFileSync('data-src/biomes/biomes.editor.geojson', 'utf8'));
    const cal = JSON.parse(readFileSync('data-src/biomes/calibration.json', 'utf8'));
    expect(loadEditorBiomes(geo, cal)).toHaveLength(22);
  });
});

describe('assignBiome', () => {
  const sq = (x: number, y: number): number[][] => [[x, y], [x + 10, y], [x + 10, y + 10], [x, y + 10]];
  const biomes: BiomeShape[] = [
    { id: 'a', name: 'A', rings: [sq(0, 0)] },
    { id: 'b', name: 'B', rings: [sq(20, 0)] },
  ];
  it('returns containing index', () => {
    expect(assignBiome(5, 5, biomes, 0)).toBe(0);
    expect(assignBiome(25, 5, biomes, 0)).toBe(1);
  });
  it('snaps to nearest within snapUnits', () => {
    expect(assignBiome(12, 5, biomes, 3)).toBe(0);
    expect(assignBiome(18, 5, biomes, 3)).toBe(1);
  });
  it('returns -1 beyond snap', () => {
    expect(assignBiome(15, 5, biomes, 3)).toBe(-1);
  });
  it('ties go to lower index', () => {
    expect(assignBiome(15, 5, biomes, 5)).toBe(0);
  });
});
