import type { Vec3, WorldBounds } from './types.js';

export const UNITS_PER_METER = 100;

export function distance3d(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/** Zoom-0 image is 256 px: lng = (x-minX)/(maxX-minX)*256, lat = -(y-minY)/(maxY-minY)*256. */
export function worldToLatLng(x: number, y: number, b: WorldBounds): [lat: number, lng: number] {
  const lng = ((x - b.minX) / (b.maxX - b.minX)) * 256;
  const lat = 0 - ((y - b.minY) / (b.maxY - b.minY)) * 256; // 0 - avoids -0
  return [lat, lng];
}

export function latLngToWorld(lat: number, lng: number, b: WorldBounds): { x: number; y: number } {
  return {
    x: b.minX + (lng / 256) * (b.maxX - b.minX),
    y: b.minY + (-lat / 256) * (b.maxY - b.minY),
  };
}

/** Image units (0..imageSize, x east, y south) → world units. */
export interface Calibration { imageSize: number; world: WorldBounds }

export function imageToWorld(px: number, py: number, c: Calibration): { x: number; y: number } {
  const { world: w, imageSize } = c;
  return {
    x: w.minX + (px / imageSize) * (w.maxX - w.minX),
    y: w.minY + (py / imageSize) * (w.maxY - w.minY),
  };
}

type Edge = [ax: number, ay: number, bx: number, by: number];

function* edges(rings: number[][][]): Generator<Edge> {
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[j]!;
      const b = ring[i]!;
      yield [a[0]!, a[1]!, b[0]!, b[1]!];
    }
  }
}

/** Even-odd rule over all rings. */
export function pointInRings(x: number, y: number, rings: number[][][]): boolean {
  let inside = false;
  for (const [xj, yj, xi, yi] of edges(rings)) {
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function distanceToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Minimum distance to any ring edge; 0 if the point is inside. */
export function distanceToRings(x: number, y: number, rings: number[][][]): number {
  if (pointInRings(x, y, rings)) return 0;
  let best = Infinity;
  for (const [ax, ay, bx, by] of edges(rings)) {
    best = Math.min(best, distanceToSegment(x, y, ax, ay, bx, by));
  }
  return best;
}
