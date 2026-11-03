import { openDb } from '../../src/server/db/db.js';
import { findOrCreateUser } from '../../src/server/domain/users.js';
import type { DiscordProfile } from '../../src/server/auth/discord.js';

const profile = (over: Partial<DiscordProfile> = {}): DiscordProfile => ({
  id: '111', username: 'neo', globalName: 'Neo', avatar: 'abc', email: 'neo@example.test', verified: true, ...over,
});
const count = (db: ReturnType<typeof openDb>, t: string) =>
  (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;

describe('findOrCreateUser', () => {
  it('creates user and identity for an unknown owner id', () => {
    const db = openDb(':memory:');
    const r = findOrCreateUser(db, profile(), { ownerIds: new Set(['111']), allowCreate: false, now: 1000 });
    expect(r).toMatchObject({ kind: 'ok', created: true });
    expect(count(db, 'users')).toBe(1);
    expect(count(db, 'identities')).toBe(1);
    const u = db.prepare('SELECT * FROM users').get() as Record<string, unknown>;
    expect(u).toMatchObject({
      display_name: 'Neo', avatar_url: 'https://cdn.discordapp.com/avatars/111/abc.png?size=64',
      email: 'neo@example.test', email_verified: 1, created_at: 1000, last_login_at: 1000,
    });
  });
  it('falls back to username when there is no global name', () => {
    const db = openDb(':memory:');
    findOrCreateUser(db, profile({ globalName: null, avatar: null }), { ownerIds: new Set(['111']), allowCreate: false, now: 1 });
    expect(db.prepare('SELECT display_name, avatar_url FROM users').get()).toEqual({ display_name: 'neo', avatar_url: null });
  });
  it('refreshes a known identity and last_login_at', () => {
    const db = openDb(':memory:');
    const opts = { ownerIds: new Set<string>(), allowCreate: true, now: 1000 };
    const first = findOrCreateUser(db, profile(), opts);
    const r = findOrCreateUser(db, profile({ globalName: 'Trinity', avatar: 'xyz', email: 'new@example.test' }), { ...opts, allowCreate: false, now: 2000 });
    expect(r).toEqual({ kind: 'ok', userId: (first as { userId: number }).userId, created: false });
    expect(db.prepare('SELECT display_name, avatar_url, email, last_login_at FROM users').get()).toEqual({
      display_name: 'Trinity', avatar_url: 'https://cdn.discordapp.com/avatars/111/xyz.png?size=64',
      email: 'new@example.test', last_login_at: 2000,
    });
    expect(db.prepare('SELECT last_login_at FROM identities').get()).toEqual({ last_login_at: 2000 });
    expect(count(db, 'users')).toBe(1);
  });
  it('returns invite_only for an unknown non-owner and writes nothing', () => {
    const db = openDb(':memory:');
    const r = findOrCreateUser(db, profile(), { ownerIds: new Set(['999']), allowCreate: false, now: 1 });
    expect(r).toEqual({ kind: 'invite_only' });
    expect(count(db, 'users')).toBe(0);
    expect(count(db, 'identities')).toBe(0);
  });
  it('creates a non-owner when allowCreate is true', () => {
    const db = openDb(':memory:');
    expect(findOrCreateUser(db, profile(), { ownerIds: new Set(), allowCreate: true, now: 1 })).toMatchObject({ kind: 'ok', created: true });
  });
  it('stores a null email when not verified', () => {
    const db = openDb(':memory:');
    findOrCreateUser(db, profile({ verified: false }), { ownerIds: new Set(['111']), allowCreate: false, now: 1 });
    expect(db.prepare('SELECT email, email_verified FROM users').get()).toEqual({ email: null, email_verified: 0 });
    expect(db.prepare('SELECT email, email_verified FROM identities').get()).toEqual({ email: null, email_verified: 0 });
  });
});
