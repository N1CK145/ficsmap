import { openDb } from '../../src/server/db/db.js';
import { bumpRev, createWorld, progress, removeMember, roleOf } from '../../src/server/domain/worlds.js';
import { createUserForTest } from '../api/helpers.js';
import type { DatasetIndex } from '../../src/shared/dataset.js';
import { HttpError } from '../../src/server/errors.js';

const index = { items: [{ name: 'A' }, { name: 'B' }], has: (n: string) => n === 'A' || n === 'B' } as unknown as DatasetIndex;

describe('worlds domain', () => {
  it('createWorld writes the owner membership', () => {
    const db = openDb(':memory:');
    const u = createUserForTest(db, 'u1');
    const w = createWorld(db, u, 'W', 'v1', 5);
    expect(w).toMatchObject({ name: 'W', owner_id: u, dataset_version: 'v1', rev: 0, created_at: 5 });
    expect(roleOf(db, w.id, u)).toBe('owner');
    expect(db.prepare('SELECT joined_via FROM world_members WHERE world_id = ?').get(w.id)).toEqual({ joined_via: 'owner' });
  });
  it('progress ignores marks whose actor is not in the index', () => {
    const db = openDb(':memory:');
    const u = createUserForTest(db, 'u1');
    const w = createWorld(db, u, 'W', 'v1', 5);
    const ins = db.prepare('INSERT INTO marks(world_id, actor_name, mismatch, updated_at) VALUES (?, ?, ?, 0)');
    ins.run(w.id, 'A', 0); ins.run(w.id, 'B', 1); ins.run(w.id, 'GONE', 0);
    expect(progress(db, w.id, index)).toEqual({ done: 2, total: 2 });
  });
  it('bumpRev increments', () => {
    const db = openDb(':memory:');
    const w = createWorld(db, createUserForTest(db, 'u1'), 'W', 'v1', 5);
    expect(bumpRev(db, w.id)).toBe(1);
    expect(bumpRev(db, w.id)).toBe(2);
  });
  it('removeMember of the owner throws 403', () => {
    const db = openDb(':memory:');
    const u = createUserForTest(db, 'u1');
    const w = createWorld(db, u, 'W', 'v1', 5);
    expect(() => removeMember(db, w.id, u)).toThrow(HttpError);
    expect(roleOf(db, w.id, u)).toBe('owner');
  });
});
