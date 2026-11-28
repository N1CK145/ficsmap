import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import { CAVE_MODEL_LANDSCAPE, CAVE_MODEL_ROCK, CAVE_MODELS_DIR, type CaveModelEntry, type CaveModelIndex } from '../src/shared/caveModels.js';
import { readGlb } from './cave-geometry.js';

/**
 * The dataset part `cave-models`: one small GLB per cave for the 3D cave viewer, made from the extractor's cave
 * geometry (`--cave-geometry-out`, one GLB per cave with every rock mesh and the landscape around it, 389 MB for
 * 1.2.5.0). Per cave the rocks and the landscape become one mesh each (identical positions welded), simplified with
 * meshoptimizer to at most `maxError` metres off the game's surfaces (and, for very large caves, further down to
 * `maxTriangles`), quantized to 16-bit positions (KHR_mesh_quantization) and compressed (EXT_meshopt_compression;
 * three.js decodes both). No normals or materials: the viewer shades flat.
 *
 * Axes as in the extractor's files: glTF metres, Y up, (x, y, z) = UE (X, Z, Y) / 100; the node transform places
 * the quantized positions in world coordinates.
 */

export interface IndexedMesh {
  /** xyz per vertex, metres. */
  positions: Float32Array;
  indices: Uint32Array;
}

export interface CaveModelOptions {
  /** Largest allowed deviation from the source surfaces (m). */
  maxError: number;
  /** Above this many triangles per cave the simplification goes on, up to `budgetError`. */
  maxTriangles: number;
  /** The error allowed to reach `maxTriangles` (m). */
  budgetError: number;
}

export const DEFAULT_CAVE_MODEL_OPTIONS: CaveModelOptions = { maxError: 0.3, maxTriangles: 400_000, budgetError: 2 };

export async function meshoptReady(): Promise<void> {
  await Promise.all([MeshoptSimplifier.ready, MeshoptEncoder.ready]);
}

/** Corners (9 floats per triangle) to an indexed mesh; corners at exactly the same position share a vertex. */
export function weld(corners: Float32Array): IndexedMesh {
  const n = corners.length / 3;
  if (n === 0) return { positions: new Float32Array(0), indices: new Uint32Array(0) };
  const remap = MeshoptSimplifier.generatePositionRemap(corners, 3);
  const slot = new Uint32Array(n).fill(0xffffffff);
  let count = 0;
  for (let i = 0; i < n; i++) if (remap[i] === i) slot[i] = count++;
  const positions = new Float32Array(count * 3);
  const indices = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    const first = remap[i]!;
    const s = slot[first]!;
    indices[i] = s;
    if (first === i) positions.set(corners.subarray(i * 3, i * 3 + 3), s * 3);
  }
  return { positions, indices };
}

/** Simplifies to `maxError` (absolute, m), then, if still above `maxTriangles`, towards it up to `budgetError`. */
export function simplify(mesh: IndexedMesh, opts: CaveModelOptions, budgetShare = 1): IndexedMesh {
  if (mesh.indices.length === 0) return mesh;
  let [indices] = MeshoptSimplifier.simplify(mesh.indices, mesh.positions, 3, 0, opts.maxError, ['ErrorAbsolute', 'Prune']);
  const budget = Math.floor(opts.maxTriangles * budgetShare) * 3;
  if (indices.length > budget && opts.budgetError > opts.maxError) {
    [indices] = MeshoptSimplifier.simplify(indices, mesh.positions, 3, budget, opts.budgetError, ['ErrorAbsolute', 'Prune']);
  }
  return compact({ positions: mesh.positions, indices: new Uint32Array(indices) });
}

/** Drops unused vertices and orders vertices and triangles for the GPU cache and for compression. */
export function compact(mesh: IndexedMesh): IndexedMesh {
  if (mesh.indices.length === 0) return { positions: new Float32Array(0), indices: new Uint32Array(0) };
  const indices = new Uint32Array(mesh.indices);
  const [remap, unique] = MeshoptEncoder.reorderMesh(indices, true, false);
  const positions = new Float32Array(unique * 3);
  for (let v = 0; v < remap.length; v++) {
    const to = remap[v]!;
    if (to !== 0xffffffff) positions.set(mesh.positions.subarray(v * 3, v * 3 + 3), to * 3);
  }
  return { positions, indices };
}

interface Part { name: string; mesh: IndexedMesh }

const align4 = (n: number) => (n + 3) & ~3;

