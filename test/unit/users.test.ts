import { openDb } from '../../src/server/db/db.js';
import { findOrCreateUser, linkIdentity, listIdentities, unlinkIdentity, type LoginProfile } from '../../src/server/domain/users.js';
import { discordLoginProfile, type DiscordProfile } from '../../src/server/auth/discord.js';

const profile = (over: Partial<DiscordProfile> = {}): LoginProfile => discordLoginProfile({
  id: '111', username: 'neo', globalName: 'Neo', avatar: 'abc', email: 'neo@example.test', verified: true, ...over,
});
const owners = (...discord: string[]) => ({ ownerDiscordIds: new Set(discord), ownerSteamIds: new Set(['76561197960287930']) });
const steam = (over: Partial<LoginProfile> = {}): LoginProfile => ({
  provider: 'steam', subject: '76561197960287930', username: null, displayName: null, avatarUrl: null, ...over,
});
const count = (db: ReturnType<typeof openDb>, t: string) =>
  (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;

describe('findOrCreateUser', () => {
  it('creates user and identity for an unknown owner id', () => {
    const db = openDb(':memory:');
    const r = findOrCreateUser(db, profile(), { owners: owners('111'), allowCreate: false, now: 1000 });
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
    findOrCreateUser(db, profile({ globalName: null, avatar: null }), { owners: owners('111'), allowCreate: false, now: 1 });
    expect(db.prepare('SELECT display_name, avatar_url FROM users').get()).toEqual({ display_name: 'neo', avatar_url: null });
  });
  it('refreshes a known identity and last_login_at', () => {
    const db = openDb(':memory:');
    const opts = { owners: owners(), allowCreate: true, now: 1000 };
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
    const r = findOrCreateUser(db, profile(), { owners: owners('999'), allowCreate: false, now: 1 });
    expect(r).toEqual({ kind: 'invite_only' });
    expect(count(db, 'users')).toBe(0);
    expect(count(db, 'identities')).toBe(0);
  });
  it('creates a non-owner when allowCreate is true', () => {
    const db = openDb(':memory:');
    expect(findOrCreateUser(db, profile(), { owners: owners(), allowCreate: true, now: 1 })).toMatchObject({ kind: 'ok', created: true });
  });
  it('stores a null email when not verified', () => {
    const db = openDb(':memory:');
    findOrCreateUser(db, profile({ verified: false }), { owners: owners('111'), allowCreate: false, now: 1 });
    expect(db.prepare('SELECT email, email_verified FROM users').get()).toEqual({ email: null, email_verified: 0 });
    expect(db.prepare('SELECT email, email_verified FROM identities').get()).toEqual({ email: null, email_verified: 0 });
  });

  it('creates a Steam owner named after the SteamID when the Web API gave no name, and keeps names later', () => {
    const db = openDb(':memory:');
    const r = findOrCreateUser(db, steam(), { owners: owners(), allowCreate: false, now: 1 });
    expect(r).toMatchObject({ kind: 'ok', created: true });
    expect(db.prepare('SELECT display_name, avatar_url, email FROM users').get()).toEqual({ display_name: '76561197960287930', avatar_url: null, email: null });
    const id = (r as { userId: number }).userId;
    findOrCreateUser(db, steam({ username: 'Pioneer', displayName: 'Pioneer', avatarUrl: 'https://a.test/p.jpg' }), { owners: owners(), allowCreate: false, now: 2 });
    expect(db.prepare('SELECT display_name, avatar_url FROM users').get()).toEqual({ display_name: 'Pioneer', avatar_url: 'https://a.test/p.jpg' });
    // Without a name (key removed) the account keeps its name and the identity its username.
    findOrCreateUser(db, steam(), { owners: owners(), allowCreate: false, now: 3 });
    expect(db.prepare('SELECT display_name, last_login_at FROM users').get()).toEqual({ display_name: 'Pioneer', last_login_at: 3 });
    expect(listIdentities(db, id)).toEqual([{ provider: 'steam', subject: '76561197960287930', name: 'Pioneer' }]);
  });
  it('a Steam id on the Discord owner list does not let it in', () => {
    const db = openDb(':memory:');
    const r = findOrCreateUser(db, steam({ subject: '76561197960287931' }), { owners: owners('76561197960287931'), allowCreate: false, now: 1 });
    expect(r).toEqual({ kind: 'invite_only' });
  });
  it('links a second provider to an account, once, and never one that belongs to someone else', () => {
    const db = openDb(':memory:');
    const a = (findOrCreateUser(db, profile(), { owners: owners('111'), allowCreate: false, now: 1 }) as { userId: number }).userId;
    const b = (findOrCreateUser(db, profile({ id: '222' }), { owners: owners('222'), allowCreate: false, now: 1 }) as { userId: number }).userId;
    expect(linkIdentity(db, a, steam(), 5)).toBe('linked');
    expect(linkIdentity(db, a, steam(), 6)).toBe('already');
    expect(linkIdentity(db, b, steam(), 7)).toBe('taken');
    expect(linkIdentity(db, a, steam({ subject: '76561197960287931' }), 8)).toBe('provider_taken');
    // Signing in with Steam now opens the Discord account; its name stays.
    expect(findOrCreateUser(db, steam(), { owners: owners(), allowCreate: false, now: 9 })).toEqual({ kind: 'ok', userId: a, created: false });
    expect(db.prepare('SELECT display_name FROM users WHERE id = ?').get(a)).toEqual({ display_name: 'Neo' });
    expect(listIdentities(db, a).map(i => i.provider)).toEqual(['discord', 'steam']);
  });
  it('unlinks a provider but never the last way in', () => {
    const db = openDb(':memory:');
    const a = (findOrCreateUser(db, profile(), { owners: owners('111'), allowCreate: false, now: 1 }) as { userId: number }).userId;
    expect(unlinkIdentity(db, a, 'steam')).toBe('none');
    expect(unlinkIdentity(db, a, 'discord')).toBe('last');
    linkIdentity(db, a, steam(), 2);
    expect(unlinkIdentity(db, a, 'discord')).toBe('ok');
    expect(listIdentities(db, a).map(i => i.provider)).toEqual(['steam']);
    expect(unlinkIdentity(db, a, 'steam')).toBe('last');
  });
});
