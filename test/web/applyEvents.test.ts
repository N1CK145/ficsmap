import type { MarksDto } from '../../src/shared/api.js';
import type { SseEvent } from '../../src/shared/sse.js';
import { applyMarkEvent, mergeSnapshot, putMark } from '../../src/web/features/live/applyEvents.js';
import type { MarksCache } from '../../src/web/features/marks/useMarks.js';

type MarkEvent = Extract<SseEvent, { type: 'mark' }>;

const cache = (rev: number, marks: [string, boolean][] = [], pending: [string, boolean][] = []): MarksCache => ({
  rev,
  baseRev: rev,
  marks: new Map(marks.map(([a, mismatch]) => [a, { mismatch, updatedBy: 1, updatedAt: 100 }])),
  revs: new Map(),
  pending: new Map(pending),
});

const ev = (p: Partial<MarkEvent>): MarkEvent =>
  ({ type: 'mark', actor: 'A', collected: true, mismatch: false, by: 2, at: 500, rev: 11, ...p });

const state = { mismatch: false, updatedBy: 3, updatedAt: 700 };

describe('applyMarkEvent', () => {
  it('ignores an event whose rev is at or below the cache rev', () => {
    const c = cache(10, [['A', false]]);
    expect(applyMarkEvent(c, ev({ actor: 'A', collected: false, rev: 10 }))).toBe(c);
    expect(applyMarkEvent(c, ev({ actor: 'B', collected: true, rev: 9 }))).toBe(c);
  });

  it('sets a mark from a newer event and takes its rev', () => {
    const c = cache(10);
    const next = applyMarkEvent(c, ev({ actor: 'B', collected: true, mismatch: false, by: 7, at: 900, rev: 12 }));
    expect(next.rev).toBe(12);
    expect(next.marks.get('B')).toEqual({ mismatch: false, updatedBy: 7, updatedAt: 900 });
    expect(next.revs.get('B')).toBe(12);
    expect(c.marks.has('B')).toBe(false); // the old cache object is not mutated
  });

  it('deletes a mark from a newer uncollected event and keeps the tombstone rev', () => {
    const next = applyMarkEvent(cache(10, [['A', true]]), ev({ actor: 'A', collected: false, rev: 11 }));
    expect(next.marks.has('A')).toBe(false);
    expect(next.revs.get('A')).toBe(11);
    expect(next.rev).toBe(11);
  });

  it('leaves the pending entry of an actor alone but stores the server value under it', () => {
    const c = cache(10, [], [['A', true]]);
    const next = applyMarkEvent(c, ev({ actor: 'A', collected: true, by: 2, at: 50, rev: 11 }));
    expect(next.pending.get('A')).toBe(true);
    expect(next.marks.get('A')).toEqual({ mismatch: false, updatedBy: 2, updatedAt: 50 });
    expect(next.rev).toBe(11);
  });
});

describe('putMark', () => {
  it('applies a newer per-actor rev and ignores an older one', () => {
    const c = putMark(cache(10), 'A', state, 12);
    expect(c.marks.get('A')).toEqual(state);
    expect(c.revs.get('A')).toBe(12);
    const older = putMark(c, 'A', null, 11);
    expect(older).toBe(c);
  });

  it('ignores a rev not newer than the snapshot for an actor it has no rev for', () => {
    const c = cache(10);
    expect(putMark(c, 'A', state, 10)).toBe(c);
  });

  it('does not move the stream rev', () => {
    expect(putMark(cache(10), 'A', state, 15).rev).toBe(10);
  });
});

describe('mergeSnapshot', () => {
  const dto = (rev: number, marks: MarksDto['marks']): MarksDto => ({ rev, marks });

  it('builds a fresh cache from the snapshot', () => {
    const c = mergeSnapshot(undefined, dto(7, [['A', 1, 2, 300]]));
    expect(c).toMatchObject({ rev: 7, baseRev: 7 });
    expect(c.marks.get('A')).toEqual({ mismatch: true, updatedBy: 2, updatedAt: 300 });
    expect(c.revs.size).toBe(0);
    expect(c.pending.size).toBe(0);
  });

  it('takes snapshot changes the cache missed even when the stream is already further', () => {
    // Events 11–15 were missed while offline; event 16 (actor C) arrived before the GET answered with rev 15.
    let current = cache(10, [['A', false]]);
    current = applyMarkEvent({ ...current, rev: 15 }, ev({ actor: 'C', collected: true, rev: 16 }));
    current = { ...current, pending: new Map([['P', true]]) };
    const next = mergeSnapshot(current, dto(15, [['B', 0, 4, 130]])); // A unchecked at 13, B checked at 13

    expect(next.marks.has('A')).toBe(false);
    expect(next.marks.get('B')).toEqual({ mismatch: false, updatedBy: 4, updatedAt: 130 });
    expect(next.marks.has('C')).toBe(true); // newer than the snapshot: kept
    expect(next.revs.get('C')).toBe(16);
    expect(next.rev).toBe(16);
    expect(next.baseRev).toBe(15);
    expect(next.pending.get('P')).toBe(true);
  });

  it('lets the snapshot win over cache entries at or below its rev, tombstones included', () => {
    const current = putMark(cache(10), 'A', null, 12); // deleted at 12
    const next = mergeSnapshot(current, dto(14, [['A', 0, 4, 140]])); // checked again at 14
    expect(next.marks.has('A')).toBe(true);
    expect(next.revs.has('A')).toBe(false);
    expect(next.rev).toBe(14);
  });
});