/**
 * A GLB with one node per part (named after it), positions as unsigned 16-bit integers on a common grid (the node's
 * scale and translation give metres) and every buffer view meshopt-compressed.
 */
export function encodeGlb(parts: readonly Part[]): Uint8Array {
  const used = parts.filter(p => p.mesh.indices.length > 0);
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const { mesh } of used) {
    for (let i = 0; i < mesh.positions.length; i++) {
      const a = i % 3;
      min[a] = Math.min(min[a]!, mesh.positions[i]!);
      max[a] = Math.max(max[a]!, mesh.positions[i]!);
    }
  }
  const extent = Math.max(max[0]! - min[0]!, max[1]! - min[1]!, max[2]! - min[2]!, 1e-6);
  // One step for all axes (uniform scale keeps normals computed from the quantized positions right).
  const step = extent / 65535;

  const chunks: Uint8Array[] = [];
  let compressedLength = 0;
  let fallbackLength = 0;
  const bufferViews: unknown[] = [];
  const accessors: unknown[] = [];
  const addView = (raw: Uint8Array, count: number, stride: number, mode: 'ATTRIBUTES' | 'TRIANGLES', target: number) => {
    const encoded = MeshoptEncoder.encodeGltfBuffer(raw, count, stride, mode);
    const ext = { buffer: 0, byteOffset: compressedLength, byteLength: encoded.byteLength, byteStride: stride, count, mode };
    chunks.push(encoded);
    const pad = align4(encoded.byteLength) - encoded.byteLength;
    if (pad) chunks.push(new Uint8Array(pad));
    compressedLength += encoded.byteLength + pad;
    bufferViews.push({
      buffer: 1, byteOffset: fallbackLength, byteLength: raw.byteLength, target,
      ...(mode === 'ATTRIBUTES' ? { byteStride: stride } : {}),
      extensions: { EXT_meshopt_compression: ext },
    });
    fallbackLength += align4(raw.byteLength);
    return bufferViews.length - 1;
  };

  const nodes: unknown[] = [];
  const meshes: unknown[] = [];
  for (const { name, mesh } of used) {
    const vertexCount = mesh.positions.length / 3;
    // xyz as uint16 plus 2 bytes of padding: meshopt needs strides divisible by 4.
    const q = new Uint16Array(vertexCount * 4);
    const qMin = [65535, 65535, 65535];
    const qMax = [0, 0, 0];
    for (let v = 0; v < vertexCount; v++) {
      for (let a = 0; a < 3; a++) {
        const value = Math.max(0, Math.min(65535, Math.round((mesh.positions[v * 3 + a]! - min[a]!) / step)));
        q[v * 4 + a] = value;
        qMin[a] = Math.min(qMin[a]!, value);
        qMax[a] = Math.max(qMax[a]!, value);
      }
    }
    const posView = addView(new Uint8Array(q.buffer), vertexCount, 8, 'ATTRIBUTES', 34962);
    accessors.push({ bufferView: posView, componentType: 5123, count: vertexCount, type: 'VEC3', min: qMin, max: qMax });
    const posAccessor = accessors.length - 1;
    const wide = vertexCount > 65535;
    const idx = wide ? mesh.indices : Uint16Array.from(mesh.indices);
    const idxView = addView(new Uint8Array(idx.buffer, idx.byteOffset, idx.byteLength), mesh.indices.length, wide ? 4 : 2, 'TRIANGLES', 34963);
    accessors.push({ bufferView: idxView, componentType: wide ? 5125 : 5123, count: mesh.indices.length, type: 'SCALAR' });
    meshes.push({ name, primitives: [{ attributes: { POSITION: posAccessor }, indices: accessors.length - 1, mode: 4 }] });
    nodes.push({ name, mesh: meshes.length - 1, translation: min, scale: [step, step, step] });
  }

  const json = {
    asset: { version: '2.0', generator: 'ficsmap cave-models' },
    extensionsUsed: ['EXT_meshopt_compression', 'KHR_mesh_quantization'],
    extensionsRequired: ['EXT_meshopt_compression', 'KHR_mesh_quantization'],
    scene: 0,
    scenes: [{ nodes: nodes.map((_, i) => i) }],
    nodes, meshes, accessors, bufferViews,
    buffers: [
      { byteLength: compressedLength },
      { byteLength: Math.max(4, fallbackLength), extensions: { EXT_meshopt_compression: { fallback: true } } },
    ],
  };
  const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jsonLength = align4(jsonBytes.byteLength);
  const total = 12 + 8 + jsonLength + 8 + compressedLength;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  out.set(jsonBytes, 20);
  out.fill(0x20, 20 + jsonBytes.byteLength, 20 + jsonLength);
  let o = 20 + jsonLength;
  view.setUint32(o, compressedLength, true);
  view.setUint32(o + 4, 0x004e4942, true);
  o += 8;
  for (const c of chunks) { out.set(c, o); o += c.byteLength; }
  return out;
}

