import type { Db } from '../db/db.js';
import { bumpRev } from './worlds.js';

export type MarkTuple = [actor: string, mismatch: 0 | 1, updatedBy: number | null, updatedAt: number];
export type RestoreRow = [actor: string, collected: boolean, mismatch: 0 | 1];

export function listMarks(db: Db, worldId: string): MarkTuple[] {
  const rows = db.prepare(
    'SELECT actor_name, mismatch, updated_by, updated_at FROM marks WHERE world_id = ? ORDER BY actor_name',
  ).all(worldId) as { actor_name: string; mismatch: 0 | 1; updated_by: number | null; updated_at: number }[];
  return rows.map(r => [r.actor_name, r.mismatch, r.updated_by, r.updated_at]);
}

function upsert(db: Db, worldId: string, actor: string, mismatch: 0 | 1, userId: number, now: number): void {
  db.prepare(
    `INSERT INTO marks(world_id, actor_name, mismatch, updated_by, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(world_id, actor_name) DO UPDATE SET
       mismatch = excluded.mismatch, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
  ).run(worldId, actor, mismatch, userId, now);
}

function remove(db: Db, worldId: string, actor: string): void {
  db.prepare('DELETE FROM marks WHERE world_id = ? AND actor_name = ?').run(worldId, actor);
}

export function setMark(db: Db, worldId: string, actor: string, collected: boolean, userId: number, now: number): { rev: number } {
  return db.transaction(() => {
    if (collected) upsert(db, worldId, actor, 0, userId, now);
    else remove(db, worldId, actor);
    return { rev: bumpRev(db, worldId) };
  })();
}

export function bulkMarks(
  db: Db, worldId: string, q: { actors: string[]; collected: boolean; onlyIfMismatch: boolean },
  userId: number, now: number,
): { rev: number; previous: RestoreRow[] } {
  return db.transaction(() => {
    const previous: RestoreRow[] = [];
    const get = db.prepare('SELECT mismatch FROM marks WHERE world_id = ? AND actor_name = ?');
    for (const actor of new Set(q.actors)) {
      const row = get.get(worldId, actor) as { mismatch: 0 | 1 } | undefined;
      if (q.onlyIfMismatch && row?.mismatch !== 1) continue;
      previous.push([actor, row !== undefined, row?.mismatch ?? 0]);
      if (q.collected) upsert(db, worldId, actor, 0, userId, now);
      else remove(db, worldId, actor);
    }
    return { rev: bumpRev(db, worldId), previous };
  })();
}

export function restoreMarks(db: Db, worldId: string, rows: RestoreRow[], userId: number, now: number): { rev: number } {
  return db.transaction(() => {
    for (const [actor, collected, mismatch] of rows) {
      if (collected) upsert(db, worldId, actor, mismatch, userId, now);
      else remove(db, worldId, actor);
    }
    return { rev: bumpRev(db, worldId) };
  })();
}
