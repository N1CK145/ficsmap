import { describe, expect, it } from 'vitest';
import { applyDelta, diffArray, diffSnapshots, isSnapshotDelta, type SnapshotDelta } from '../../src/shared/factory/delta.js';

const b = (id: string, productivity = 1) => ({ id, cls: 'Build_SmelterMk1_C', x: 0, y: 0, z: 0, yaw: 0, prod: { clock: 1, productivity } });
const base = () => ({
  v: 1,
  meta: { sessionName: 'S', saveTime: 1 },
  buildings: [b('a'), b('b'), b('c'), b('d'), b('e')],
  powerLines: [0, 0, 0, 1, 1, 1],
  markers: [{ name: 'Base', x: 1 }],
  links: [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }],
});
/** Over the wire: the delta as JSON, as the server sends it. */
const wire = (d: SnapshotDelta) => JSON.parse(JSON.stringify(d)) as SnapshotDelta;

describe('snapshot deltas', () => {
  it('rebuilds the target exactly: changed, added, removed and moved elements, new and dropped fields, key order', () => {
    const from = base();
    const { markers: _dropped, ...rest } = from;
    const to = {
      ...rest,
      meta: { sessionName: 'S', saveTime: 2 },
      buildings: [b('e'), b('a'), b('b', 0.5), b('x'), b('d')],
      powerLines: [0, 0, 0, 2, 2, 2],
      depot: [['Desc_Wire_C', 10]],
    };
    const d = diffSnapshots(from, to, 1, 2);
    expect(JSON.stringify(applyDelta(from, wire(d)))).toBe(JSON.stringify(to));
    // Changes only: 'b' and 'x' are new elements, 'e', 'a', 'd' come from the base.
    expect(d.arrays.buildings!.add).toEqual([b('b', 0.5), b('x')]);
    expect(Object.keys(d.set).sort()).toEqual(['depot', 'meta', 'powerLines']);
    expect(d.arrays.links).toBeUndefined();
  });

  it('shares the base objects for what did not change, and unchanged arrays whole', () => {
    const from = base();
    const to = { ...base(), buildings: [b('a'), b('b'), b('c', 0), b('d'), b('e')] };
    const out = applyDelta(from, wire(diffSnapshots(from, to, 1, 2)));
    expect(out.buildings[0]).toBe(from.buildings[0]);
    expect(out.buildings[4]).toBe(from.buildings[4]);
    expect(out.buildings[2]).not.toBe(from.buildings[2]);
    expect(out.links).toBe(from.links);
    expect(out.markers).toBe(from.markers);
  });

  it('describes runs over the base: copy, then append', () => {
    expect(diffArray([1, 2, 3].map(n => ({ n })), [1, 2, 3].map(n => ({ n })))).toBeNull();
    // Copy 0..1, add one, copy 2 (a new run after an added element).
    expect(diffArray([{ n: 1 }, { n: 2 }, { n: 3 }], [{ n: 1 }, { n: 2 }, { n: 9 }, { n: 3 }])).toEqual({ runs: [0, 2, 1, 2, 1, 0], add: [{ n: 9 }] });
    // Only new elements; equal duplicates are each used once.
    expect(diffArray([{ n: 1 }], [{ n: 2 }])).toEqual({ runs: [0, 0, 1], add: [{ n: 2 }] });
    expect(diffArray([{ n: 1 }, { n: 1 }], [{ n: 1 }, { n: 1 }, { n: 1 }])).toEqual({ runs: [0, 2, 1], add: [{ n: 1 }] });
  });

  it('refuses a delta that does not fit its base', () => {
    const from = base();
    const d = wire(diffSnapshots(from, { ...base(), buildings: [b('z')] }, 1, 2));
    expect(() => applyDelta({ ...from, buildings: [] }, { ...d, arrays: { buildings: { runs: [3, 2, 0], add: [] } } })).toThrow(/does not fit/);
    expect(() => applyDelta(from, { ...d, arrays: { buildings: { runs: [0, 0, 2], add: [b('z')] } } })).toThrow(/does not fit/);
    expect(() => applyDelta(from, { ...d, keys: [...d.keys, 'missing'] })).toThrow(/does not fit/);
  });

  it('recognises its own format only', () => {
    const d = wire(diffSnapshots(base(), base(), 1, 2));
    expect(isSnapshotDelta(d)).toBe(true);
    expect(isSnapshotDelta({ ...d, delta: 2 })).toBe(false);
    expect(isSnapshotDelta({ v: 1, buildings: [] })).toBe(false);
    expect(isSnapshotDelta(null)).toBe(false);
  });
});
