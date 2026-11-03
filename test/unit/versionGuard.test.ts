import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { openDb } from '../../src/server/db/db.js';
import { MIGRATIONS } from '../../src/server/db/migrations.js';
import {
  backupBeforeUpgrade, compareVersions, findRollbackBackup, performRollback, planRollback, readStoredVersion, startDecision,
  writeStoredVersion,
} from '../../src/server/version/guard.js';

const T = Date.UTC(2026, 10, 3, 12, 0, 0);

function stateDir() {
  const dir = mkdtempSync(join(tmpdir(), 'ficsmap-state-'));
  return { dir, db: join(dir, 'app.db'), backups: join(dir, 'backups') };
}

/** A real database at the current schema with one user named `name`. */
function seed(path: string, name: string) {
  const db = openDb(path);
  db.prepare('INSERT INTO users(display_name, created_at, last_login_at) VALUES (?, 0, 0)').run(name);
  db.close();
}

const userNames = (path: string) => {
  const db = new Database(path, { readonly: true });
  const names = (db.prepare('SELECT display_name FROM users ORDER BY id').all() as { display_name: string }[]).map(r => r.display_name);
  db.close();
  return names;
};

describe('compareVersions', () => {
  it('compares major, minor and patch numerically', () => {
    expect(compareVersions('0.1.0', '0.1.0')).toBe(0);
    expect(compareVersions('0.2.0', '0.10.0')).toBeLessThan(0);
    expect(compareVersions('1.0.0', '0.99.99')).toBeGreaterThan(0);
    expect(compareVersions('0.1.1', '0.1.0')).toBeGreaterThan(0);
  });

  it('rejects anything that is not X.Y.Z', () => {
    expect(() => compareVersions('0.1', '0.1.0')).toThrow();
    expect(() => compareVersions('v0.1.0', '0.1.0')).toThrow();
  });
});

describe('stored version', () => {
  it('is null before the first start and round-trips afterwards', () => {
    const s = stateDir();
    expect(readStoredVersion(s.dir)).toBeNull();
    writeStoredVersion(s.dir, '0.2.0', T);
    expect(readStoredVersion(s.dir)).toBe('0.2.0');
  });

  it('ignores a damaged file', () => {
    const s = stateDir();
    writeFileSync(join(s.dir, 'ficsmap-version.json'), '{nope');
    expect(readStoredVersion(s.dir)).toBeNull();
  });
});

describe('startDecision', () => {
  it('tells first start, same version, upgrade and downgrade apart', () => {
    expect(startDecision(null, '0.1.0')).toBe('first');
    expect(startDecision('0.1.0', '0.1.0')).toBe('same');
    expect(startDecision('0.1.0', '0.2.0')).toBe('upgrade');
    expect(startDecision('0.3.0', '0.2.0')).toBe('downgrade');
  });
});

describe('backupBeforeUpgrade', () => {
  it('copies the database to backups/pre-v<new>-from-v<old>-<time>.db', async () => {
    const s = stateDir();
    seed(s.db, 'Ada');
    const file = await backupBeforeUpgrade(s.db, s.backups, '0.1.0', '0.2.0', T);
    expect(file).toBe(join(s.backups, 'pre-v0.2.0-from-v0.1.0-20261103T120000Z.db'));
    expect(userNames(file!)).toEqual(['Ada']);
  });

  it('does nothing without a database', async () => {
    const s = stateDir();
    expect(await backupBeforeUpgrade(s.db, s.backups, '0.1.0', '0.2.0', T)).toBeNull();
    expect(existsSync(s.backups)).toBe(false);
  });
});

