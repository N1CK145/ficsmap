import { newConflicts } from '../../src/web/features/map/conflictPulse.js';

describe('newConflicts', () => {
  it('pulses nothing on the first load', () => {
    expect(newConflicts(null, new Set(['a', 'b']))).toEqual([]);
  });

  it('pulses actors that became conflicts', () => {
    expect(newConflicts(new Set(['a']), new Set(['a', 'b', 'c']))).toEqual(['b', 'c']);
  });

  it('pulses nothing when conflicts only go away', () => {
    expect(newConflicts(new Set(['a', 'b']), new Set(['b']))).toEqual([]);
  });

  it('pulses an actor again after it was resolved and came back', () => {
    const resolved = newConflicts(new Set(['a']), new Set());
    expect(resolved).toEqual([]);
    expect(newConflicts(new Set(), new Set(['a']))).toEqual(['a']);
  });

  it('pulses nothing for an unchanged set', () => {
    const s = new Set(['a']);
    expect(newConflicts(s, new Set(['a']))).toEqual([]);
  });
});
