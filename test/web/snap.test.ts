import { nearestSnap, type Snap } from '../../src/web/features/mobile/snap.js';

// A 390×844 phone: peek 96 px, half 50vh, full 92vh.
const H: Record<Snap, number> = { peek: 96, half: 422, full: 776 };

describe('nearestSnap', () => {
  it('a slow release near half gives half', () => {
    expect(nearestSnap(440, 0.1, H)).toBe('half');
    expect(nearestSnap(400, -0.2, H)).toBe('half');
  });

  it('a slow release goes to the nearest snap', () => {
    expect(nearestSnap(150, 0, H)).toBe('peek');
    expect(nearestSnap(700, 0.3, H)).toBe('full');
  });

  it('a fast upward flick from peek gives half', () => {
    expect(nearestSnap(110, 1.2, H)).toBe('half');
  });

  it('a fast downward flick from full gives half', () => {
    expect(nearestSnap(760, -1.2, H)).toBe('half');
  });

  it('a flick goes to the next snap past the release point, and stops at the ends', () => {
    expect(nearestSnap(500, 0.8, H)).toBe('full');
    expect(nearestSnap(400, -0.8, H)).toBe('peek');
    expect(nearestSnap(776, 2, H)).toBe('full');
    expect(nearestSnap(96, -2, H)).toBe('peek');
  });

  it('treats exactly 0.5 px/ms as slow', () => {
    expect(nearestSnap(110, 0.5, H)).toBe('peek');
  });
});
