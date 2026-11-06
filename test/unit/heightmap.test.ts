import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { afterAll, describe, expect, it } from 'vitest';
import { readHeightGrid, writeHeightTiles } from '../../scripts/heightmap.js';
import { decodeHeightTile, encodeHeightTile, heightCell, heightValue, NO_HEIGHT, overviewCell, type HeightmapMeta } from '../../src/shared/heightmap.js';

describe('height tiles', () => {
  it('round-trips heights in steps, gaps and jumps across the whole int16 range', () => {
    const cm = [1234, 1239, Number.NaN, -150_000, 300_000, 0, Number.NaN, -40];
    const back = Array.from(decodeHeightTile(encodeHeightTile(cm, 10)));
    expect(back).toEqual([123, 124, NO_HEIGHT, -15000, 30000, 0, NO_HEIGHT, -4]);
  });

  it('finds the tile and cell of a world point', () => {
    const meta: HeightmapMeta = { cell: 200, minX: -1000, minY: 0, width: 10, height: 6, tile: 4, step: 10, id: 'x', overview: { factor: 2, width: 5, height: 3 }, range: [0, 0] };
    expect(overviewCell(meta, -1000 + 5 * 200 + 50, 4 * 200 + 10)).toBe(2 * 5 + 2);
    expect(overviewCell(meta, -1001, 0)).toBeNull();
    expect(heightCell(meta, -1000, 0)).toEqual({ ti: 0, tj: 0, k: 0 });
    // cell (i 5, j 4) -> tile (1, 1), inside it (1, 0)
    expect(heightCell(meta, -1000 + 5 * 200 + 50, 4 * 200 + 10)).toEqual({ ti: 1, tj: 1, k: 1 });
    expect(heightCell(meta, -1001, 0)).toBeNull();
    expect(heightCell(meta, 1000, 0)).toBeNull();
    expect(heightValue(meta, Int16Array.from([12, NO_HEIGHT]), 0)).toBe(120);
    expect(heightValue(meta, Int16Array.from([12, NO_HEIGHT]), 1)).toBeNull();
  });

  const dir = mkdtempSync(join(tmpdir(), 'ficsmap-height-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('writes the extractor grid as gzip tiles with a meta file', () => {
    const src = join(dir, 'src');
    const out = join(dir, 'out');
    mkdirSync(src);
    writeFileSync(join(src, 'heightmap.json'), JSON.stringify({ cell: 200, minX: 0, minY: 0, width: 3, height: 2 }));
    writeFileSync(join(src, 'top.f32'), Buffer.from(Float32Array.from([100, 200, Number.NaN, -50, 0, 12345]).buffer));
    const grid = readHeightGrid(src);
    expect(grid).not.toBeNull();
    const { meta } = writeHeightTiles(grid!, out);
    expect(JSON.parse(readFileSync(join(out, 'meta.json'), 'utf8'))).toEqual(meta);
    expect(meta.id).toMatch(/^[0-9a-f]{16}$/);
    const tile = decodeHeightTile(new Int16Array(new Uint8Array(gunzipSync(readFileSync(join(out, '0_0.bin.gz')))).buffer));
    expect(tile).toHaveLength(meta.tile * meta.tile);
    const at = (i: number, j: number) => heightValue(meta, tile, j * meta.tile + i);
    expect([at(0, 0), at(1, 0), at(2, 0), at(0, 1), at(1, 1), at(2, 1)]).toEqual([100, 200, null, -50, 0, 12350]);
    expect(at(3, 0)).toBeNull(); // padding
    // overview: one cell of 4 x 4 (the whole grid), the highest value
    expect(meta.overview).toEqual({ factor: 4, width: 1, height: 1 });
    const ov = decodeHeightTile(new Int16Array(new Uint8Array(gunzipSync(readFileSync(join(out, 'overview.bin.gz')))).buffer));
    expect(Array.from(ov)).toEqual([1235]);
    expect(meta.range).toEqual([-17000, 47000]);
    expect(readHeightGrid(join(dir, 'none'))).toBeNull();
  });
});
