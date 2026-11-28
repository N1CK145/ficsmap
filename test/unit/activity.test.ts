import { openDb } from '../../src/server/db/db.js';
import { ACTIVITY_KEEP, COALESCE_MS, listActivity, recordActivity } from '../../src/server/domain/activity.js';
import { createWorld } from '../../src/server/domain/worlds.js';
import { createUserForTest } from '../api/helpers.js';

function setup() {
  const db = openDb(':memory:');
  const a = createUserForTest(db, 'a');
  const b = createUserForTest(db, 'b');
  const w = createWorld(db, a, 'W', 'v1', 0);
  return { db, a, b, w };
}

describe('world activity', () => {
  it('lists entries newest first with the names of who did it and to whom', () => {
    const { db, a, b, w } = setup();
    recordActivity(db, w.id, { kind: 'join', userId: b }, 10);
    recordActivity(db, w.id, { kind: 'role', userId: a, targetId: b, detail: 'admin' }, 20);
    recordActivity(db, w.id, { kind: 'rename', userId: a, detail: 'Neu' }, 30);
    expect(listActivity(db, w.id)).toEqual([
      expect.objectContaining({ kind: 'rename', by: { id: a, name: 'user-a' }, target: null, detail: 'Neu', count: 1, at: 30 }),
      expect.objectContaining({ kind: 'role', by: { id: a, name: 'user-a' }, target: { id: b, name: 'user-b' }, detail: 'admin', at: 20 }),
      expect.objectContaining({ kind: 'join', by: { id: b, name: 'user-b' }, at: 10 }),
    ]);
  });

  it('adds check changes of the same person within 15 minutes into the newest entry', () => {
    const { db, a, b, w } = setup();
    recordActivity(db, w.id, { kind: 'marks', userId: a, count: 1 }, 0);
    recordActivity(db, w.id, { kind: 'marks', userId: a, count: 3 }, COALESCE_MS - 1);
    expect(listActivity(db, w.id)).toEqual([expect.objectContaining({ kind: 'marks', count: 4, at: COALESCE_MS - 1 })]);
    // Measured from the entry's last change, so a steady session stays one entry.
    recordActivity(db, w.id, { kind: 'marks', userId: a, count: 1 }, 2 * COALESCE_MS - 2);
    expect(listActivity(db, w.id)).toHaveLength(1);
    // Someone else in between starts new entries.
    recordActivity(db, w.id, { kind: 'marks', userId: b, count: 1 }, 2 * COALESCE_MS);
    recordActivity(db, w.id, { kind: 'marks', userId: a, count: 1 }, 2 * COALESCE_MS + 1);
    expect(listActivity(db, w.id).map(e => [e.by?.id, e.count])).toEqual([[a, 1], [b, 1], [a, 5]]);
    // Too late: a new entry.
    recordActivity(db, w.id, { kind: 'marks', userId: a, count: 1 }, 4 * COALESCE_MS);
    expect(listActivity(db, w.id)).toHaveLength(4);
  });

  it('never adds up kinds that are single events', () => {
    const { db, a, w } = setup();
    recordActivity(db, w.id, { kind: 'rename', userId: a, detail: 'X' }, 0);
    recordActivity(db, w.id, { kind: 'rename', userId: a, detail: 'Y' }, 1);
    expect(listActivity(db, w.id).map(e => e.detail)).toEqual(['Y', 'X']);
  });

  it(`keeps the newest ${ACTIVITY_KEEP} entries per world and goes with the world`, () => {
    const { db, a, w } = setup();
    const other = createWorld(db, a, 'O', 'v1', 0);
    recordActivity(db, other.id, { kind: 'rename', userId: a, detail: 'O' }, 0);
    for (let i = 0; i < ACTIVITY_KEEP + 5; i++) recordActivity(db, w.id, { kind: 'rename', userId: a, detail: String(i) }, i);
    const n = (id: string) => (db.prepare('SELECT COUNT(*) AS n FROM activity WHERE world_id = ?').get(id) as { n: number }).n;
    expect(n(w.id)).toBe(ACTIVITY_KEEP);
    expect(n(other.id)).toBe(1);
    expect(listActivity(db, w.id, 3).map(e => e.detail)).toEqual([String(ACTIVITY_KEEP + 4), String(ACTIVITY_KEEP + 3), String(ACTIVITY_KEEP + 2)]);
    db.prepare('DELETE FROM worlds WHERE id = ?').run(w.id);
    expect(n(w.id)).toBe(0);
  });

  it('keeps entries of a deleted account without a name', () => {
    const { db, a, b, w } = setup();
    recordActivity(db, w.id, { kind: 'remove', userId: a, targetId: b }, 1);
    db.prepare('DELETE FROM users WHERE id = ?').run(b);
    expect(listActivity(db, w.id)[0]).toMatchObject({ by: { id: a }, target: null });
  });
});
