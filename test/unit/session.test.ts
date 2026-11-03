import { createHash } from 'node:crypto';
import { openDb } from '../../src/server/db/db.js';
import { createSession, sessionUser, deleteSession, purgeSessions, SESSION_TTL_MS } from '../../src/server/auth/session.js';

function setup() {
  const db = openDb(':memory:');
  db.prepare("INSERT INTO users(id, display_name, created_at, last_login_at) VALUES (1,'a',0,0)").run();
  return db;
}

describe('sessions', () => {
  it('issues a 43-char token and stores only its hash', () => {
    const db = setup();
    const t = createSession(db, 1, 1000);
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const row = db.prepare('SELECT id_hash, expires_at FROM sessions').get() as { id_hash: Buffer; expires_at: number };
    expect(row.id_hash.equals(createHash('sha256').update(t).digest())).toBe(true);
    expect(row.id_hash.toString('utf8')).not.toContain(t);
    expect(row.expires_at).toBe(1000 + SESSION_TTL_MS);
  });
  it('resolves the user while valid, null when expired or unknown', () => {
    const db = setup();
    const t = createSession(db, 1, 1000);
    expect(sessionUser(db, t, 2000)?.id).toBe(1);
    expect(sessionUser(db, t, 1000 + SESSION_TTL_MS)).toBeNull();
    expect(sessionUser(db, 'nope', 2000)).toBeNull();
  });
  it('deleteSession removes it', () => {
    const db = setup();
    const t = createSession(db, 1, 1000);
    deleteSession(db, t);
    expect(sessionUser(db, t, 2000)).toBeNull();
  });
  it('purgeSessions removes only expired ones', () => {
    const db = setup();
    const old = createSession(db, 1, 0);
    const fresh = createSession(db, 1, SESSION_TTL_MS);
    expect(purgeSessions(db, SESSION_TTL_MS + 1)).toBe(1);
    expect(sessionUser(db, old, 1)).toBeNull();
    expect(sessionUser(db, fresh, SESSION_TTL_MS + 1)?.id).toBe(1);
  });
});
