import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MeshoptDecoder } from 'meshoptimizer';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildCaveModel, caveModelSummary, encodeGlb, meshoptReady, simplify, weld, writeCaveModels } from '../../scripts/cave-models.js';
import { caveModelIndexUrl, caveModelUrl, type CaveModelIndex } from '../../src/shared/caveModels.js';
import { writeGlb, type Quad } from '../fixtures/caveGlb.js';

interface Gltf {
  extensionsRequired: string[];
  nodes: { name: string; mesh: number; translation: number[]; scale: number[] }[];
  meshes: { name: string; primitives: { attributes: { POSITION: number }; indices: number }[] }[];
  accessors: { bufferView: number; componentType: number; count: number; type: string; min?: number[]; max?: number[] }[];
  bufferViews: { byteLength: number; byteStride?: number; extensions: { EXT_meshopt_compression: { byteOffset: number; byteLength: number; byteStride: number; count: number; mode: string } } }[];
}

/** Parses a GLB written by encodeGlb and decodes every mesh: world positions (m) per vertex and the indices. */
function decode(glb: Uint8Array): { json: Gltf; meshes: Map<string, { positions: number[][]; indices: number[] }> } {
  const view = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
  expect(view.getUint32(0, true)).toBe(0x46546c67);
  expect(view.getUint32(8, true)).toBe(glb.byteLength);
  const jsonLength = view.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + jsonLength))) as Gltf;
  const bin = glb.subarray(20 + jsonLength + 8);
  const decodeView = (i: number) => {
    const ext = json.bufferViews[i]!.extensions.EXT_meshopt_compression;
    const out = new Uint8Array(ext.count * ext.byteStride);
    MeshoptDecoder.decodeGltfBuffer(out, ext.count, ext.byteStride, bin.subarray(ext.byteOffset, ext.byteOffset + ext.byteLength), ext.mode as 'ATTRIBUTES');
    return out;
  };
  const meshes = new Map<string, { positions: number[][]; indices: number[] }>();
  for (const node of json.nodes) {
    const prim = json.meshes[node.mesh]!.primitives[0]!;
    const pa = json.accessors[prim.attributes.POSITION]!;
    const ia = json.accessors[prim.indices]!;
    const raw = new Uint16Array(decodeView(pa.bufferView).buffer);
    const positions: number[][] = [];
    for (let v = 0; v < pa.count; v++) positions.push([0, 1, 2].map(a => node.translation[a]! + raw[v * 4 + a]! * node.scale[a]!));
    const idxBytes = decodeView(ia.bufferView);
    const indices = [...(ia.componentType === 5125 ? new Uint32Array(idxBytes.buffer) : new Uint16Array(idxBytes.buffer))];
    meshes.set(node.name, { positions, indices });
  }
  return { json, meshes };
}

/** A flat square (m, glTF axes, y = height) cut into n x n quads, as corners. */
function grid(n: number, size: number, y: number): Float32Array {
  const out: number[] = [];
  const s = size / n;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const x0 = i * s, z0 = j * s, x1 = x0 + s, z1 = z0 + s;
      out.push(x0, y, z0, x0, y, z1, x1, y, z0, x1, y, z0, x0, y, z1, x1, y, z1);
    }
  }
  return new Float32Array(out);
}

/** Triangles as strings, each rotated to start at its smallest index (same winding), sorted. */
function triangles(indices: ArrayLike<number>): string[] {
  const out: string[] = [];
  for (let t = 0; t < indices.length; t += 3) {
    const c = [indices[t]!, indices[t + 1]!, indices[t + 2]!];
    const k = c.indexOf(Math.min(...c));
    out.push([c[k], c[(k + 1) % 3], c[(k + 2) % 3]].join(','));
  }
  return out.sort();
}

const OPTS = { maxError: 0.3, maxTriangles: 400_000, budgetError: 2 };

beforeAll(() => meshoptReady());

describe('weld', () => {
  it('shares vertices between corners at the same position', () => {
    const m = weld(grid(1, 2, 0));
    expect(m.positions.length / 3).toBe(4);
    expect(m.indices.length).toBe(6);
    expect([...m.indices.slice(3)]).toEqual([m.indices[2], m.indices[1], 3]);
  });

  it('handles an empty part', () => {
    expect(weld(new Float32Array(0)).indices.length).toBe(0);
  });
});

describe('simplify', () => {
  it('reduces a flat, finely cut square to a few triangles and keeps its extent', () => {
    const m = simplify(weld(grid(20, 10, 1)), OPTS);
    expect(m.indices.length / 3).toBeLessThanOrEqual(8);
    const xs = [...m.positions].filter((_, i) => i % 3 === 0);
    expect(Math.min(...xs)).toBe(0);
    expect(Math.max(...xs)).toBe(10);
    expect(Math.max(...m.indices)).toBe(m.positions.length / 3 - 1);
  });

  it('goes on towards the triangle budget, within the budget error', () => {
    // A bumpy surface: the 0.3 m error keeps most of it, the budget forces it down.
    const c = grid(30, 30, 0);
    for (let i = 1; i < c.length; i += 3) c[i] = 0.5 * Math.sin(c[i - 1]!) * Math.cos(c[i + 1]!);
    const fine = simplify(weld(c), { ...OPTS, budgetError: 0 });
    const capped = simplify(weld(c), { ...OPTS, maxTriangles: 200, budgetError: 5 });
    expect(fine.indices.length / 3).toBeGreaterThan(200);
    expect(capped.indices.length / 3).toBeLessThanOrEqual(200);
  });
});

