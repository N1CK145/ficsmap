import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { openDb } from '../../src/server/db/db.js';
import { MIGRATIONS } from '../../src/server/db/migrations.js';

describe('openDb', () => {
  it('migrates to the latest user_version', () => {
    const db = openDb(':memory:');
    expect(db.pragma('user_version', { simple: true })).toBe(MIGRATIONS.length);
  });
  it('refuses a database whose schema is newer than this version knows', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ficsmap-db-'));
    const path = join(dir, 'app.db');
    openDb(path).close();
    const raw = new Database(path);
    raw.pragma(`user_version = ${MIGRATIONS.length + 1}`);
    raw.close();
    expect(() => openDb(path)).toThrow(/newer than this version supports/);
  });

  it('creates a missing parent directory (fresh dev checkout: ./data-local)', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'db-')), 'data-local', 'nested', 'app.db');
    const db = openDb(path);
    expect(existsSync(path)).toBe(true);
    db.close();
  });
  it('enables foreign keys', () => {
    expect(openDb(':memory:').pragma('foreign_keys', { simple: true })).toBe(1);
  });
  it('rejects a world id that is not 36 chars', () => {
    const db = openDb(':memory:');
    db.prepare("INSERT INTO users(id, display_name, created_at, last_login_at) VALUES (1,'a',0,0)").run();
    const ins = db.prepare("INSERT INTO worlds(id, name, owner_id, dataset_version, created_at) VALUES (?, 'w', 1, 'v', 0)");
    expect(() => ins.run('x'.repeat(35))).toThrow(/CHECK/);
    expect(() => ins.run('x'.repeat(36))).not.toThrow();
  });
});
