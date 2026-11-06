/**
 * The height layer's colour scale: one hue, light (low) to dark (high), the sequential blue ramp of the
 * dataviz reference palette (steps 100-700). Heights outside the dataset's range are clamped to its ends.
 */
export const HEIGHT_RAMP = [
  '#cde2fb', '#b7d3f6', '#9ec5f4', '#86b6ef', '#6da7ec', '#5598e7', '#3987e5',
  '#2a78d6', '#256abf', '#1c5cab', '#184f95', '#104281', '#0d366b',
] as const;

const LUT_SIZE = 256;

function rgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [n >> 16 & 255, n >> 8 & 255, n & 255];
}

/** 256 colours along the ramp, packed RGB per entry. */
export const HEIGHT_LUT: Uint8Array = (() => {
  const out = new Uint8Array(LUT_SIZE * 3);
  const stops = HEIGHT_RAMP.map(rgb);
  for (let k = 0; k < LUT_SIZE; k++) {
    const t = (k / (LUT_SIZE - 1)) * (stops.length - 1);
    const a = Math.min(stops.length - 2, Math.floor(t)), f = t - a;
    for (let c = 0; c < 3; c++) out[k * 3 + c] = Math.round(stops[a]![c]! * (1 - f) + stops[a + 1]![c]! * f);
  }
  return out;
})();

/** CSS gradient of the ramp, low on the left, for the legend. */
export const HEIGHT_GRADIENT = `linear-gradient(to right, ${HEIGHT_RAMP.join(', ')})`;

/**
 * Fills RGBA pixels (`size × size`) from `sample(px, py)`: a height in cm, or null for no surface
 * (transparent). Heights map linearly onto the ramp between `lo` and `hi`.
 */
export function paintHeights(rgba: Uint8ClampedArray, size: number, sample: (px: number, py: number) => number | null, lo: number, hi: number): void {
  const span = hi > lo ? hi - lo : 1;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const o = (py * size + px) * 4;
      const z = sample(px, py);
      if (z === null) { rgba[o + 3] = 0; continue; }
      const k = Math.max(0, Math.min(LUT_SIZE - 1, Math.round(((z - lo) / span) * (LUT_SIZE - 1)))) * 3;
      rgba[o] = HEIGHT_LUT[k]!; rgba[o + 1] = HEIGHT_LUT[k + 1]!; rgba[o + 2] = HEIGHT_LUT[k + 2]!; rgba[o + 3] = 255;
    }
  }
}
