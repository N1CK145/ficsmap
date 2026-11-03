/** The id of the point nearest to (x, y) within `radiusPx` (inclusive), or null. Container pixels. */
export function pickNearest(points: { id: string; px: number; py: number }[], x: number, y: number, radiusPx: number): string | null {
  let best: string | null = null;
  let bestD2 = radiusPx * radiusPx;
  for (const p of points) {
    const dx = p.px - x;
    const dy = p.py - y;
    const d2 = dx * dx + dy * dy;
    if (d2 <= bestD2) {
      best = p.id;
      bestD2 = d2;
    }
  }
  return best;
}
