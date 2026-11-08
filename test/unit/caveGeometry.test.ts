import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { caveArea, classify, fillEmptyVolumes, isUnderground, keepZonesWith, readGlb, sampleCaves, sampleColumns, traceRings, volumeBand } from '../../scripts/cave-geometry.js';
import type { RawCaves } from '../../src/shared/caves.js';

/** A horizontal rectangle in UE cm, facing up or down. */
interface Quad { x0: number; x1: number; y0: number; y1: number; z: number; up: boolean }

/**
 * Writes a GLB like the extractor does: glTF metres, Y up, (x, y, z) = UE (X, Z, Y) / 100, counter-clockwise
 * fronts; `landscape` quads go into a second node named "landscape".
 */
function writeGlb(path: string, quads: readonly Quad[], landscape: readonly Quad[] = []): void {
  const pos: number[] = [];
  const idx: number[][] = [[], []];
  for (const [part, list] of [[0, quads], [1, landscape]] as const) {
    for (const q of list) {
      const base = pos.length / 3;
      const p = (x: number, y: number) => pos.push(x / 100, q.z / 100, y / 100);
      p(q.x0, q.y0); p(q.x0, q.y1); p(q.x1, q.y0); p(q.x1, q.y1);
      // (x0,y0) (x0,y1) (x1,y0) is counter-clockwise seen from +Y (up)
      const tris = q.up ? [0, 1, 2, 2, 1, 3] : [0, 2, 1, 2, 3, 1];
      idx[part]!.push(...tris.map(t => base + t));
    }
  }
  const all = [...idx[0]!, ...idx[1]!];
  const bin = Buffer.alloc(pos.length * 4 + all.length * 4);
  pos.forEach((v, i) => bin.writeFloatLE(v, i * 4));
  all.forEach((v, i) => bin.writeUInt32LE(v, pos.length * 4 + i * 4));
  const land = idx[1]!.length > 0;
  const json = Buffer.from(JSON.stringify({
    asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: land ? [0, 1] : [0] }],
    nodes: land ? [{ mesh: 0 }, { mesh: 1, name: 'landscape' }] : [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }, { primitives: [{ attributes: { POSITION: 0 }, indices: 2 }] }].slice(0, land ? 2 : 1),
    accessors: [
      { bufferView: 0, componentType: 5126, count: pos.length / 3, type: 'VEC3' },
      { bufferView: 1, componentType: 5125, count: idx[0]!.length, type: 'SCALAR' },
      { bufferView: 2, componentType: 5125, count: idx[1]!.length, type: 'SCALAR' },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: pos.length * 4 },
      { buffer: 0, byteOffset: pos.length * 4, byteLength: idx[0]!.length * 4 },
      { buffer: 0, byteOffset: pos.length * 4 + idx[0]!.length * 4, byteLength: Math.max(4, idx[1]!.length * 4) },
    ],
    buffers: [{ byteLength: bin.length }],
  }));
  const jsonPadded = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)]);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonPadded.length + 8 + bin.length, 8);
  const chunk = (len: number, type: number) => { const b = Buffer.alloc(8); b.writeUInt32LE(len, 0); b.writeUInt32LE(type, 4); return b; };
  writeFileSync(path, Buffer.concat([header, chunk(jsonPadded.length, 0x4e4f534a), jsonPadded, chunk(bin.length, 0x004e4942), bin]));
}

/**
 * A tunnel 10 m under the landscape: floor at z -1000 from x 0 to 50 m, rock ceiling at -500 up to x 25 m.
 * From x 25 m on the floor lies in an open canyon (no landscape above) that reaches the box edge.
 */
const SCENE: Quad[] = [
  { x0: 0, x1: 5000, y0: -500, y1: 500, z: -1000, up: true }, // floor, cave part and canyon part
  { x0: 0, x1: 2500, y0: -500, y1: 500, z: -500, up: false }, // cave ceiling
  { x0: -1000, x1: 2500, y0: -1500, y1: 1500, z: 0, up: true }, // landscape over the cave
];
const VOLUMES: RawCaves = {
  volumes: [{ name: 'V', source: 'FGAmbientVolume:AS_CaveSmall_C', elements: [{ hull: [[0, -500], [2500, -500], [2500, 500], [0, 500]], zMin: -1200, zMax: -400 }] }],
};
const BOX = { minX: -1000, minY: -1500, minZ: -2000, maxX: 5000, maxY: 1500, maxZ: 1000 };

