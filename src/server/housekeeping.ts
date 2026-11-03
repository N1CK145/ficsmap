import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Config } from './config.js';
import type { Db } from './db/db.js';
import { purgeSessions } from './auth/session.js';
import { purgeInviteUses } from './domain/invites.js';

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

export function runHourly(db: Db, now: number): { sessions: number; invites: number } {
  return { sessions: purgeSessions(db, now), invites: purgeInviteUses(db, now) };
}

/** Runs the purge now and hourly, plus one backup per UTC day. Returns a function that stops it. */
export function startHousekeeping(db: Db, cfg: Config): () => void {
  const backupDir = cfg.dbPath === ':memory:' ? null : join(dirname(cfg.dbPath), 'backups');
  const tick = (): void => {
    const now = new Date();
    try {
      runHourly(db, now.getTime());
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
