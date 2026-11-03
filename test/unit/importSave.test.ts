import { openDb } from '../../src/server/db/db.js';
import { createWorld, getWorld } from '../../src/server/domain/worlds.js';
import { listMarks } from '../../src/server/domain/marks.js';
import { applyImport } from '../../src/server/domain/importSave.js';
import type { DatasetIndex } from '../../src/shared/dataset.js';
import type { ImportRequest } from '../../src/shared/api.js';
import { createUserForTest } from '../api/helpers.js';

const NAMES = new Set(['A', 'B', 'C', 'D']);
const index = { has: (n: string) => NAMES.has(n) } as unknown as DatasetIndex;
const meta = { fileName: 'f.sav', sessionName: 'S', saveTime: 123, build: 456 };
const req = (collected: string[]): ImportRequest => ({ ...meta, collected });

function setup() {
  const db = openDb(':memory:');
  const u = createUserForTest(db, 'u1');
  const w = createWorld(db, u, 'W', 'v1', 1);
  const ins = (actor: string, mismatch: 0 | 1) =>
    db.prepare('INSERT INTO marks(world_id, actor_name, mismatch, updated_by, updated_at) VALUES (?, ?, ?, NULL, 0)')
      .run(w.id, actor, mismatch);
  return { db, u, w, ins };
}

describe('applyImport', () => {
  it('rule table: all four cells', () => {
    const { db, u, w, ins } = setup();
    ins('B', 0); // checked & in S -> warning cleared
    ins('C', 0); // checked & not in S -> stays checked, mismatch 1
    const out = applyImport(db, w.id, req(['A', 'B']), index, u, 50);
    const marks = Object.fromEntries(listMarks(db, w.id).map(m => [m[0], m[1]]));
    expect(marks).toEqual({ A: 0, B: 0, C: 1 }); // A: unchecked & in S -> checked; D (unchecked, not in S) has no row
    expect(out).toMatchObject({ newlyChecked: 1, conflicts: 1, ignored: 0, collectedTotal: 2 });
  });

  it('a flagged row in S is not newly checked, just cleared', () => {
    const { db, u, w, ins } = setup();
    ins('A', 1);
    const out = applyImport(db, w.id, req(['A']), index, u, 50);
    expect(listMarks(db, w.id)).toEqual([['A', 0, null, 0]]); // attribution of the existing mark is kept
    expect(out).toMatchObject({ newlyChecked: 0, conflicts: 0 });
  });

  it('an already-checked mark keeps its updated_by/updated_at; new marks are attributed to the importer', () => {
    const { db, u, w } = setup();
    const checker = createUserForTest(db, 'checker');
    db.prepare('INSERT INTO marks(world_id, actor_name, mismatch, updated_by, updated_at) VALUES (?, ?, 0, ?, 10)').run(w.id, 'B', checker);
    applyImport(db, w.id, req(['A', 'B']), index, u, 50);
    expect(listMarks(db, w.id)).toEqual([['A', 0, u, 50], ['B', 0, checker, 10]]);
  });

  it('re-importing the same set gives newlyChecked 0', () => {
    const { db, u, w } = setup();
    expect(applyImport(db, w.id, req(['A', 'B']), index, u, 1).newlyChecked).toBe(2);
    const again = applyImport(db, w.id, req(['A', 'B']), index, u, 2);
    expect(again).toMatchObject({ newlyChecked: 0, conflicts: 0, collectedTotal: 2, rev: 2 });
  });

  it('dedupes and counts unknown names as ignored', () => {
    const { db, u, w } = setup();
    const out = applyImport(db, w.id, req(['A', 'A', 'Nope', 'Nope', 'Other']), index, u, 1);
    expect(out).toMatchObject({ newlyChecked: 1, ignored: 2, collectedTotal: 1 });
  });

  it('an unknown-actor mark is not counted as a conflict', () => {
    const { db, u, w, ins } = setup();
    ins('Gone', 0);
    const out = applyImport(db, w.id, req([]), index, u, 1);
    expect(out.conflicts).toBe(0);
    expect(out.collectedTotal).toBe(0);
    expect(listMarks(db, w.id).map(m => [m[0], m[1]])).toEqual([['Gone', 1]]);
  });

  it('an empty collected list flags every existing dataset mark', () => {
    const { db, u, w, ins } = setup();
    ins('A', 0); ins('B', 0);
    const out = applyImport(db, w.id, req([]), index, u, 1);
    expect(out).toMatchObject({ newlyChecked: 0, conflicts: 2 });
    expect(listMarks(db, w.id).map(m => m[1])).toEqual([1, 1]);
  });

  it('bumps rev and stores last_import_*', () => {
    const { db, u, w } = setup();
    const out = applyImport(db, w.id, req(['A']), index, u, 777);
    const row = getWorld(db, w.id)!;
    expect(out.rev).toBe(1);
    expect(row.rev).toBe(1);
    expect(row.last_import_at).toBe(777);
    expect(JSON.parse(row.last_import_meta!)).toEqual(meta);
  });
});
