import { describe, expect, it } from 'vitest';
import { classifyWikiMap, gameMasks, landMask, NONE, labelMask } from '../../scripts/wiki-biomes.js';

// 200 x 200: sea (map blue) around an island (map beige) from 30 to 170; the island's west half is tinted
// green in the wiki map, its east half red; a lake (blue) inside the west half; a black frame of 1 px.
const N = 200;
const SEA = [76, 111, 119], LAND = [150, 140, 122];
function images() {
  const map = new Uint8Array(N * N * 3), wiki = new Uint8Array(N * N * 3);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const k = (y * N + x) * 3;
      const frame = x === 0 || y === 0 || x === N - 1 || y === N - 1;
      const island = x >= 30 && x < 170 && y >= 30 && y < 170;
      const lake = x >= 60 && x < 75 && y >= 90 && y < 105;
      const base = frame ? [33, 33, 33] : island && !lake ? LAND : SEA;
      map.set(base, k);
      // tint: wiki = 0.4 * map + 0.6 * colour
      const tint = !island ? null : x < 100 ? [60, 180, 80] : [230, 80, 100];
      wiki.set(tint ? base.map((v, c) => Math.round(0.4 * v + 0.6 * tint[c]!)) : base, k);
    }
  }
  return { map, wiki };
}

describe('wiki biome map', () => {
  it('tells land from the open sea, keeping lakes inland as land', () => {
    const { map } = images();
    const land = landMask(map, N);
    expect(land[100 * N + 100]).toBe(1);
    expect(land[10 * N + 10]).toBe(0); // sea
    expect(land[95 * N + 65]).toBe(1); // lake inside the island
    expect(land[0]).toBe(0); // frame
  });

  it('assigns each land pixel the biome whose tint explains it, and fills the lake', () => {
    const { map, wiki } = images();
    const { index } = classifyWikiMap(wiki, map, N, [
      { name: 'Green', samples: [[50, 50]] },
      { name: 'Red', samples: [[150, 150]] },
    ]);
    expect(index[50 * N + 50]).toBe(0);
    expect(index[150 * N + 150]).toBe(1);
    expect(index[97 * N + 67]).toBe(0); // lake: nearest biome
    expect(index[10 * N + 10]).toBe(NONE);
  });

  it("does not fill the game's no man's land and gives the void no biome", () => {
    const { map, wiki } = images();
    const noMansLand = new Uint8Array(N * N), voidMask = new Uint8Array(N * N);
    for (let y = 90; y < 105; y++) {
      for (let x = 60; x < 75; x++) {
        noMansLand[y * N + x] = 1; // the lake, untinted in the wiki map
        for (let c = 0; c < 3; c++) wiki[(y * N + x) * 3 + c] = map[(y * N + x) * 3 + c]!;
      }
    }
    for (let y = 30; y < 170; y++) for (let x = 160; x < 170; x++) voidMask[y * N + x] = 1; // a strip of the island
    const { index } = classifyWikiMap(wiki, map, N, [
      { name: 'Green', samples: [[50, 50]] },
      { name: 'Red', samples: [[150, 150]] },
    ], { noMansLand, void: voidMask });
    expect(index[97 * N + 67]).toBe(NONE); // lake on no man's land: not filled
    expect(index[100 * N + 165]).toBe(NONE); // void
    expect(index[100 * N + 155]).toBe(1);
    expect(index[50 * N + 50]).toBe(0);
  });

  it('samples the game masks at the image size', () => {
    // 2 x 2 areas (index 0 = no man's land in the top-left), 2 x 2 heights (the void in the bottom-right)
    const masks = gameMasks(4, { width: 2, height: 2, index: Uint8Array.from([0, 3, 3, 3]), noMansLand: new Set([0]) },
      { width: 2, height: 2, top: Float32Array.from([0, Number.NaN, -1000, -25000]) });
    expect([...masks.noMansLand]).toEqual([1, 1, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect([...masks.void]).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 1, 1]);
  });
});

describe('grid labels', () => {
  const n = 300;
  const image = () => {
    const rgb = new Uint8Array(n * n * 3).fill(150);
    const paint = (x0: number, y0: number, x1: number, y1: number, v: [number, number, number]) => {
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) rgb.set(v, (y * n + x) * 3);
    };
    paint(20, 20, 130, 58, [40, 48, 32]); // a label box, 110 x 38
    paint(40, 30, 60, 48, [216, 224, 208]); // its light text
    paint(20, 150, 280, 153, [30, 30, 30]); // a dark line: not a label
    paint(150, 200, 300, 300, [60, 60, 60]); // a dark area (void): not a label
    return rgb;
  };
  it('masks the label box with its text and a small margin, nothing else', () => {
    const m = labelMask(image(), n);
    expect(m[25 * n + 25]).toBe(1);
    expect(m[35 * n + 45]).toBe(1); // text inside
    expect(m[18 * n + 18]).toBe(1); // margin
    expect(m[10 * n + 10]).toBe(0);
    expect(m[151 * n + 100]).toBe(0);
    expect(m[250 * n + 250]).toBe(0);
  });
});
