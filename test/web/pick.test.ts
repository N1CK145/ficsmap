import { pickNearest } from '../../src/web/features/map/pick.js';

describe('pickNearest', () => {
  it('returns the nearest point within the radius', () => {
    const points = [
      { id: 'far', px: 100, py: 100 },
      { id: 'near', px: 12, py: 10 },
      { id: 'mid', px: 20, py: 20 },
    ];
    expect(pickNearest(points, 10, 10, 16)).toBe('near');
  });

  it('gives null for a point just outside the radius', () => {
    expect(pickNearest([{ id: 'a', px: 16.01, py: 0 }], 0, 0, 16)).toBeNull();
  });

  it('accepts a point exactly on the radius', () => {
    expect(pickNearest([{ id: 'a', px: 0, py: 16 }], 0, 0, 16)).toBe('a');
  });

  it('lets the nearer of two overlapping points win, regardless of order', () => {
    const a = { id: 'a', px: 5, py: 5 };
    const b = { id: 'b', px: 8, py: 8 };
    expect(pickNearest([a, b], 9, 9, 16)).toBe('b');
    expect(pickNearest([b, a], 4, 4, 16)).toBe('a');
  });

  it('gives null without points', () => {
    expect(pickNearest([], 0, 0, 16)).toBeNull();
  });
});
