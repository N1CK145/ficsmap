import { indexDataset, type Dataset } from '../../src/shared/dataset.js';
import type { ExtractResult } from '../../src/shared/extract.js';
import { computePreview, countByType } from '../../src/web/features/import/preview.js';
import type { MarksCache } from '../../src/web/features/marks/useMarks.js';

const index = indexDataset({
  version: 'test', build: 500, bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 }, mapId: 'm', podRequirementsKnown: true, biomes: [],
  items: [
    ['A', 'somersloop', 0, 0, 0, 0, 1],
    ['B', 'somersloop', 0, 0, 0, 0, 2],
    ['C', 'hard_drive', 0, 0, 0, 0, 1],
    ['D', 'hard_drive', 0, 0, 0, 0, 2],
    ['E', 'slug_blue', 0, 0, 0, 0, 1],
  ],
  aliases: {},
} satisfies Dataset);

function result(collected: string[], build = 500): ExtractResult {
  return { meta: { sessionName: 'S', saveTime: 0, build }, collected, openedNotLooted: [], recognised: collected.length };
}

function cache(checked: string[], pending: [string, boolean][] = []): MarksCache {
  return {
    rev: 1, baseRev: 1, revs: new Map(), pending: new Map(pending),
    marks: new Map(checked.map(a => [a, { mismatch: false, updatedBy: 1, updatedAt: 0 }])),
  };
}

describe('computePreview', () => {
  it('counts the §7 table: in the save and unchecked → will be checked; checked and not in the save → conflict', () => {
    // A: checked + in save (stays, no warning); B: checked, not in save (conflict);
    // C: unchecked + in save (will be checked); D: unchecked, not in save (unchanged);
    // GONE: a mark for an actor outside the dataset never counts.
    const p = computePreview(result(['A', 'C']), cache(['A', 'B', 'GONE']), index);
    expect(p).toEqual({ recognised: 2, willCheck: 1, conflicts: 1, buildNewer: false, needsSecondConfirm: false });
  });

  it('counts what the user sees: a pending check counts as checked, a pending uncheck as unchecked', () => {
    const p = computePreview(result(['C']), cache(['A'], [['B', true], ['A', false]]), index);
    expect(p.conflicts).toBe(1); // B
    expect(p.willCheck).toBe(1); // C
  });

  it('asks for a second confirmation when the save matches nothing and the world has checks', () => {
    expect(computePreview(result([]), cache(['A']), index).needsSecondConfirm).toBe(true);
  });

  it('does not ask when the save matches nothing and the world has no checks', () => {
    expect(computePreview(result([]), cache([]), index).needsSecondConfirm).toBe(false);
    // Only marks outside the dataset: nothing would get flagged either.
    expect(computePreview(result([]), cache(['GONE']), index).needsSecondConfirm).toBe(false);
  });

  it('flags a save from a newer build than the dataset', () => {
    expect(computePreview(result(['A'], 501), cache([]), index).buildNewer).toBe(true);
    expect(computePreview(result(['A'], 500), cache([]), index).buildNewer).toBe(false);
  });
});

describe('countByType', () => {
  it('counts recognised items per type in registry order, skipping empty types', () => {
    expect(countByType(['C', 'A', 'D', 'B', 'E'], index)).toEqual([['slug_blue', 1], ['somersloop', 2], ['hard_drive', 2]]);
  });
});