const dir = mkdtempSync(join(tmpdir(), 'ficsmap-caves-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
writeGlb(join(dir, 'cave-001.glb'), SCENE);
writeFileSync(join(dir, 'index.json'), JSON.stringify({
  caves: [{ id: 'cave-001', file: 'cave-001.glb', min: [BOX.minX, BOX.minY, BOX.minZ], max: [BOX.maxX, BOX.maxY, BOX.maxZ], volumes: ['V'] }],
}));

describe('cave geometry sampling', () => {
  const tris = readGlb(join(dir, 'cave-001.glb'));
  const cols = sampleColumns(tris, BOX);
  const sample = classify(cols, volumeBand(cols, VOLUMES.volumes[0]!.elements));
  const cell = (x: number, y: number) => Math.floor((y - cols.y0) / 100) * cols.w + Math.floor((x - cols.x0) / 100);

  it('reads triangles back in UE coordinates with their facing', () => {
    expect(tris.count).toBe(6);
    expect(Array.from(tris.up)).toEqual([1, 1, 0, 0, 1, 1]);
    expect(Math.min(...Array.from(tris.pos).filter((_, i) => i % 3 === 2))).toBeCloseTo(-1000);
  });

  it('finds cave floor under the rock ceiling, not in the open canyon or on the landscape', () => {
    expect(sample.floor[cell(1000, 0)]).toBeCloseTo(-1000);
    expect(sample.floor[cell(4000, 0)]).toBeNaN();
    expect(sample.floor[cell(-500, 1000)]).toBeNaN();
  });

  it('puts one entrance where the cave floor meets the open canyon', () => {
    expect(sample.entrances).toHaveLength(1);
    const [e] = sample.entrances;
    expect(e!.x).toBeGreaterThan(2300);
    expect(e!.x).toBeLessThan(2600);
    expect(e!.z).toBeCloseTo(-1000);
  });

  it('traces the cave floor as one ring of about its size', () => {
    const rings = traceRings(sample);
    expect(rings).toHaveLength(1);
    let a = 0;
    const r = rings[0]!;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += r[j]![0]! * r[i]![1]! - r[i]![0]! * r[j]![1]!;
    // m²: 25 m x 10 m = 250 m² of cells, a little less after rounding off the corners
    expect(Math.abs(a / 2) / 1e4).toBeGreaterThan(200);
    expect(Math.abs(a / 2) / 1e4).toBeLessThan(260);
  });

  it('samples a geometry directory and tells which items lie in a cave', () => {
    const layer = sampleCaves(dir, VOLUMES, [
      { name: 'IN', x: 1000, y: 0, z: -950 },
      { name: 'ABOVE', x: 1000, y: 0, z: 50 },
      { name: 'CANYON', x: 4000, y: 0, z: -950 },
    ]);
    expect(layer.caves.map(c => c.id)).toEqual(['cave-001']);
    expect(layer.caves[0]!.entrances).toHaveLength(1);
    expect([...layer.itemsInCaves]).toEqual(['IN']);
  });
});

describe('cave area', () => {
  // 60 x 60 cells of cave floor with a 5 x 5 rock, a 40 x 40 open area, and a 1-cell crack from the edge
  const w = 80, h = 80;
  const mask = new Uint8Array(w * h);
  const set = (i0: number, j0: number, i1: number, j1: number, v: number) => {
    for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) mask[j * w + i] = v;
  };
  set(10, 10, 70, 70, 1);
  set(15, 15, 20, 20, 0);
  set(25, 25, 65, 65, 0);
  set(10, 22, 70, 23, 0);
  const area = caveArea(mask, w, h);
  const at = (i: number, j: number) => area[j * w + i];

  it('fills small holes and closes narrow cracks', () => {
    expect(at(17, 17)).toBe(1);
    expect(at(12, 22)).toBe(1);
  });

  it('keeps large holes and the outside', () => {
    expect(at(45, 45)).toBe(0);
    expect(at(5, 5)).toBe(0);
    expect(at(10, 10)).toBe(1);
  });
});

describe('zones with an entrance', () => {
  // 30 x 5 cells. Volume cluster A covers columns 0-19, cluster B columns 22-29 (rows 0-4).
  const w = 30, h = 5;
  const grid = (rows: string[]) => Uint8Array.from(rows.join(''), c => (c === '#' ? 1 : 0));
  const inside = grid(Array(h).fill('####################..########'));
  const at = (i: number, j: number) => j * w + i;

  it('keeps the zones with an entrance, drops the others in that cluster, and keeps clusters without an entrance whole', () => {
    const area = grid([
      '##..........##..........##..##',
      '##..........##..........##..##',
      '............................##',
      '............................##',
      '..............................',
    ]);
    const { area: kept, entrances } = keepZonesWith(area, w, h, [[at(0, 0)]], inside);
    expect(entrances).toEqual([true]);
    expect(kept[at(1, 1)]).toBe(1); // zone with the entrance
    expect(kept[at(12, 0)]).toBe(0); // zone without one in the same cluster, 10 cells away
    expect(kept[at(24, 0)]).toBe(1); // cluster B has no entrance: kept whole
    expect(kept[at(28, 3)]).toBe(1);
  });

  it('joins parts less than 2 * ZONE_REACH cells apart (a rock across a tunnel)', () => {
    const area = grid([
      '####...####...................',
      '####...####...................',
      '..............................',
      '..............................',
      '..............................',
    ]);
    const { area: kept } = keepZonesWith(area, w, h, [[at(0, 0)]], inside);
    expect(kept[at(8, 1)]).toBe(1);
  });

  it('drops an entrance whose zone does not reach into a volume, and keeps the cave without it whole', () => {
    const area = grid([
      '....................##........',
      '....................##........',
      '..............................',
      '##............................',
      '##............................',
    ]);
    // the entrance lies in the gap between the clusters, in a zone that touches no volume cell
    const { area: kept, entrances } = keepZonesWith(area, w, h, [[at(20, 0)]], inside);
    expect(entrances).toEqual([false]);
    expect(kept[at(1, 3)]).toBe(1);
  });
});

describe('items underground and empty volumes', () => {
  const landscape = {
    meta: { cell: 200, minX: 0, minY: 0, width: 10, height: 10 },
    top: new Float32Array(100).fill(1000),
  };

  it('is underground only more than 5 m under the landscape in all nine cells, without holes', () => {
    expect(isUnderground(landscape, 1000, 1000, 0)).toBe(true);
    expect(isUnderground(landscape, 1000, 1000, 600)).toBe(false);
    const holed = { ...landscape, top: landscape.top.slice() };
    holed.top[4 * 10 + 6] = Number.NaN; // the cell east of (1000, 1000)
    expect(isUnderground(holed, 1000, 1000, 0)).toBe(false);
  });

  it('draws a volume cluster without cave floor whole when an underground item lies in it', () => {
    const band = { lo: new Float32Array(4).fill(0), hi: new Float32Array(4).fill(500), inside: Uint8Array.from([1, 1, 0, 1]) };
    const sample = { w: 4, h: 1, x0: 0, y0: 0, floor: new Float32Array(4), area: new Uint8Array(4), kind: new Uint8Array(0), entrances: [], band };
    expect(fillEmptyVolumes(sample, [{ cell: 1, z: 2000 }])).toBe(0); // above the band
    expect(fillEmptyVolumes(sample, [{ cell: 1, z: 100 }])).toBe(1);
    expect(Array.from(sample.area)).toEqual([1, 1, 0, 0]);
  });
});

describe('entrances', () => {
  const V = (x0: number, x1: number, y0: number, y1: number): RawCaves['volumes'][number]['elements'] =>
    [{ hull: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], zMin: -1200, zMax: -400 }];
  const sample = (quads: Quad[], box: typeof BOX, elements: RawCaves['volumes'][number]['elements']) => {
    const path = join(dir, `scene-${Math.random().toString(36).slice(2)}.glb`);
    writeGlb(path, quads);
    const cols = sampleColumns(readGlb(path), box);
    return classify(cols, volumeBand(cols, elements));
  };

  it('finds the mouth to open floor that does not reach the box edge, outside the volumes (a basin)', () => {
    // as SCENE, but the canyon ends at x 35 m and the box reaches to 50 m with nothing there
    const quads: Quad[] = [{ ...SCENE[0]!, x1: 3500 }, SCENE[1]!, SCENE[2]!];
    const s = sample(quads, BOX, V(0, 2500, -500, 500));
    expect(s.entrances).toHaveLength(1);
    expect(s.entrances[0]!.x).toBeGreaterThan(2300);
  });

  it('makes one entrance of an opening that a rock splits, joined by the floor under the overhang', () => {
    // cave x 0-25 m (volume), its ceiling reaches 5 m further out (an overhang), the opening at x 30 m runs
    // 60 m along y; a 3 m high rock outside at y -3..3 m splits the mouth into two pieces 30 m apart
    const quads: Quad[] = [
      { x0: 0, x1: 5000, y0: -3000, y1: 3000, z: -1000, up: true },
      { x0: 0, x1: 3000, y0: -3000, y1: 3000, z: -500, up: false },
      { x0: 3000, x1: 3300, y0: -300, y1: 300, z: -700, up: true },
    ];
    const box = { minX: -500, minY: -3500, minZ: -2000, maxX: 5000, maxY: 3500, maxZ: 1000 };
    const s = sample(quads, box, V(0, 2500, -3000, 3000));
    expect(s.entrances).toHaveLength(1);
  });
});

