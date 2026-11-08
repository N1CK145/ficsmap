import type { FactorySnapshot, SnapshotSummary } from './snapshot.js';

/**
 * How factory snapshots are stored and moved (server: `src/server/domain/snapshots.ts`, client:
 * `src/web/features/factory/api.ts`). Shared, so both sides check the same limits.
 */

/** Largest upload: the gzip-compressed JSON body of `POST /api/worlds/:id/snapshots`. */
export const MAX_SNAPSHOT_GZIP_BYTES = 4 * 2 ** 20;
/** Largest snapshot JSON after decompression (guards against gzip bombs). */
export const MAX_SNAPSHOT_JSON_BYTES = 32 * 2 ** 20;
/** Snapshots one world may hold; the owner deletes old ones to add more. */
export const MAX_SNAPSHOTS_PER_WORLD = 500;
/** A machine below this productivity (0..1) counts as standing still. */
export const IDLE_PRODUCTIVITY = 0.01;

/** The figures of a snapshot's timeline entry that come from the snapshot itself. */
export type SnapshotFigures = Pick<SnapshotSummary, 'buildings' | 'machines' | 'avgProductivity' | 'idle'>;

/**
 * Buildings (with an actor of their own, not the lightweight parts), machines (buildings with a production
 * measurement), their mean productivity (over the machines that report one, each clamped to 0..1; null without any)
 * and the idle ones (productivity below 1 %).
 */
export function snapshotFigures(s: Pick<FactorySnapshot, 'buildings'>): SnapshotFigures {
  let machines = 0;
  let measured = 0;
  let sum = 0;
  let idle = 0;
  for (const b of s.buildings) {
    if (!b.prod) continue;
    machines++;
    if (b.prod.productivity === undefined) continue;
    const p = Math.min(1, Math.max(0, b.prod.productivity));
    measured++;
    sum += p;
    if (p < IDLE_PRODUCTIVITY) idle++;
  }
  return { buildings: s.buildings.length, machines, avgProductivity: measured > 0 ? sum / measured : null, idle };
}

/** The same save: a snapshot is identified by its session name and save time (the server replaces it on re-import). */
export function sameSave(a: { sessionName: string; saveTime: number }, b: { sessionName: string; saveTime: number }): boolean {
  return a.sessionName === b.sessionName && Math.trunc(a.saveTime) === Math.trunc(b.saveTime);
}
