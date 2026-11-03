import { describe, it, expect } from 'vitest';
import {
  UNITS_PER_METER, distance3d, worldToLatLng, latLngToWorld,
  imageToWorld, pointInRings, distanceToRings,
} from '../../src/shared/geo.js';

const b = { minX: -324698.83, minY: -375000, maxX: 425301.83, maxY: 375000 };
const square = [[0, 0], [10, 0], [10, 10], [0, 10]];
const hole = [[4, 4], [6, 4], [6, 6], [4, 6]];

describe('geo', () => {
  it('has 100 units per meter and 3d distance', () => {
    expect(UNITS_PER_METER).toBe(100);
    expect(distance3d({ x: 0, y: 0, z: 0 }, { x: 3, y: 4, z: 12 })).toBe(13);
  });

  it('maps world corners to lat/lng and back', () => {
    expect(worldToLatLng(b.minX, b.minY, b)).toEqual([0, 0]);
    const [lat, lng] = worldToLatLng(b.maxX, b.maxY, b);
    expect(lat).toBeCloseTo(-256, 9);
    expect(lng).toBeCloseTo(256, 9);
    const w = latLngToWorld(lat, lng, b);
    expect(w.x).toBeCloseTo(b.maxX, 5);
    expect(w.y).toBeCloseTo(b.maxY, 5);
    const mid = latLngToWorld(...worldToLatLng(1234, -5678, b), b);
    expect(mid.x).toBeCloseTo(1234, 5);
    expect(mid.y).toBeCloseTo(-5678, 5);
  });

  it('maps image units to world', () => {
    const c = { imageSize: 1000, world: b };
    expect(imageToWorld(0, 0, c)).toEqual({ x: b.minX, y: b.minY });
    const e = imageToWorld(1000, 1000, c);
    expect(e.x).toBeCloseTo(b.maxX, 5);
    expect(e.y).toBeCloseTo(b.maxY, 5);
  });

  it('pointInRings is even-odd (hole is outside)', () => {
    const rings = [square, hole];
    expect(pointInRings(2, 2, rings)).toBe(true);
    expect(pointInRings(5, 5, rings)).toBe(false);
    expect(pointInRings(11, 5, rings)).toBe(false);
  });

  it('distanceToRings is 0 inside and exact edge distance outside', () => {
    expect(distanceToRings(2, 2, [square])).toBe(0);
    expect(distanceToRings(13, 5, [square])).toBe(3);
    expect(distanceToRings(13, 14, [square])).toBe(5);
  });
});
