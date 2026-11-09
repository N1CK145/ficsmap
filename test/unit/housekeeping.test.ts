import { mkdtempSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../../src/server/db/db.js';
import { createSession } from '../../src/server/auth/session.js';
import { backupDb, runHourly, startHousekeeping } from '../../src/server/housekeeping.js';
import { testConfig } from '../api/helpers.js';

describe('backupDb', () => {
  it('keeps the newest 14 files, today included, and ignores other files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bk-'));
    for (let d = 1; d <= 15; d++) writeFileSync(join(dir, `app-202610${String(d).padStart(2, '0')}.db`), 'x');
    writeFileSync(join(dir, 'notes.txt'), 'keep me');
    const db = openDb(':memory:');
    const file = backupDb(db, dir, new Date(Date.UTC(2026, 10, 3, 23, 59)));
    expect(file).toBe(join(dir, 'app-20261103.db'));
    const files = readdirSync(dir).filter(f => /^app-\d{8}\.db$/.test(f)).sort();
    expect(files).toHaveLength(14);
    expect(files.at(-1)).toBe('app-20261103.db');
    expect(files).not.toContain('app-20261001.db');
    expect(files).not.toContain('app-20261002.db');
    expect(readdirSync(dir)).toContain('notes.txt');
  });
  it('overwrites a same-day backup with a valid database copy', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bk-'));
    const db = openDb(':memory:');
    const now = new Date(Date.UTC(2026, 10, 3, 1));
    backupDb(db, dir, now);
    db.prepare("INSERT INTO users(display_name, created_at, last_login_at) VALUES ('a',0,0)").run();
    const file = backupDb(db, dir, now);
    const copy = openDb(file);
    expect((copy.prepare('SELECT count(*) AS n FROM users').get() as { n: number }).n).toBe(1);
    copy.close();
  });
});

describe('runHourly', () => {
  it('purges expired sessions and invites, keeps valid ones', () => {
    const db = openDb(':memory:');
    db.prepare("INSERT INTO users(id, display_name, created_at, last_login_at) VALUES (1,'a',0,0)").run();
    db.prepare("INSERT INTO worlds(id, name, owner_id, dataset_version, created_at) VALUES (?, 'w', 1, 'v', 0)")
      .run('00000000-0000-4000-8000-000000000000');
    createSession(db, 1, 0); // expires long before `now`
    createSession(db, 1, 10_000_000_000_000);
    const ins = db.prepare("INSERT INTO invites(token_hash, world_id, created_by, created_at, expires_at) VALUES (?, ?, 1, 0, ?)");
    ins.run(Buffer.from('old'), '00000000-0000-4000-8000-000000000000', 1000);
    ins.run(Buffer.from('new'), '00000000-0000-4000-8000-000000000000', 10_000_000_000_000);
    const res = runHourly(db, 5_000_000_000_000);
    expect(res).toEqual({ sessions: 1, invites: 1, snapshots: 0 });
    expect((db.prepare('SELECT count(*) AS n FROM sessions').get() as { n: number }).n).toBe(1);
    expect((db.prepare('SELECT count(*) AS n FROM invites').get() as { n: number }).n).toBe(1);
  });
});

describe('runHourly: snapshot thinning', () => {
  it('thins the snapshots of every world and tells each world that lost some', () => {
    const db = openDb(':memory:');
    db.prepare("INSERT INTO users(id, display_name, created_at, last_login_at) VALUES (1,'a',0,0)").run();
    const W1 = '00000000-0000-4000-8000-000000000001';
    const W2 = '00000000-0000-4000-8000-000000000002';
    for (const id of [W1, W2]) db.prepare("INSERT INTO worlds(id, name, owner_id, dataset_version, created_at) VALUES (?, 'w', 1, 'v', 0)").run(id);
    const ins = db.prepare(
      `INSERT INTO factory_snapshots(world_id, session_name, save_time, imported_at, imported_by, data, summary, bytes)
       VALUES (?, 'S', ?, 0, NULL, x'00', '{}', 1)`,
    );
    const T = Date.UTC(2026, 10, 8, 12, 30);
    const DAY = 86_400_000;
    // W1: snapshots stored before thinning existed, three in one hour 40 days back (one per day there): two go.
    for (const t of [T, T - 40 * DAY, T - 40 * DAY - 60_000, T - 40 * DAY - 2 * 60_000]) ins.run(W1, t);
    // W2: nothing to thin.
    for (const t of [T, T - 40 * DAY]) ins.run(W2, t);
    const events: [string, unknown][] = [];
    const res = runHourly(db, 0, { broadcast: (id, e) => events.push([id, e]) });
    expect(res.snapshots).toBe(2);
    expect(events).toEqual([[W1, { type: 'snapshots', rev: 1 }]]);
    const left = db.prepare('SELECT world_id, save_time FROM factory_snapshots ORDER BY world_id, save_time DESC').all();
    expect(left).toEqual([
      { world_id: W1, save_time: T }, { world_id: W1, save_time: T - 40 * DAY },
      { world_id: W2, save_time: T }, { world_id: W2, save_time: T - 40 * DAY },
    ]);
    // A second run finds nothing.
    expect(runHourly(db, 0).snapshots).toBe(0);
  });
});

describe('startHousekeeping', () => {
  it('purges and backs up at start, and stop() is callable', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hk-'));
    const dbPath = join(dir, 'app.db');
    const db = openDb(dbPath);
    const stop = startHousekeeping(db, { ...testConfig, dbPath });
    const today = new Date().toISOString().slice(0, 10).replaceAll('-', '');
    expect(existsSync(join(dir, 'backups', `app-${today}.db`))).toBe(true);
    stop();
    db.close();
  });
  it('skips backups for an in-memory database', () => {
    const db = openDb(':memory:');
    const stop = startHousekeeping(db, testConfig);
    stop();
    expect(existsSync(join(process.cwd(), 'backups'))).toBe(false);
  });
});
