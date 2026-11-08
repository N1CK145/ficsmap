import { routeGeometry, routeLengthInput } from '../../src/shared/vehicleRoute.js';

describe('vehicle route geometry', () => {
  it('measures the straight line on the map in metres (100 world units = 1 m)', () => {
    // 3-4-5 triangle: 300 m east, 400 m south.
    const g = routeGeometry({ x: 1000, y: 2000 }, { x: 31_000, y: 42_000 });
    expect(g).toEqual({ meters: 500, climbMeters: null, meters3d: null });
    expect(routeGeometry({ x: 5, y: 5 }, { x: 5, y: 5 }).meters).toBe(0);
  });

  it('adds the height difference and the 3D length when both heights are known', () => {
    // 400 m on the map, 30 m uphill (heights in cm): 3D length 401.1 m.
    const g = routeGeometry({ x: 0, y: 0 }, { x: 40_000, y: 0 }, 1_500, 4_500);
    expect(g.meters).toBe(400);
    expect(g.climbMeters).toBe(30);
    expect(g.meters3d).toBeCloseTo(Math.hypot(400, 30));
    // Downhill is negative; the 3D length is the same.
    const down = routeGeometry({ x: 0, y: 0 }, { x: 40_000, y: 0 }, 4_500, 1_500);
    expect(down.climbMeters).toBe(-30);
    expect(down.meters3d).toBeCloseTo(g.meters3d!);
  });

  it('leaves out the heights while one is unknown or loading', () => {
    expect(routeGeometry({ x: 0, y: 0 }, { x: 100, y: 0 }, null, 200)).toEqual({ meters: 1, climbMeters: null, meters3d: null });
    expect(routeGeometry({ x: 0, y: 0 }, { x: 100, y: 0 }, 200, undefined).climbMeters).toBeNull();
  });

  it('fills the route length with whole metres', () => {
    expect(routeLengthInput({ start: { x: 0, y: 0 }, end: { x: 123_456, y: 0 } })).toBe('1235');
    expect(routeLengthInput({ start: { x: 0, y: 0 }, end: { x: 0, y: 0 } })).toBe('0');
  });
});
