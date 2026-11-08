/**
 * The height map of a dataset: the highest solid surface (landscape, rocks, other placed meshes; no foliage)
 * per grid cell, from the extractor's `--heightmap-out`. Served as square tiles under `/data/<v>/height/`:
 * `meta.json` (HeightmapMeta), one gzip file per tile, `<ti>_<tj>.bin.gz`, and `overview.bin.gz`, the whole grid
 * at a coarser cell (each the highest of its block) in one piece, for drawing the map zoomed out.
 *
 * A tile holds `tile × tile` int16 values, row by row (j = world Y), each the height in `step` cm. Every value
 * is stored as the difference to the one before it in its row (modulo 2^16, so it is lossless), which makes
 * the gzip about three times smaller. NO_HEIGHT marks a cell without any surface (outside the landscape).
 */
export interface HeightmapMeta {
  /** Cell size (world units, cm). */
  cell: number;
  /** World position of the grid's corner (cell 0, 0). */
  minX: number;
  minY: number;
  /** Grid size in cells. */
  width: number;
  height: number;
  /** Tile size in cells. */
  tile: number;
  /** Height unit of the stored values (cm). */
  step: number;
  /** Content hash of all tiles; tile URLs carry it (`?v=`), since tiles are cached as immutable. */
  id: string;
  /** The overview grid: `factor` cells per side in one, `width × height` of them, same origin. */
  overview: { factor: number; width: number; height: number };
  /** Heights (cm) the colour scale spans (lower heights get its first colour, higher its last). */
  range: [lo: number, hi: number];
}

export const NO_HEIGHT = -32768;

/** Heights (cm, NaN = none) of one tile, row-major, to the stored form. */
export function encodeHeightTile(heights: ArrayLike<number>, step: number): Int16Array {
  const out = new Int16Array(heights.length);
  let prev = 0;
  for (let k = 0; k < heights.length; k++) {
    const v = heights[k]!;
    const q = Number.isNaN(v) ? NO_HEIGHT : Math.max(-32767, Math.min(32767, Math.round(v / step)));
    out[k] = (q - prev) << 16 >> 16;
    prev = q;
  }
  return out;
}

/** The stored form back to absolute values (in `step`, NO_HEIGHT = none). Rows are not reset: one running sum. */
export function decodeHeightTile(stored: Int16Array): Int16Array {
  const out = new Int16Array(stored.length);
  let prev = 0;
  for (let k = 0; k < stored.length; k++) {
    prev = (prev + stored[k]!) << 16 >> 16;
    out[k] = prev;
  }
  return out;
}

/** Which tile and which cell in it a world point falls in; null outside the grid. */
export function heightCell(meta: HeightmapMeta, x: number, y: number): { ti: number; tj: number; k: number } | null {
  const i = Math.floor((x - meta.minX) / meta.cell), j = Math.floor((y - meta.minY) / meta.cell);
  if (i < 0 || j < 0 || i >= meta.width || j >= meta.height) return null;
  const ti = Math.floor(i / meta.tile), tj = Math.floor(j / meta.tile);
  return { ti, tj, k: (j - tj * meta.tile) * meta.tile + (i - ti * meta.tile) };
}

/** Height (cm) of a decoded tile's cell, null for no surface. */
export function heightValue(meta: HeightmapMeta, decoded: Int16Array, k: number): number | null {
  const v = decoded[k];
  return v === undefined || v === NO_HEIGHT ? null : v * meta.step;
}

/** Index of a world point in the overview grid; null outside it. */
export function overviewCell(meta: HeightmapMeta, x: number, y: number): number | null {
  const size = meta.cell * meta.overview.factor;
  const i = Math.floor((x - meta.minX) / size), j = Math.floor((y - meta.minY) / size);
  if (i < 0 || j < 0 || i >= meta.overview.width || j >= meta.overview.height) return null;
  return j * meta.overview.width + i;
}

export const OVERVIEW_FILE = 'overview.bin.gz';

export function heightTileName(ti: number, tj: number): string {
  return `${ti}_${tj}.bin.gz`;
}
