import type { Db } from '../db/db.js';
import type { ActivityDto, ActivityKind } from '../../shared/api.js';

/** Rows kept per world; older ones are dropped on every write. */
export const ACTIVITY_KEEP = 200;
/** Repeated changes of one person within this time after the newest entry add up into it. */
export const COALESCE_MS = 15 * 60_000;
/** Kinds that add up; the rest are single events. */
const COALESCING: ReadonlySet<ActivityKind> = new Set(['marks', 'import', 'snapshots', 'routes']);

export interface ActivityInput {
  kind: ActivityKind;
  /** Who did it; null when nobody is known (an upload key whose creator is gone). */
  userId: number | null;
  targetId?: number;
  detail?: string;
  count?: number;
}

/**
 * Writes an entry to the world's feed. A coalescing kind by the same person as the world's newest entry, at most
 * COALESCE_MS after it, adds to that entry instead (count and time), so a check session is one line.
 */
export function recordActivity(db: Db, worldId: string, e: ActivityInput, now: number): void {
  const count = e.count ?? 1;
  if (count <= 0) return;
  db.transaction(() => {
    if (COALESCING.has(e.kind)) {
      const last = db.prepare('SELECT id, kind, user_id, at FROM activity WHERE world_id = ? ORDER BY id DESC LIMIT 1')
        .get(worldId) as { id: number; kind: string; user_id: number | null; at: number } | undefined;
      if (last && last.kind === e.kind && last.user_id === e.userId && now - last.at < COALESCE_MS) {
        db.prepare('UPDATE activity SET count = count + ?, at = ? WHERE id = ?').run(count, now, last.id);
        return;
      }
    }
    db.prepare('INSERT INTO activity(world_id, user_id, kind, target_id, detail, count, at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(worldId, e.userId, e.kind, e.targetId ?? null, e.detail ?? null, count, now);
    db.prepare(
      `DELETE FROM activity WHERE world_id = ? AND id <= (
         SELECT id FROM activity WHERE world_id = ? ORDER BY id DESC LIMIT 1 OFFSET ?)`,
    ).run(worldId, worldId, ACTIVITY_KEEP);
  })();
}

/** The world's newest entries, newest first. */
export function listActivity(db: Db, worldId: string, limit = 50): ActivityDto[] {
  const rows = db.prepare(
    `SELECT a.id, a.kind, a.detail, a.count, a.at, u.id AS by_id, u.display_name AS by_name, t.id AS target_id, t.display_name AS target_name
     FROM activity a LEFT JOIN users u ON u.id = a.user_id LEFT JOIN users t ON t.id = a.target_id
     WHERE a.world_id = ? ORDER BY a.id DESC LIMIT ?`,
  ).all(worldId, limit) as {
    id: number; kind: ActivityKind; detail: string | null; count: number; at: number;
    by_id: number | null; by_name: string | null; target_id: number | null; target_name: string | null;
  }[];
  return rows.map(r => ({
    id: r.id,
    kind: r.kind,
    by: r.by_id === null ? null : { id: r.by_id, name: r.by_name! },
    target: r.target_id === null ? null : { id: r.target_id, name: r.target_name! },
    detail: r.detail,
    count: r.count,
    at: r.at,
  }));
}