describe('halls under the landscape', () => {
  // A floor 20 m under the landscape with no ceiling of its own (the hall's ceiling is missing from the geometry).
  const floor: Quad[] = [{ x0: 0, x1: 3000, y0: -1000, y1: 1000, z: -2000, up: true }];
  const land: Quad[] = [{ x0: -1000, x1: 4000, y0: -2000, y1: 2000, z: 0, up: true }];
  const volumes: RawCaves = { volumes: [{ name: 'H', source: 'FGAmbientVolume:AS_CaveLarge_C', elements: [{ hull: [[0, -1000], [3000, -1000], [3000, 1000], [0, 1000]], zMin: -2200, zMax: -1500 }] }] };
  const hall = mkdtempSync(join(tmpdir(), 'ficsmap-hall-'));
  afterAll(() => rmSync(hall, { recursive: true, force: true }));
  writeGlb(join(hall, 'cave-001.glb'), floor, land);
  writeFileSync(join(hall, 'index.json'), JSON.stringify({ caves: [{ id: 'cave-001', file: 'cave-001.glb', min: [-1000, -2000, -3000], max: [4000, 2000, 1000], volumes: ['H'] }] }));
  const landscape = { meta: { cell: 200, minX: -5000, minY: -5000, width: 50, height: 50 }, top: new Float32Array(2500).fill(0) };
  const items = [{ name: 'DEEP', x: 1500, y: 0, z: -1950 }];

  it('reads which triangles are the landscape', () => {
    const tris = readGlb(join(hall, 'cave-001.glb'));
    expect(Array.from(tris.land!)).toEqual([0, 0, 1, 1]);
  });

  it('counts the landscape high above as ceiling only where told to', () => {
    const box = { minX: -1000, minY: -2000, minZ: -3000, maxX: 4000, maxY: 2000, maxZ: 1000 };
    const cols = sampleColumns(readGlb(join(hall, 'cave-001.glb')), box);
    const band = volumeBand(cols, volumes.volumes[0]!.elements);
    const k = Math.floor((0 - cols.y0) / 100) * cols.w + Math.floor((1500 - cols.x0) / 100);
    expect(classify(cols, band).floor[k]).toBeNaN();
    expect(classify(cols, band, band.inside).floor[k]).toBeCloseTo(-2000);
  });

  it('sees no cave there without the landscape grid (the floor is buried)', () => {
    const layer = sampleCaves(hall, volumes, items);
    expect(layer.caves).toHaveLength(0);
    expect(layer.itemsInCaves.size).toBe(0);
  });

  it('takes the landscape as ceiling where an underground item lies outside the cave, and flags the item', () => {
    const layer = sampleCaves(hall, volumes, items, () => {}, landscape);
    expect(layer.caves.map(c => c.id)).toEqual(['cave-001']);
    expect([...layer.itemsInCaves]).toEqual(['DEEP']);
  });
});
