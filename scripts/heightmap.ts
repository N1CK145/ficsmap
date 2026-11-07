import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { encodeHeightTile, heightTileName, OVERVIEW_FILE, type HeightmapMeta } from '../src/shared/heightmap.js';

/** Tile size (cells): 250 cells of 2 m are 500 m, about 25 KB gzip per tile. */
const TILE = 250;
/** Stored height unit (cm). */
const STEP = 10;
/** Heights (cm) the colour scale spans, fixed so every dataset reads the same: the map's lowest seabed to its highest peaks. */
const COLOUR_RANGE: [number, number] = [-17000, 47000];
/** Overview cell: 4 x 4 cells (8 m), about 900 x 900 for the whole map, ~0.5 MB gzip. */
const OVERVIEW_FACTOR = 4;

/**
 * The extractor's `--heightmap-out` grid (heightmap.json + top.f32), or null if the directory has none. `file`
 * picks another grid of the same directory (`landscape.f32`: the landscape alone); it is returned as `top` all the same.
 */
export function readHeightGrid(dir: string, file = 'top.f32'): { meta: { cell: number; minX: number; minY: number; width: number; height: number }; top: Float32Array } | null {
  if (!existsSync(join(dir, 'heightmap.json')) || !existsSync(join(dir, file))) return null;
  const meta = JSON.parse(readFileSync(join(dir, 'heightmap.json'), 'utf8')) as { cell: number; minX: number; minY: number; width: number; height: number };
  const buf = readFileSync(join(dir, file));
  const top = new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length));
  if (top.length !== meta.width * meta.height) throw new Error(`${dir}/${file}: ${top.length} values, expected ${meta.width * meta.height}`);
  return { meta, top };
}

/** Writes `<out>/meta.json` and the gzip tiles (format: src/shared/heightmap.ts). Returns the meta and the bytes written. */
export function writeHeightTiles(grid: NonNullable<ReturnType<typeof readHeightGrid>>, out: string): { meta: HeightmapMeta; bytes: number } {
  const { meta: g, top } = grid;
  mkdirSync(out, { recursive: true });
  let bytes = 0;
  const hash = createHash('sha256');
  const tile = new Float32Array(TILE * TILE);
  for (let tj = 0; tj * TILE < g.height; tj++) {
    for (let ti = 0; ti * TILE < g.width; ti++) {
      tile.fill(Number.NaN);
      for (let j = 0; j < TILE && tj * TILE + j < g.height; j++) {
        for (let i = 0; i < TILE && ti * TILE + i < g.width; i++) tile[j * TILE + i] = top[(tj * TILE + j) * g.width + ti * TILE + i]!;
      }
      const gz = gzipSync(Buffer.from(encodeHeightTile(tile, STEP).buffer), { level: 9 });
      writeFileSync(join(out, heightTileName(ti, tj)), gz);
      hash.update(gz);
      bytes += gz.length;
    }
  }
  const ow = Math.ceil(g.width / OVERVIEW_FACTOR), oh = Math.ceil(g.height / OVERVIEW_FACTOR);
  const overview = new Float32Array(ow * oh).fill(Number.NaN);
  for (let j = 0; j < g.height; j++) {
    for (let i = 0; i < g.width; i++) {
      const v = top[j * g.width + i]!;
      const k = Math.floor(j / OVERVIEW_FACTOR) * ow + Math.floor(i / OVERVIEW_FACTOR);
      if (!(overview[k]! >= v)) overview[k] = v;
    }
  }
  const gz = gzipSync(Buffer.from(encodeHeightTile(overview, STEP).buffer), { level: 9 });
  writeFileSync(join(out, OVERVIEW_FILE), gz);
  hash.update(gz);
  bytes += gz.length;
  const meta: HeightmapMeta = {
    cell: g.cell, minX: g.minX, minY: g.minY, width: g.width, height: g.height, tile: TILE, step: STEP, id: hash.digest('hex').slice(0, 16),
    overview: { factor: OVERVIEW_FACTOR, width: ow, height: oh }, range: COLOUR_RANGE,
  };
  writeFileSync(join(out, 'meta.json'), JSON.stringify(meta));
  return { meta, bytes };
}

