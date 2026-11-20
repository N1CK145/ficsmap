import type { FactorySnapshot, SnapshotSummary, SummaryDeathCrate } from './snapshot.js';

/**
 * How factory snapshots are stored and moved (server: `src/server/domain/snapshots.ts`, client:
 * `src/web/features/factory/api.ts`). Shared, so both sides check the same limits.
 */

/** Largest upload: the gzip-compressed JSON body of `POST /api/worlds/:id/snapshots`. */
export const MAX_SNAPSHOT_GZIP_BYTES = 4 * 2 ** 20;
/** Largest snapshot JSON after decompression (guards against gzip bombs). */
export const MAX_SNAPSHOT_JSON_BYTES = 32 * 2 ** 20;
/**
 * Snapshots one world may hold: a safety net, the thinning of old snapshots (`retention.ts`) keeps a world far below
 * it (30 saves a day for a year leave about 800 to 1,100). The owner deletes old ones to add more.
 */
export const MAX_SNAPSHOTS_PER_WORLD = 2000;
/** A machine below this productivity (0..1) counts as standing still. */
export const IDLE_PRODUCTIVITY = 0.01;

/** The figures of a snapshot's timeline entry that come from the snapshot itself. */
export type SnapshotFigures = Pick<SnapshotSummary, 'buildings' | 'machines' | 'avgProductivity' | 'idle' | 'deathCrates'>;

/** Crate type of a crate a player left when dying (`EFGCrateType::CT_DeathCrate`, game header `FGCrate.h`). */
export const DEATH_CRATE = 'CT_DeathCrate';

/** The save's death crates with their positions, by id. */
export function deathCrates(s: Pick<FactorySnapshot, 'crates'>): SummaryDeathCrate[] {
  return s.crates.filter(c => c.kind === DEATH_CRATE && c.id)
    .map((c): SummaryDeathCrate => [c.id!, c.x, c.y, c.z])
    .sort((a, b) => a[0].localeCompare(b[0]));
}

/** One death crate over the world's saves: where it lay, and the first and last save (unix ms) it was in. */
export interface DeathCrateSeen { id: string; x: number; y: number; z: number; firstSeen: number; lastSeen: number }

/**
 * Every death crate in the world's saves up to and including the one at `until` (unix ms), each once, oldest first.
 * A crate whose `lastSeen` is before `until` is gone in that save (looted, or the game removed it).
 */
export function deathCrateHistory(list: readonly Pick<SnapshotSummary, 'saveTime' | 'deathCrates'>[], until: number): DeathCrateSeen[] {
  const seen = new Map<string, DeathCrateSeen>();
  for (const s of [...list].sort((a, b) => a.saveTime - b.saveTime)) {
    if (s.saveTime > until) continue;
    for (const [id, x, y, z] of s.deathCrates ?? []) {
      const c = seen.get(id);
      if (c) { c.lastSeen = s.saveTime; continue; }
      seen.set(id, { id, x, y, z, firstSeen: s.saveTime, lastSeen: s.saveTime });
    }
  }
  return [...seen.values()];
}

/**
 * Deaths up to and including the save at `until` (unix ms): the distinct death crates over the world's snapshots
 * that recorded them. A lower bound: the game keeps no death count, and a crate emptied between two saves is never seen.
 * `known` is false when a snapshot up to then has no record (stored before crates were recorded).
 */
export function countDeaths(list: readonly Pick<SnapshotSummary, 'saveTime' | 'deathCrates'>[], until: number): { deaths: number; known: boolean } {
  const ids = new Set<string>();
  let known = true;
  for (const s of list) {
    if (s.saveTime > until) continue;
    if (!s.deathCrates) { known = false; continue; }
    for (const [id] of s.deathCrates) ids.add(id);
  }
  return { deaths: ids.size, known };
}

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
