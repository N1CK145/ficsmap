import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Config } from './config.js';
import type { Db } from './db/db.js';
import { purgeSessions } from './auth/session.js';
import { purgeInvites } from './domain/invites.js';
import { thinAllSnapshots } from './domain/snapshots.js';
import type { SseHub } from './sse/hub.js';

const BACKUP_RE = /^app-\d{8}\.db$/;
const HOUR_MS = 60 * 60 * 1000;

function backupName(now: Date): string {
  return `app-${now.toISOString().slice(0, 10).replaceAll('-', '')}.db`;
}

/** Writes a consistent copy of the database to `dir/app-YYYYMMDD.db` (UTC date) and prunes old backups. */
export function backupDb(db: Db, dir: string, now: Date, keep = 14): string {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, backupName(now));
  rmSync(file, { force: true }); // VACUUM INTO refuses an existing target
  db.prepare('VACUUM INTO ?').run(file);
  const backups = readdirSync(dir).filter(f => BACKUP_RE.test(f)).sort();
  for (const old of backups.slice(0, Math.max(0, backups.length - keep))) rmSync(join(dir, old), { force: true });
  return file;
}

/**
 * Purges expired sessions and invites, and thins every world's factory snapshots (the retention rule; open
 * timelines are told through the `snapshots` event). Returns how many of each went.
 */
export function runHourly(
  db: Db, now: number, hub?: Pick<SseHub, 'broadcast'>,
): { sessions: number; invites: number; snapshots: number } {
  const sessions = purgeSessions(db, now);
  const invites = purgeInvites(db, now);
  let snapshots = 0;
  for (const { worldId, rev, deleted } of thinAllSnapshots(db)) {
    snapshots += deleted;
    hub?.broadcast(worldId, { type: 'snapshots', rev });
  }
  return { sessions, invites, snapshots };
}

/** Runs the purge and thinning now and hourly, plus one backup per UTC day. Returns a function that stops it. */
export function startHousekeeping(db: Db, cfg: Config, hub?: Pick<SseHub, 'broadcast'>): () => void {
  const backupDir = cfg.dbPath === ':memory:' ? null : join(dirname(cfg.dbPath), 'backups');
  const tick = (): void => {
    const now = new Date();
    try {
      runHourly(db, now.getTime(), hub);
      if (backupDir && !existsSync(join(backupDir, backupName(now)))) backupDb(db, backupDir, now);
    } catch (err) {
      console.error('housekeeping failed', err); // never let a failed run take the server down
    }
  };
  tick();
  const timer = setInterval(tick, HOUR_MS);
  timer.unref();
  return () => clearInterval(timer);
}
