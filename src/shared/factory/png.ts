/**
 * A small synchronous PNG encoder for 8-bit greyscale images (the explored-area mask of the factory snapshot).
 * Synchronous on purpose: it runs in the save worker and in node alike, without CompressionStream (async) or zlib
 * (node only). Compression is deflate with the fixed Huffman code and a greedy LZ77 matcher, plenty for a mask
 * that is mostly long runs.
 */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array, start = 0, end = bytes.length): number {
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function adler32(bytes: Uint8Array): number {
  let a = 1, b = 0;
  for (let i = 0; i < bytes.length; i++) {
    a = (a + bytes[i]!) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

class BitWriter {
  private buf = new Uint8Array(1 << 16);
  private len = 0;
  private bits = 0;
  private nbits = 0;

  private byte(b: number): void {
    if (this.len === this.buf.length) {
      const next = new Uint8Array(this.buf.length * 2);
      next.set(this.buf);
      this.buf = next;
    }
    this.buf[this.len++] = b;
  }

  /** `n` bits of `v`, least significant first (deflate's order for extra bits and headers). */
  write(v: number, n: number): void {
    this.bits |= v << this.nbits;
    this.nbits += n;
    while (this.nbits >= 8) {
      this.byte(this.bits & 0xff);
      this.bits >>>= 8;
      this.nbits -= 8;
    }
  }

  /** A Huffman code of `n` bits, most significant bit first. */
  code(c: number, n: number): void {
    let r = 0;
    for (let i = 0; i < n; i++) r |= ((c >> i) & 1) << (n - 1 - i);
    this.write(r, n);
  }

  finish(): Uint8Array {
    if (this.nbits > 0) this.byte(this.bits & 0xff);
    this.bits = 0;
    this.nbits = 0;
    return this.buf.subarray(0, this.len);
  }
}

const LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];

/** Literal/length symbol with the fixed Huffman code (RFC 1951 3.2.6). */
function writeSymbol(w: BitWriter, s: number): void {
  if (s < 144) w.code(0x30 + s, 8);
  else if (s < 256) w.code(0x190 + s - 144, 9);
  else if (s < 280) w.code(s - 256, 7);
  else w.code(0xc0 + s - 280, 8);
}

function upperIndex(table: readonly number[], v: number): number {
  let i = table.length - 1;
  while (table[i]! > v) i--;
  return i;
}

const WINDOW = 32768;
const MIN_MATCH = 3;
const MAX_MATCH = 258;
const MAX_CHAIN = 64;
const HASH_BITS = 15;

/** zlib stream (deflate, one fixed-Huffman block) of `data`. */
export function zlibCompress(data: Uint8Array): Uint8Array {
  const w = new BitWriter();
  w.write(0x78, 8);
  w.write(0x01, 8);
  w.write(1, 1); // BFINAL
  w.write(1, 2); // BTYPE = fixed Huffman
  const head = new Int32Array(1 << HASH_BITS).fill(-1);
  const prev = new Int32Array(WINDOW);
  const hashAt = (i: number) => ((data[i]! << 10) ^ (data[i + 1]! << 5) ^ data[i + 2]!) & ((1 << HASH_BITS) - 1);
  const insert = (i: number) => {
    if (i + MIN_MATCH > data.length) return;
    const h = hashAt(i);
    prev[i % WINDOW] = head[h]!;
    head[h] = i;
  };
  let i = 0;
  while (i < data.length) {
    let bestLen = 0, bestDist = 0;
    if (i + MIN_MATCH <= data.length) {
      let cand = head[hashAt(i)]!;
      const max = Math.min(MAX_MATCH, data.length - i);
      for (let chain = 0; cand >= 0 && i - cand <= WINDOW && chain < MAX_CHAIN; chain++) {
        let l = 0;
        while (l < max && data[cand + l] === data[i + l]) l++;
        if (l > bestLen) { bestLen = l; bestDist = i - cand; if (l === max) break; }
        const next = prev[cand % WINDOW]!;
        if (next >= cand) break; // overwritten slot of an older position
        cand = next;
      }
    }
    if (bestLen >= MIN_MATCH) {
      const li = upperIndex(LEN_BASE, bestLen);
      writeSymbol(w, 257 + li);
      if (LEN_EXTRA[li]) w.write(bestLen - LEN_BASE[li]!, LEN_EXTRA[li]!);
      const di = upperIndex(DIST_BASE, bestDist);
      w.code(di, 5);
      if (DIST_EXTRA[di]) w.write(bestDist - DIST_BASE[di]!, DIST_EXTRA[di]!);
      for (let k = 0; k < bestLen; k++) insert(i + k);
      i += bestLen;
    } else {
      writeSymbol(w, data[i]!);
      insert(i);
      i++;
    }
  }
  writeSymbol(w, 256);
  const body = w.finish();
  const out = new Uint8Array(body.length + 4);
  out.set(body);
  const a = adler32(data);
  out[body.length] = a >>> 24;
  out[body.length + 1] = (a >>> 16) & 0xff;
  out[body.length + 2] = (a >>> 8) & 0xff;
  out[body.length + 3] = a & 0xff;
  return out;
}

/** Each row with the PNG filter (None, Sub or Up) whose output has the smallest sum of absolute values. */
function filterRows(pixels: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array((width + 1) * height);
  const cost = (row: Uint8Array) => { let s = 0; for (const b of row) s += b < 128 ? b : 256 - b; return s; };
  const cand = [new Uint8Array(width), new Uint8Array(width), new Uint8Array(width)];
  for (let y = 0; y < height; y++) {
    const row = pixels.subarray(y * width, (y + 1) * width);
    const up = y > 0 ? pixels.subarray((y - 1) * width, y * width) : null;
    for (let x = 0; x < width; x++) {
      cand[0]![x] = row[x]!;
      cand[1]![x] = (row[x]! - (x > 0 ? row[x - 1]! : 0)) & 0xff;
      cand[2]![x] = (row[x]! - (up ? up[x]! : 0)) & 0xff;
    }
    let best = 0, bestCost = Infinity;
    for (let f = 0; f < 3; f++) {
      const c = cost(cand[f]!);
      if (c < bestCost) { bestCost = c; best = f; }
    }
    out[y * (width + 1)] = best; // filter types: 0 None, 1 Sub, 2 Up
    out.set(cand[best]!, y * (width + 1) + 1);
  }
  return out;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out, 4, 8 + data.length));
  return out;
}

/** An 8-bit greyscale PNG of `pixels` (row-major, `width` × `height`). */
export function encodeGreyPng(pixels: Uint8Array, width: number, height: number): Uint8Array {
  if (pixels.length !== width * height) throw new Error(`Expected ${width * height} pixels, got ${pixels.length}`);
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, width);
  v.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // colour type: greyscale
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlibCompress(filterRows(pixels, width, height))),
    chunk('IEND', new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/** Standard base64 of `bytes` (btoa exists in browsers, workers and node). */
export function toBase64(bytes: Uint8Array): string {
  let s = '';
  const STEP = 0x8000;
  for (let i = 0; i < bytes.length; i += STEP) s += String.fromCharCode(...bytes.subarray(i, i + STEP));
  return btoa(s);
}
