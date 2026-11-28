import { writeFileSync } from 'node:fs';

/** A horizontal rectangle in UE cm, facing up or down. */
export interface Quad { x0: number; x1: number; y0: number; y1: number; z: number; up: boolean }

/**
 * Writes a GLB like the extractor does: glTF metres, Y up, (x, y, z) = UE (X, Z, Y) / 100, counter-clockwise
 * fronts; `landscape` quads go into a second node named "landscape".
 */
export function writeGlb(path: string, quads: readonly Quad[], landscape: readonly Quad[] = []): void {
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
