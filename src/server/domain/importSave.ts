import type { Db } from '../db/db.js';
import type { DatasetIndex } from '../../shared/dataset.js';
import type { ImportRequest, ImportResultDto } from '../../shared/api.js';
import { bumpRev } from './worlds.js';

/** Spec §7: marks the save does not report get mismatch=1; names in the save are inserted or cleared to mismatch=0. */
export function applyImport(
  db: Db, worldId: string, req: ImportRequest, index: DatasetIndex, userId: number, now: number,
): ImportResultDto {
  const distinct = [...new Set(req.collected)];
  const s = distinct.filter(n => index.has(n));
  const ignored = distinct.length - s.length;
  return db.transaction((): ImportResultDto => {
    const exists = db.prepare('SELECT 1 FROM marks WHERE world_id = ? AND actor_name = ?');
    const fresh = s.filter(n => exists.get(worldId, n) === undefined).length;
    db.prepare('UPDATE marks SET mismatch = 1 WHERE world_id = ?').run(worldId);
    // New marks are attributed to the importer; existing ones only lose the flag and keep who checked them when.
    const insert = db.prepare(
      `INSERT INTO marks(world_id, actor_name, mismatch, updated_by, updated_at) VALUES (?, ?, 0, ?, ?)
       ON CONFLICT(world_id, actor_name) DO NOTHING`,
    );
    const clear = db.prepare('UPDATE marks SET mismatch = 0 WHERE world_id = ? AND actor_name = ?');
    for (const n of s) {
      if (insert.run(worldId, n, userId, now).changes === 0) clear.run(worldId, n);
    }
    const flagged = db.prepare('SELECT actor_name FROM marks WHERE world_id = ? AND mismatch = 1').all(worldId) as { actor_name: string }[];
    const conflicts = flagged.filter(r => index.has(r.actor_name)).length;
    const rev = bumpRev(db, worldId);
    db.prepare('UPDATE worlds SET last_import_at = ?, last_import_meta = ? WHERE id = ?').run(
      now, JSON.stringify({ fileName: req.fileName, sessionName: req.sessionName, saveTime: req.saveTime, build: req.build }), worldId,
    );
    return { rev, newlyChecked: fresh, conflicts, ignored, collectedTotal: s.length };
  })();
}
