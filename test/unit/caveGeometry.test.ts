import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { caveArea, classify, keepZonesWith, readGlb, sampleCaves, sampleColumns, traceRings, volumeBand } from '../../scripts/cave-geometry.js';
import type { RawCaves } from '../../src/shared/caves.js';

/** A horizontal rectangle in UE cm, facing up or down. */
interface Quad { x0: number; x1: number; y0: number; y1: number; z: number; up: boolean }

/** Writes a GLB like the extractor does: glTF metres, Y up, (x, y, z) = UE (X, Z, Y) / 100, counter-clockwise fronts. */
function writeGlb(path: string, quads: readonly Quad[]): void {
  const pos: number[] = [];
  const idx: number[] = [];
  for (const q of quads) {
    const base = pos.length / 3;
    const p = (x: number, y: number) => pos.push(x / 100, q.z / 100, y / 100);
    p(q.x0, q.y0); p(q.x0, q.y1); p(q.x1, q.y0); p(q.x1, q.y1);
    // (x0,y0) (x0,y1) (x1,y0) is counter-clockwise seen from +Y (up)
    const tris = q.up ? [0, 1, 2, 2, 1, 3] : [0, 2, 1, 2, 3, 1];
    idx.push(...tris.map(t => base + t));
  }
  const bin = Buffer.alloc(pos.length * 4 + idx.length * 4);
  pos.forEach((v, i) => bin.writeFloatLE(v, i * 4));
  idx.forEach((v, i) => bin.writeUInt32LE(v, pos.length * 4 + i * 4));
  const json = Buffer.from(JSON.stringify({
    asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: pos.length / 3, type: 'VEC3' },
      { bufferView: 1, componentType: 5125, count: idx.length, type: 'SCALAR' },
    ],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: pos.length * 4 }, { buffer: 0, byteOffset: pos.length * 4, byteLength: idx.length * 4 }],
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
  it('keeps the zones touching a seed cell, diagonals included, and clears the rest', () => {
    // 6 x 3: zone A (two cells touching diagonally) at the left, zone B at the right
    const area = Uint8Array.from([
      1, 0, 0, 0, 1, 1,
      0, 1, 0, 0, 1, 1,
      0, 0, 0, 0, 0, 0,
    ]);
    expect(Array.from(keepZonesWith(area, 6, 3, [7]))).toEqual([
      1, 0, 0, 0, 0, 0,
      0, 1, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0,
    ]);
  });
});
