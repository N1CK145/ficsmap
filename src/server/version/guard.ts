import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { compareVersions, isVersion } from '../../shared/version.js';

/*
 * Version guard: the version of the last start is kept next to the database. An upgrade backs the
 * database up before migrations run; a downgrade (an older image started on newer data) must be
 * confirmed and then restores the backup taken before the upgrade past the running version.
 */

const VERSION_FILE = 'ficsmap-version.json';
const UPGRADE_BACKUP = /^pre-v(\d+\.\d+\.\d+)-from-v(\d+\.\d+\.\d+)-(\d{8}T\d{6}Z)\.db$/;

export { compareVersions };

/** "20261103T120000Z" */
export function stamp(now: number): string {
  return new Date(now).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

export function readStoredVersion(stateDir: string): string | null {
  try {
    const v = (JSON.parse(readFileSync(join(stateDir, VERSION_FILE), 'utf8')) as { version?: unknown }).version;
    return typeof v === 'string' && isVersion(v) ? v : null;
  } catch {
    return null;
  }
}

/** Written atomically (temp file + rename), so a crash never leaves half a file. */
export function writeStoredVersion(stateDir: string, version: string, now: number): void {
  mkdirSync(stateDir, { recursive: true });
  const tmp = join(stateDir, `${VERSION_FILE}.tmp`);
  writeFileSync(tmp, `${JSON.stringify({ version, startedAt: new Date(now).toISOString() })}\n`);
  renameSync(tmp, join(stateDir, VERSION_FILE));
}

export type StartDecision = 'first' | 'same' | 'upgrade' | 'downgrade';

export function startDecision(stored: string | null, current: string): StartDecision {
  if (stored === null) return 'first';
  const c = compareVersions(stored, current);
  return c === 0 ? 'same' : c < 0 ? 'upgrade' : 'downgrade';
}

/** A consistent copy of `dbPath` (WAL included) at `target`. */
async function copyDb(dbPath: string, target: string): Promise<void> {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    await db.backup(target);
  } finally {
    db.close();
  }
}

/** Before migrations of a newer version: backups/pre-v<to>-from-v<from>-<time>.db; null without a database. */
export async function backupBeforeUpgrade(dbPath: string, backupsDir: string, from: string, to: string, now: number): Promise<string | null> {
  if (!existsSync(dbPath)) return null;
  mkdirSync(backupsDir, { recursive: true });
  const file = join(backupsDir, `pre-v${to}-from-v${from}-${stamp(now)}.db`);
  await copyDb(dbPath, file);
  return file;
}

/**
 * The backup to restore when going back to `target`: taken by an upgrade that started at or below
 * `target` and went past it; the newest such one. Null when there is none.
 */
export function findRollbackBackup(backupsDir: string, target: string): string | null {
  if (!existsSync(backupsDir)) return null;
  let best: { file: string; at: string } | null = null;
  for (const file of readdirSync(backupsDir)) {
    const m = UPGRADE_BACKUP.exec(file);
    if (!m) continue;
    const [, to, from, at] = m as unknown as [string, string, string, string];
    if (compareVersions(from, target) > 0 || compareVersions(to, target) <= 0) continue;
    if (!best || at > best.at) best = { file, at };
  }
  return best ? join(backupsDir, best.file) : null;
}

/** The database's schema version (SQLite user_version), 0 without a database. */
export function schemaVersion(dbPath: string): number {
  if (!existsSync(dbPath)) return 0;
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    return db.pragma('user_version', { simple: true }) as number;
  } finally {
    db.close();
  }
}

export type RollbackPlan =
  | { kind: 'restore'; backup: string }
  /** No backup, but this version can still use the database as it is. */
  | { kind: 'continue' }
  /** No backup and the schema is newer than this version knows. */
  | { kind: 'blocked'; schema: number; supported: number };

export function planRollback(o: { dbPath: string; backupsDir: string; current: string; supportedSchema: number }): RollbackPlan {
  const backup = findRollbackBackup(o.backupsDir, o.current);
  if (backup) return { kind: 'restore', backup };
  const schema = schemaVersion(o.dbPath);
  return schema <= o.supportedSchema ? { kind: 'continue' } : { kind: 'blocked', schema, supported: o.supportedSchema };
}

/**
 * Carries out a confirmed rollback from `from` to `to`. A restore first keeps the current database as
 * backups/pre-rollback-v<from>-to-v<to>-<time>.db. Afterwards the stored version is `to`.
 */
export async function performRollback(o: {
  dbPath: string; stateDir: string; backupsDir: string; from: string; to: string; plan: RollbackPlan; now: number;
}): Promise<void> {
  if (o.plan.kind === 'blocked') throw new Error('This rollback is blocked: no backup and the database schema is too new');
  if (o.plan.kind === 'restore') {
    mkdirSync(o.backupsDir, { recursive: true });
    if (existsSync(o.dbPath)) await copyDb(o.dbPath, join(o.backupsDir, `pre-rollback-v${o.from}-to-v${o.to}-${stamp(o.now)}.db`));
    for (const suffix of ['-wal', '-shm']) rmSync(`${o.dbPath}${suffix}`, { force: true });
    const tmp = `${o.dbPath}.restore`;
    copyFileSync(o.plan.backup, tmp);
    renameSync(tmp, o.dbPath);
  }
  writeStoredVersion(o.stateDir, o.to, o.now);
}
