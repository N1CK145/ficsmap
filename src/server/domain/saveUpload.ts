import type { Db } from '../db/db.js';
import type { DatasetIndex } from '../../shared/dataset.js';
import type { SaveUploadResultDto } from '../../shared/api.js';
import type { ExtractResult } from '../../shared/extract.js';
import type { FactorySnapshot } from '../../shared/factory/snapshot.js';
import type { SseEvent } from '../../shared/sse.js';
import { HttpError } from '../errors.js';
import { applyImport } from './importSave.js';
import { encodeSnapshot, parseSnapshot, storeSnapshot } from './snapshots.js';
import { lastImportOf, type WorldRow } from './worlds.js';

/**
 * Rules of the save watcher's upload (`POST /api/worlds/:id/saves`): which session a world expects, whether a save is
 * newer than the world's last import (then it is imported) or older (then only its factory snapshot is kept), and
 * whether the world has it already.
 */

/** The session a world's saves belong to: its last import's, else its newest snapshot's, else none yet (as the browser's "Add older saves"). */
export function worldSession(db: Db, world: WorldRow): string | undefined {
  const fromImport = lastImportOf(world)?.sessionName;
  if (fromImport !== undefined) return fromImport;
  const r = db.prepare('SELECT session_name FROM factory_snapshots WHERE world_id = ? ORDER BY save_time DESC, id DESC LIMIT 1')
    .get(world.id) as { session_name: string } | undefined;
  return r?.session_name;
}

export type UploadPlan = 'import' | 'snapshot' | 'duplicate';

/**
 * What to do with a save of this session and time. 409 `session_mismatch` for a save of another session than the
 * world's, unless the token accepts any session. Newer than the last import (or no import yet): `import`; else
 * `duplicate` when the world has its snapshot already, otherwise `snapshot`.
 */
export function planUpload(
  db: Db, world: WorldRow, save: { sessionName: string; saveTime: number }, anySession: boolean,
): UploadPlan {
  const expected = worldSession(db, world);
  if (!anySession && expected !== undefined && expected !== save.sessionName) {
    throw new HttpError(409, 'session_mismatch', `The save belongs to the session "${save.sessionName}", the world to "${expected}"`);
  }
  const last = lastImportOf(world);
  const newer = last?.saveTime === undefined || save.saveTime > Math.trunc(last.saveTime);
  if (newer) return 'import';
  const known = db.prepare('SELECT 1 FROM factory_snapshots WHERE world_id = ? AND session_name = ? AND save_time = ?')
    .get(world.id, save.sessionName, save.saveTime);
  return known ? 'duplicate' : 'snapshot';
}

export interface UploadInput {
  world: WorldRow;
  plan: Exclude<UploadPlan, 'duplicate'>;
  fileName: string;
  /** The parse result; `meta.saveTime` as the header gave it (see `readSaveHeader`). */
  result: ExtractResult;
  userId: number;
  now: number;
}

/**
 * Applies a parsed save: `import` runs the normal import (the same `applyImport` as `POST /import`) and stores the
 * snapshot; `snapshot` stores only the snapshot. A snapshot the world has no room for fails a `snapshot` upload (409
 * `limit_reached`) but not an import, which then says so in `note` (also `no_factory`, `invalid_factory`, and
 * `thinned` when the retention rule thinned the stored snapshot at once). Returns the answer and the events to broadcast.
 */
export async function applyUpload(
  db: Db, index: DatasetIndex, input: UploadInput,
): Promise<{ dto: SaveUploadResultDto; events: SseEvent[] }> {
  const { world, plan, result, userId, now } = input;
  const meta = { ...result.meta, saveTime: Math.trunc(result.meta.saveTime) };
  const events: SseEvent[] = [];
  const dto: SaveUploadResultDto = { status: plan === 'import' ? 'imported' : 'snapshot', sessionName: meta.sessionName, saveTime: meta.saveTime, snapshot: false };

  // Checked against the upload format (as a browser's upload would be) and encoded before anything is written. A
  // snapshot that does not fit is left out; the import still counts.
  let snapshot: { s: FactorySnapshot; gz: Buffer } | undefined;
  let note: string | undefined = result.factory ? undefined : 'no_factory';
  if (result.factory) {
    try {
      const s = parseSnapshot(result.factory);
      snapshot = { s, gz: await encodeSnapshot(s) };
    } catch {
      note = 'invalid_factory';
    }
  }

  if (plan === 'import') {
    const out = applyImport(db, world.id, {
      fileName: input.fileName,
      sessionName: meta.sessionName,
      saveTime: meta.saveTime,
      build: meta.build,
      collected: result.collected,
      ...(result.resourceNodes ? { resourceNodes: result.resourceNodes } : {}),
    }, index, userId, now);
    dto.newlyChecked = out.newlyChecked;
    dto.conflicts = out.conflicts;
    events.push({ type: 'import', rev: out.rev });
  }

  if (snapshot) {
    try {
      const { summary, rev, thinned } = storeSnapshot(db, world.id, snapshot.s, snapshot.gz, userId, now);
      // An old save whose hour, day or week of the timeline has a newer one is thinned at once (retention).
      if (thinned.includes(summary.id)) note = 'thinned';
      else dto.snapshot = true;
      events.push({ type: 'snapshots', rev });
    } catch (err) {
      if (plan !== 'import' || !(err instanceof HttpError) || err.code !== 'limit_reached') throw err;
      note = err.code;
    }
  }
  if (note) dto.note = note;
  return { dto, events };
}
