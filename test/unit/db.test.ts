import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { openDb } from '../../src/server/db/db.js';
import { migrate, MIGRATIONS } from '../../src/server/db/migrations.js';

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

  it('migration 3 adds the resource node extractors to a database at version 2 and drops them with their world', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ficsmap-db-'));
    const raw = new Database(join(dir, 'app.db'));
    raw.pragma('foreign_keys = ON');
    for (let i = 0; i < 2; i++) raw.exec(MIGRATIONS[i]!);
    raw.pragma('user_version = 2');
    raw.prepare("INSERT INTO users(id, display_name, created_at, last_login_at) VALUES (1,'a',0,0)").run();
    const id = 'w'.repeat(36);
    raw.prepare("INSERT INTO worlds(id, name, owner_id, dataset_version, created_at) VALUES (?, 'w', 1, 'v', 0)").run(id);
    migrate(raw);
    expect(raw.pragma('user_version', { simple: true })).toBe(MIGRATIONS.length);
    const ins = raw.prepare('INSERT INTO resource_node_extractors(world_id, node, seq, kind, clock, shards) VALUES (?, ?, ?, ?, ?, ?)');
    ins.run(id, 'BP_ResourceNode1', 0, 'miner2', 2.25, 3);
    ins.run(id, 'BP_ResourceNode1', 1, 'portable', null, null);
    expect(() => ins.run(id, 'BP_ResourceNode1', 1, 'portable', null, null)).toThrow(/UNIQUE/);
    raw.prepare('DELETE FROM worlds WHERE id = ?').run(id);
    expect(raw.prepare('SELECT count(*) AS n FROM resource_node_extractors').get()).toEqual({ n: 0 });
    raw.close();
  });
});
