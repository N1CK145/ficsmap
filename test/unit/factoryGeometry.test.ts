import { inflateSync } from 'node:zlib';
import { flatPolyline, rotate, sampleSpline, simplify, toWorld, yawOf, type Quat } from '../../src/shared/factory/geometry.js';
import { encodeGreyPng, toBase64, zlibCompress } from '../../src/shared/factory/png.js';

const yawQuat = (deg: number): Quat => {
  const h = (deg * Math.PI) / 360;
  return { x: 0, y: 0, z: Math.sin(h), w: Math.cos(h) };
};

describe('transforms', () => {
  it('yaw from a quaternion, rounded to 0.1, 0 facing +x', () => {
    expect(yawOf({ x: 0, y: 0, z: 0, w: 1 })).toBe(0);
    expect(yawOf(yawQuat(90))).toBe(90);
    expect(yawOf(yawQuat(-135.04))).toBe(-135);
    expect(yawOf({ x: 0, y: 0, z: 1, w: 6.1e-17 })).toBe(180);
  });

  it('rotates local points and adds the translation', () => {
    const r = rotate(yawQuat(90), { x: 100, y: 0, z: 5 });
    expect(r.x).toBeCloseTo(0);
    expect(r.y).toBeCloseTo(100);
    expect(r.z).toBeCloseTo(5);
    const w = toWorld({ rotation: yawQuat(180), translation: { x: 1000, y: 2000, z: 300 } }, { x: 100, y: 50, z: 0 });
    expect([w.x, w.y, w.z].map(Math.round)).toEqual([900, 1950, 300]);
  });
});

describe('splines', () => {
  it('keeps a straight belt at its two end points', () => {
    const pts = sampleSpline([
      { location: { x: 0, y: 0, z: 0 }, arrive: { x: -1, y: 0, z: 0 }, leave: { x: -600, y: 0, z: 0 } },
      { location: { x: -2279, y: 0, z: 0 }, arrive: { x: -600, y: 0, z: 0 }, leave: { x: -1, y: 0, z: 0 } },
    ]);
    expect(pts).toHaveLength(2);
  });

  it('samples a curve on the Hermite path and simplifies within the tolerance', () => {
    // A quarter circle of radius 1000 from (0,0) to (1000,1000): tangents ≈ 1.65 × radius.
    const t = 1657;
    const dense = sampleSpline([
      { location: { x: 0, y: 0, z: 0 }, arrive: { x: t, y: 0, z: 0 }, leave: { x: t, y: 0, z: 0 } },
      { location: { x: 1000, y: 1000, z: 0 }, arrive: { x: 0, y: t, z: 0 }, leave: { x: 0, y: t, z: 0 } },
    ]);
    expect(dense.length).toBeGreaterThan(4);
    // Every sample lies on the circle around (0, 1000); at t = 0.5: 0.5·p0 + 0.125·T0 + 0.5·p1 − 0.125·T1.
    for (const p of dense) expect(Math.abs(Math.hypot(p.x, p.y - 1000) - 1000)).toBeLessThan(5);
    expect(dense.some(p => Math.abs(p.x - 707) < 1 && Math.abs(p.y - 293) < 1)).toBe(true);
    const simple = simplify(dense, 50);
    expect(simple.length).toBeLessThan(dense.length);
    expect(simple.length).toBeGreaterThanOrEqual(3);
    expect(simple[0]).toEqual(dense[0]);
    expect(simple.at(-1)).toEqual(dense.at(-1));
  });

  it('simplify drops points within the tolerance only', () => {
    const line = [{ x: 0, y: 0, z: 0 }, { x: 500, y: 30, z: 0 }, { x: 1000, y: 0, z: 0 }, { x: 1500, y: 200, z: 0 }, { x: 2000, y: 0, z: 0 }];
    expect(simplify(line, 50)).toEqual([line[0], line[2], line[3], line[4]]);
  });

  it('flatPolyline rounds and drops repeated points', () => {
    expect(flatPolyline([{ x: 0.4, y: -0.4, z: 1.6 }, { x: 0.2, y: 0, z: 2 }, { x: 10, y: 0, z: 2 }])).toEqual([0, 0, 2, 10, 0, 2]);
  });
});

describe('PNG encoder', () => {
  it('zlib output inflates back to the input', () => {
    const data = new Uint8Array(70_000);
    for (let i = 0; i < data.length; i++) data[i] = i % 7000 < 3000 ? 0 : (i * 31) % 251;
    const z = zlibCompress(data);
    expect(Buffer.from(inflateSync(z)).equals(Buffer.from(data))).toBe(true);
    expect(z.length).toBeLessThan(data.length);
    expect(Buffer.from(inflateSync(zlibCompress(new Uint8Array(0)))).length).toBe(0);
  });

  it('writes a valid greyscale PNG whose rows decode to the pixels', () => {
    const w = 64, h = 48;
    const px = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px[y * w + x] = x < y ? 255 : (x * 4) & 0xff;
    const png = Buffer.from(encodeGreyPng(px, w, h));
    expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(png.readUInt32BE(16)).toBe(w);
    expect(png.readUInt32BE(20)).toBe(h);
    expect(png[24]).toBe(8);
    expect(png[25]).toBe(0);
    // IDAT follows IHDR (8 signature + 25 IHDR bytes)
    const len = png.readUInt32BE(33);
    expect(png.subarray(37, 41).toString('latin1')).toBe('IDAT');
    const raw = inflateSync(png.subarray(41, 41 + len));
    const out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      const f = raw[y * (w + 1)]!;
      for (let x = 0; x < w; x++) {
        const v = raw[y * (w + 1) + 1 + x]!;
        const left = x > 0 ? out[y * w + x - 1]! : 0, up = y > 0 ? out[(y - 1) * w + x]! : 0;
        out[y * w + x] = (v + (f === 1 ? left : f === 2 ? up : 0)) & 0xff;
      }
    }
    expect(Buffer.from(out).equals(Buffer.from(px))).toBe(true);
    expect(png.subarray(-8, -4).toString('latin1')).toBe('IEND');
  });

  it('base64 matches node', () => {
    const b = new Uint8Array(100_000).map((_, i) => (i * 7) & 0xff);
    expect(toBase64(b)).toBe(Buffer.from(b).toString('base64'));
  });
});