describe('findRollbackBackup', () => {
  const backups = (names: string[]) => {
    const s = stateDir();
    mkdirSync(s.backups);
    for (const n of names) writeFileSync(join(s.backups, n), '');
    return s.backups;
  };

  it('picks the backup taken when upgrading from at most the target past it, newest first', () => {
    const dir = backups([
      'pre-v0.2.0-from-v0.1.0-20261101T000000Z.db',
      'pre-v0.3.0-from-v0.2.0-20261102T000000Z.db',
      'pre-v0.3.0-from-v0.2.0-20261103T000000Z.db',
      'app-20261103.db',
      'pre-rollback-v0.3.0-to-v0.1.0-20261104T000000Z.db',
    ]);
    expect(findRollbackBackup(dir, '0.1.0')).toBe(join(dir, 'pre-v0.2.0-from-v0.1.0-20261101T000000Z.db'));
    expect(findRollbackBackup(dir, '0.2.0')).toBe(join(dir, 'pre-v0.3.0-from-v0.2.0-20261103T000000Z.db'));
    // 0.2.5 never ran: the newest upgrade that crossed it started from 0.2.0.
    expect(findRollbackBackup(dir, '0.2.5')).toBe(join(dir, 'pre-v0.3.0-from-v0.2.0-20261103T000000Z.db'));
  });

  it('is null when no upgrade crossed the target or there is no backup folder', () => {
    expect(findRollbackBackup(backups(['pre-v0.2.0-from-v0.1.0-20261101T000000Z.db']), '0.0.9')).toBeNull();
    expect(findRollbackBackup(join(stateDir().dir, 'missing'), '0.1.0')).toBeNull();
  });
});

describe('planRollback and performRollback', () => {
  it('restores the matching backup, keeps the newer database aside and records the old version', async () => {
    const s = stateDir();
    seed(s.db, 'Ada');
    await backupBeforeUpgrade(s.db, s.backups, '0.1.0', '0.2.0', T);
    const db = new Database(s.db);
    db.prepare("INSERT INTO users(display_name, created_at, last_login_at) VALUES ('Bob', 0, 0)").run();
    db.close();
    writeStoredVersion(s.dir, '0.2.0', T);

    const plan = planRollback({ dbPath: s.db, backupsDir: s.backups, current: '0.1.0', supportedSchema: MIGRATIONS.length });
    expect(plan.kind).toBe('restore');
    await performRollback({ dbPath: s.db, stateDir: s.dir, backupsDir: s.backups, from: '0.2.0', to: '0.1.0', plan, now: T + 1000 });

    expect(userNames(s.db)).toEqual(['Ada']);
    expect(readStoredVersion(s.dir)).toBe('0.1.0');
    const aside = readdirSync(s.backups).find(f => f.startsWith('pre-rollback-'));
    expect(aside).toBe('pre-rollback-v0.2.0-to-v0.1.0-20261103T120001Z.db');
    expect(userNames(join(s.backups, aside!))).toEqual(['Ada', 'Bob']);
  });

  it('continues without a restore when there is no backup but the schema is still supported', () => {
    const s = stateDir();
    seed(s.db, 'Ada');
    expect(planRollback({ dbPath: s.db, backupsDir: s.backups, current: '0.1.0', supportedSchema: MIGRATIONS.length }))
      .toEqual({ kind: 'continue' });
  });

  it('is blocked when there is no backup and the schema is newer than this version supports', () => {
    const s = stateDir();
    seed(s.db, 'Ada');
    const plan = planRollback({ dbPath: s.db, backupsDir: s.backups, current: '0.1.0', supportedSchema: MIGRATIONS.length - 1 });
    expect(plan.kind).toBe('blocked');
  });

  it('a continue plan only records the old version', async () => {
    const s = stateDir();
    seed(s.db, 'Ada');
    writeStoredVersion(s.dir, '0.2.0', T);
    await performRollback({ dbPath: s.db, stateDir: s.dir, backupsDir: s.backups, from: '0.2.0', to: '0.1.0', plan: { kind: 'continue' }, now: T });
    expect(userNames(s.db)).toEqual(['Ada']);
    expect(readStoredVersion(s.dir)).toBe('0.1.0');
  });
});
