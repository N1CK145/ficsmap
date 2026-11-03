import { openDb } from '../../src/server/db/db.js';
import { createWorld, getWorld } from '../../src/server/domain/worlds.js';
import { bulkMarks, listMarks, restoreMarks, setMark } from '../../src/server/domain/marks.js';
import { createUserForTest } from '../api/helpers.js';

function setup() {
  const db = openDb(':memory:');
  const u = createUserForTest(db, 'u1');
  const w = createWorld(db, u, 'W', 'v1', 1);
  return { db, u, w };
}

describe('marks domain', () => {
  it('setMark true then false leaves no row and bumps rev twice', () => {
    const { db, u, w } = setup();
    expect(setMark(db, w.id, 'A', true, u, 10)).toEqual({ rev: 1 });
    expect(listMarks(db, w.id)).toEqual([['A', 0, u, 10]]);
    expect(setMark(db, w.id, 'A', false, u, 11)).toEqual({ rev: 2 });
    expect(listMarks(db, w.id)).toEqual([]);
    expect(getWorld(db, w.id)!.rev).toBe(2);
  });

  it('bulk onlyIfMismatch + collected=false deletes only flagged rows', () => {
    const { db, u, w } = setup();
    const ins = db.prepare('INSERT INTO marks(world_id, actor_name, mismatch, updated_at) VALUES (?, ?, ?, 0)');
    ins.run(w.id, 'A', 1); ins.run(w.id, 'B', 0);
    const out = bulkMarks(db, w.id, { actors: ['A', 'B', 'C'], collected: false, onlyIfMismatch: true }, u, 5);
    expect(listMarks(db, w.id).map(m => m[0])).toEqual(['B']);
    expect(out.previous).toEqual([['A', true, 1]]);
    expect(out.rev).toBe(1);
  });

  it('bulk onlyIfMismatch + collected=true clears the flag', () => {
    const { db, u, w } = setup();
    db.prepare('INSERT INTO marks(world_id, actor_name, mismatch, updated_at) VALUES (?, ?, 1, 0)').run(w.id, 'A');
    bulkMarks(db, w.id, { actors: ['A'], collected: true, onlyIfMismatch: true }, u, 5);
    expect(listMarks(db, w.id)).toEqual([['A', 0, u, 5]]);
  });

  it('previous + restoreMarks restore the exact rows, mismatch included', () => {
    const { db, u, w } = setup();
    const ins = db.prepare('INSERT INTO marks(world_id, actor_name, mismatch, updated_at) VALUES (?, ?, ?, 0)');
    ins.run(w.id, 'A', 1); ins.run(w.id, 'B', 0);
    const before = listMarks(db, w.id).map(m => [m[0], m[1]]);
    const out = bulkMarks(db, w.id, { actors: ['A', 'B', 'C', 'A'], collected: false, onlyIfMismatch: false }, u, 5);
    expect(out.previous).toEqual([['A', true, 1], ['B', true, 0], ['C', false, 0]]);
    expect(listMarks(db, w.id)).toEqual([]);
    const r = restoreMarks(db, w.id, out.previous, u, 6);
    expect(r.rev).toBe(2);
    expect(listMarks(db, w.id).map(m => [m[0], m[1]])).toEqual(before);
  });
});
