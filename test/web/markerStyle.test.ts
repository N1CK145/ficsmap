import type { CollectedVisibility } from '../../src/web/app/store.js';
import { markerState, markerVisual, type MarkerState, type MarkerVisual, podBadge } from '../../src/web/features/map/markerStyle.js';

type Opts = Parameters<typeof markerVisual>[1];
const base: Opts = {
  visibility: 'dim', zoom: 3, selected: false, inScope: true, typeEnabled: true, onlyConflicts: false, routeIndex: null,
};

describe('markerState', () => {
  it.each([
    [false, false, 'uncollected'],
    [false, true, 'uncollected'],
    [true, false, 'collected'],
    [true, true, 'conflict'],
  ] as const)('collected=%s mismatch=%s gives %s', (collected, mismatch, expected) => {
    expect(markerState(collected, mismatch)).toBe(expected);
  });
});

describe('markerVisual', () => {
  const rows: [string, MarkerState, Partial<Opts>, Partial<MarkerVisual>][] = [
    ['uncollected draws full', 'uncollected', {}, { draw: true, opacity: 1, dot: false, badge: 'none' }],
    ['disabled type is not drawn', 'uncollected', { typeEnabled: false }, { draw: false }],
    ['disabled type hides a conflict too', 'conflict', { typeEnabled: false }, { draw: false }],
    ['hide + collected is not drawn', 'collected', { visibility: 'hide' }, { draw: false }],
    ['hide keeps a conflict', 'conflict', { visibility: 'hide' }, { draw: true, opacity: 1, badge: 'conflict' }],
    ['hide keeps uncollected', 'uncollected', { visibility: 'hide' }, { draw: true, opacity: 1 }],
    ['dim + collected is 0.35 with a check', 'collected', { visibility: 'dim' }, { draw: true, opacity: 0.35, badge: 'check' }],
    ['show + collected is 1', 'collected', { visibility: 'show' }, { draw: true, opacity: 1, badge: 'check' }],
    ['dim leaves uncollected at 1', 'uncollected', { visibility: 'dim' }, { opacity: 1 }],
    ['out of scope multiplies by 0.2', 'uncollected', { inScope: false }, { draw: true, opacity: 0.2 }],
    ['out of scope + dim collected is 0.07', 'collected', { inScope: false, visibility: 'dim' }, { opacity: 0.35 * 0.2 }],
    ['zoom 1.5 is a dot', 'uncollected', { zoom: 1.5 }, { dot: true }],
    ['zoom 0 is a dot', 'uncollected', { zoom: 0 }, { dot: true }],
    ['zoom 2 is a full marker', 'uncollected', { zoom: 2 }, { dot: false }],
    ['onlyConflicts hides uncollected', 'uncollected', { onlyConflicts: true }, { draw: false }],
    ['onlyConflicts hides collected', 'collected', { onlyConflicts: true, visibility: 'show' }, { draw: false }],
    ['onlyConflicts keeps conflicts', 'conflict', { onlyConflicts: true }, { draw: true, badge: 'conflict' }],
    ['conflict badge wins over check', 'conflict', { visibility: 'show' }, { badge: 'conflict' }],
    ['selected passes through', 'uncollected', { selected: true }, { selected: true }],
    ['route index passes through', 'collected', { routeIndex: 4 }, { routeIndex: 4 }],
    ['no search: no highlight, no fade', 'uncollected', { search: null }, { draw: true, opacity: 1, highlight: false }],
    ['search match gets the highlight', 'uncollected', { search: true }, { draw: true, opacity: 1, highlight: true }],
    ['search non-match fades by 0.2', 'uncollected', { search: false }, { draw: true, opacity: 0.2, highlight: false }],
    ['search non-match out of scope fades twice', 'uncollected', { search: false, inScope: false }, { opacity: 0.04 }],
    ['search match is drawn although its type is off', 'uncollected', { search: true, typeEnabled: false }, { draw: true, highlight: true }],
    ['search match is drawn although collected ones are hidden', 'collected', { search: true, visibility: 'hide' }, { draw: true, badge: 'check' }],
    ['search match is drawn with only conflicts on', 'uncollected', { search: true, onlyConflicts: true }, { draw: true }],
    ['search non-match keeps the filters', 'uncollected', { search: false, typeEnabled: false }, { draw: false }],
  ];

  it.each(rows)('%s', (_name, state, opts, expected) => {
    const v = markerVisual(state, { ...base, ...opts });
    for (const [key, value] of Object.entries(expected)) {
      if (key === 'opacity') expect(v.opacity).toBeCloseTo(value as number, 10);
      else expect(v[key as keyof MarkerVisual]).toBe(value);
    }
  });

  it('defaults to not selected, no route index and no search highlight', () => {
    expect(markerVisual('uncollected', base)).toEqual({
      draw: true, opacity: 1, dot: false, selected: false, routeIndex: null, badge: 'none', highlight: false,
    });
  });

  it.each(['show', 'dim', 'hide'] satisfies CollectedVisibility[])('conflicts ignore visibility %s', visibility => {
    expect(markerVisual('conflict', { ...base, visibility })).toMatchObject({ draw: true, opacity: 1 });
  });
});

describe('podBadge', () => {
  it('is power for power-only pods, free when nothing is needed, none for item pods and unknown data', () => {
    expect(podBadge({ item: null, amount: 0, power: 100 })).toBe('power');
    expect(podBadge({ item: null, amount: 0, power: 0 })).toBe('free');
    expect(podBadge({ item: { en: 'Rotor', de: 'Rotor' }, amount: 4, power: 0 })).toBeUndefined();
    expect(podBadge({ item: { en: 'Rotor', de: 'Rotor' }, amount: 4, power: 30 })).toBeUndefined();
    expect(podBadge(undefined)).toBeUndefined();
  });
});