describe('encodeGlb', () => {
  it('writes quantized, meshopt-compressed meshes that decode to the input within one grid step', () => {
    const rock = weld(grid(2, 100, 5));
    const glb = encodeGlb([{ name: 'rock', mesh: rock }, { name: 'landscape', mesh: { positions: new Float32Array(0), indices: new Uint32Array(0) } }]);
    const { json, meshes } = decode(glb);
    expect(json.extensionsRequired).toEqual(['EXT_meshopt_compression', 'KHR_mesh_quantization']);
    // An empty part is left out.
    expect(json.nodes.map(n => n.name)).toEqual(['rock']);
    const step = json.nodes[0]!.scale[0]!;
    expect(step).toBeCloseTo(100 / 65535, 8);
    const out = meshes.get('rock')!;
    // The index codec may rotate a triangle's corners (keeping the winding).
    expect(triangles(out.indices)).toEqual(triangles(rock.indices));
    out.positions.forEach((p, v) => p.forEach((value, a) => expect(Math.abs(value - rock.positions[v * 3 + a]!)).toBeLessThanOrEqual(step)));
    expect(json.accessors[0]!.min).toEqual([0, 0, 0]);
    expect(json.accessors[0]!.max).toEqual([65535, 0, 65535]);
  });

  it('uses 32-bit indices above 65535 vertices', () => {
    const n = 70_000;
    const positions = new Float32Array(n * 3).map((_, i) => (i % 3 === 0 ? Math.floor(i / 3) : i % 3 === 2 ? (Math.floor(i / 3) % 2) : 0));
    const indices = new Uint32Array(Array.from({ length: n - 2 }, (_, i) => [i, i + 1, i + 2]).flat());
    const { json } = decode(encodeGlb([{ name: 'rock', mesh: { positions, indices } }]));
    expect(json.accessors[1]!.componentType).toBe(5125);
  });
});

describe('cave models from the extractor geometry', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ficsmap-cave-models-'));
  const src = join(dir, 'cave-geometry');
  const out = join(dir, 'dataset');
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  // UE cm: a cave floor and ceiling, and the landscape above.
  const rock: Quad[] = [
    { x0: 0, x1: 5000, y0: -500, y1: 500, z: -1000, up: true },
    { x0: 0, x1: 2500, y0: -500, y1: 500, z: -500, up: false },
  ];
  const land: Quad[] = [{ x0: -1000, x1: 2500, y0: -1500, y1: 1500, z: 0, up: true }];
  mkdirSync(src);
  writeGlb(join(src, 'cave-001.glb'), rock, land);
  writeFileSync(join(src, 'index.json'), JSON.stringify({ caves: [{ id: 'cave-001', file: 'cave-001.glb' }] }));

  it('builds one model with the rocks and the landscape as named parts, in glTF metres (Y up)', () => {
    const { glb, triangles } = buildCaveModel(join(src, 'cave-001.glb'), OPTS);
    expect(triangles).toBe(6);
    const { meshes } = decode(glb);
    expect([...meshes.keys()]).toEqual(['rock', 'landscape']);
    const ys = meshes.get('rock')!.positions.map(p => p[1]!);
    expect(Math.min(...ys)).toBeCloseTo(-10, 2);
    expect(Math.max(...ys)).toBeCloseTo(-5, 2);
    // UE Y (-15..15 m) is glTF z.
    const zs = meshes.get('landscape')!.positions.map(p => p[2]!);
    expect(Math.min(...zs)).toBeCloseTo(-15, 2);
    expect(Math.max(...zs)).toBeCloseTo(15, 2);
  });

  it('writes a model per cave and an index with hashes, replacing old models', async () => {
    mkdirSync(join(out, 'cave-models'), { recursive: true });
    writeFileSync(join(out, 'cave-models', 'cave-999.glb'), 'old');
    const lines: string[] = [];
    const r = await writeCaveModels(src, out, l => lines.push(l), OPTS);
    expect(existsSync(join(out, 'cave-models', 'cave-999.glb'))).toBe(false);
    const index = JSON.parse(readFileSync(join(out, 'cave-models', 'index.json'), 'utf8')) as CaveModelIndex;
    expect(index.maxError).toBe(0.3);
    expect(index.caves).toEqual([{ id: 'cave-001', file: 'cave-001.glb', hash: expect.stringMatching(/^[0-9a-f]{12}$/), triangles: 6, bytes: r.bytes }]);
    expect(readFileSync(join(out, 'cave-models', 'cave-001.glb')).byteLength).toBe(r.bytes);
    expect(lines).toHaveLength(1);
    expect(caveModelSummary(r)).toMatch(/^1 caves, 6 triangles, 0\.0 MB/);
  });

  it('refuses a cave id that is not a plain file name', async () => {
    const bad = join(dir, 'bad');
    mkdirSync(bad);
    writeGlb(join(bad, 'x.glb'), rock);
    writeFileSync(join(bad, 'index.json'), JSON.stringify({ caves: [{ id: '../x', file: 'x.glb' }] }));
    await expect(writeCaveModels(bad, join(dir, 'out2'), () => {}, OPTS)).rejects.toThrow(/bad cave id/);
  });
});

describe('cave model URLs', () => {
  it('point into the dataset version and carry the hash', () => {
    expect(caveModelIndexUrl('1.2.5.0')).toBe('/data/1.2.5.0/cave-models/index.json');
    expect(caveModelUrl('1.2.5.0', { id: 'cave-001', file: 'cave-001.glb', hash: 'abc', triangles: 1, bytes: 1 }))
      .toBe('/data/1.2.5.0/cave-models/cave-001.glb?v=abc');
  });
});
