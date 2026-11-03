import { quickClick } from '../../src/web/features/quickCheck/quickClick.js';

describe('quickClick', () => {
  it('zooms in on dots (zoom < 2)', () => {
    expect(quickClick({ zoom: 1, collected: false, mismatch: false })).toEqual({ kind: 'zoomIn' });
  });

  it('opens the panel for a conflict instead of toggling it', () => {
    expect(quickClick({ zoom: 3, collected: true, mismatch: true })).toEqual({ kind: 'openPanel' });
  });

  it('toggles to the other value', () => {
    expect(quickClick({ zoom: 2, collected: true, mismatch: false })).toEqual({ kind: 'toggle', collected: false });
    expect(quickClick({ zoom: 2, collected: false, mismatch: false })).toEqual({ kind: 'toggle', collected: true });
  });
});
