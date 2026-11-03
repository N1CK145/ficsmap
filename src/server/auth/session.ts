import { createHash, randomBytes } from 'node:crypto';
import type { Db } from '../db/db.js';
import type { UserRow } from '../domain/users.js';

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const hash = (token: string): Buffer => createHash('sha256').update(token).digest();

export function createSession(db: Db, userId: number, now: number): string {
  const token = randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO sessions(id_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .run(hash(token), userId, now, now + SESSION_TTL_MS);
  return token;
}

export function sessionUser(db: Db, token: string, now: number): UserRow | null {
  const row = db.prepare(
    `SELECT u.id, u.display_name, u.avatar_url, u.email, u.email_verified
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id_hash = ? AND s.expires_at > ?`,
  ).get(hash(token), now) as UserRow | undefined;
  return row ?? null;
}

export function deleteSession(db: Db, token: string): void {
  db.prepare('DELETE FROM sessions WHERE id_hash = ?').run(hash(token));
}

export function purgeSessions(db: Db, now: number): number {
  return db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now).changes;
}