/** The extractor's cave GLB as corners in glTF metres, split into rocks and landscape. */
export function readCaveParts(path: string): { rock: Float32Array; landscape: Float32Array } {
  const tris = readGlb(path);
  let landCount = 0;
  for (let t = 0; t < tris.count; t++) landCount += tris.land?.[t] ?? 0;
  const rock = new Float32Array((tris.count - landCount) * 9);
  const landscape = new Float32Array(landCount * 9);
  let r = 0, l = 0;
  for (let t = 0; t < tris.count; t++) {
    const isLand = tris.land?.[t] === 1;
    const dst = isLand ? landscape : rock;
    let o = isLand ? l : r;
    for (let c = 0; c < 3; c++) {
      const s = t * 9 + c * 3;
      // UE cm (Z up) back to glTF metres (Y up): (X, Z, Y) / 100; the corner order (winding) stays.
      dst[o++] = tris.pos[s]! / 100;
      dst[o++] = tris.pos[s + 2]! / 100;
      dst[o++] = tris.pos[s + 1]! / 100;
    }
    if (isLand) l = o; else r = o;
  }
  return { rock, landscape };
}

/** One cave's model from the extractor's GLB. */
export function buildCaveModel(path: string, opts: CaveModelOptions = DEFAULT_CAVE_MODEL_OPTIONS): { glb: Uint8Array; triangles: number } {
  const { rock, landscape } = readCaveParts(path);
  const total = rock.length + landscape.length || 1;
  const parts = [
    { name: CAVE_MODEL_ROCK, mesh: simplify(weld(rock), opts, rock.length / total) },
    { name: CAVE_MODEL_LANDSCAPE, mesh: simplify(weld(landscape), opts, landscape.length / total) },
  ];
  const triangles = parts.reduce((n, p) => n + p.mesh.indices.length / 3, 0);
  return { glb: encodeGlb(parts), triangles };
}

interface GeometryIndex { caves: { id: string; file: string }[] }

/**
 * Writes `cave-models/<id>.glb` and `cave-models/index.json` from the extractor's `cave-geometry/` (its index.json
 * lists the caves). Old models in the folder are removed first.
 */
export async function writeCaveModels(
  geometryDir: string, outDir: string, log: (line: string) => void = () => {}, opts: CaveModelOptions = DEFAULT_CAVE_MODEL_OPTIONS,
): Promise<CaveModelIndex & { bytes: number }> {
  await meshoptReady();
  const source = JSON.parse(readFileSync(join(geometryDir, 'index.json'), 'utf8')) as GeometryIndex;
  const dir = join(outDir, CAVE_MODELS_DIR);
  if (existsSync(dir)) for (const f of readdirSync(dir)) if (f.endsWith('.glb')) rmSync(join(dir, f));
  mkdirSync(dir, { recursive: true });
  const caves: CaveModelEntry[] = [];
  let bytes = 0;
  for (const c of source.caves) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(c.id)) throw new Error(`cave-geometry/index.json: bad cave id ${JSON.stringify(c.id)}`);
    const { glb, triangles } = buildCaveModel(join(geometryDir, c.file), opts);
    const file = `${c.id}.glb`;
    writeFileSync(join(dir, file), glb);
    const hash = createHash('sha256').update(glb).digest('hex').slice(0, 12);
    caves.push({ id: c.id, file, hash, triangles, bytes: glb.byteLength });
    bytes += glb.byteLength;
    log(`  ${c.id}: ${triangles} triangles, ${(glb.byteLength / 1e6).toFixed(2)} MB`);
  }
  const index: CaveModelIndex = { maxError: opts.maxError, caves };
  writeFileSync(join(dir, 'index.json'), JSON.stringify(index));
  return { ...index, bytes };
}

export function caveModelSummary(r: CaveModelIndex & { bytes: number }): string {
  const largest = Math.max(0, ...r.caves.map(c => c.bytes));
  return `${r.caves.length} caves, ${r.caves.reduce((n, c) => n + c.triangles, 0)} triangles, ${(r.bytes / 1e6).toFixed(1)} MB `
    + `(largest ${(largest / 1e6).toFixed(2)} MB), max error ${r.maxError} m`;
}
