import { openDb, type Db } from '../../src/server/db/db.js';
import { redactUrl } from '../../src/server/redact.js';
import { INVITE_TTL_MS, acceptInvite, consumeInvite, createInvite, findInvite, purgeInvites, revokeInvites } from '../../src/server/domain/invites.js';
import { isServerOwner } from '../../src/server/domain/users.js';
import { createWorld, getWorld } from '../../src/server/domain/worlds.js';
import { createUserForTest } from '../api/helpers.js';

const DAY = 86_400_000;
const T0 = 1_800_000_000_000;
const OWNERS = new Set(['o']);
const n = (db: Db, t: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;

function setup() {
  const db = openDb(':memory:');
  const owner = createUserForTest(db, 'o');
  const world = createWorld(db, owner, 'W', 'test', T0);
  const worldInvite = () => createInvite(db, { worldId: world.id, createdBy: owner, now: T0 }).token;
  const find = (token: string, now = T0) => findInvite(db, token, now, OWNERS);
  return { db, owner, world, worldInvite, find };
}

describe('invite tokens', () => {
  it('are random 43-character Base64url strings, valid for 7 days, stored only as a hash', () => {
    const { db, world, owner, find } = setup();
    const a = createInvite(db, { worldId: world.id, createdBy: owner, now: T0 });
    const b = createInvite(db, { worldId: world.id, createdBy: owner, now: T0 });
    expect(a.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a.token).not.toBe(b.token);
    expect(a.expiresAt).toBe(T0 + INVITE_TTL_MS);
    expect(INVITE_TTL_MS).toBe(7 * DAY);
    const rows = db.prepare('SELECT token_hash FROM invites').all() as { token_hash: Buffer }[];
    expect(rows.every(r => r.token_hash.length === 32 && !r.token_hash.toString('latin1').includes(a.token))).toBe(true);
    expect(find(a.token)).toMatchObject({ worldId: world.id, createdBy: owner, expiresAt: T0 + INVITE_TTL_MS });
  });
  it('expire after 7 days', () => {
    const { worldInvite, find } = setup();
    const t = worldInvite();
    expect(find(t, T0 + 7 * DAY - 1)).not.toBeNull();
    expect(find(t, T0 + 7 * DAY)).toBeNull();
  });
  it('rejects unknown, malformed and empty tokens', () => {
    const { worldInvite, find } = setup();
    const t = worldInvite();
    expect(find(`${t.slice(0, -1)}${t.endsWith('A') ? 'B' : 'A'}`)).toBeNull();
    expect(find(`${t}A`)).toBeNull();
    expect(find('garbage')).toBeNull();
    expect(find('')).toBeNull();
  });
  it('disappear with their world', () => {
    const { db, world, worldInvite, find } = setup();
    const t = worldInvite();
    db.prepare('DELETE FROM worlds WHERE id = ?').run(world.id);
    expect(find(t)).toBeNull();
    expect(n(db, 'invites')).toBe(0);
  });
  it('revokeInvites removes only the world\'s open links', () => {
    const { db, owner, world, worldInvite, find } = setup();
    const t = worldInvite();
    const general = createInvite(db, { worldId: null, createdBy: owner, now: T0 }).token;
    expect(revokeInvites(db, world.id)).toBe(1);
    expect(find(t)).toBeNull();
    expect(find(general)).not.toBeNull();
  });
  it('purgeInvites removes only expired rows', () => {
    const { db, worldInvite } = setup();
    worldInvite();
    expect(purgeInvites(db, T0 + 7 * DAY - 1)).toBe(0);
    expect(purgeInvites(db, T0 + 7 * DAY)).toBe(1);
    expect(n(db, 'invites')).toBe(0);
  });
  it('redactUrl hides invite tokens in path and query', () => {
    expect(redactUrl('/invite/abc.def.ghi')).toBe('/invite/[redacted]');
    expect(redactUrl('/invite/abc.def?x=1')).toBe('/invite/[redacted]?x=1');
    expect(redactUrl('/auth/login?invite=abc.def&returnTo=/')).toBe('/auth/login?invite=[redacted]&returnTo=/');
    expect(redactUrl('/auth/login?returnTo=/&invite=abc')).toBe('/auth/login?returnTo=/&invite=[redacted]');
    expect(redactUrl('/api/worlds')).toBe('/api/worlds');
  });
});

describe('acceptInvite', () => {
  it('joins a new user, uses the link up, bumps rev', () => {
    const { db, world, worldInvite, find } = setup();
    const u = createUserForTest(db, 'u');
    const t = worldInvite();
    const r = db.transaction(() => acceptInvite(db, u, find(t)!, T0))();
    expect(r).toEqual({ kind: 'joined', worldId: world.id });
    expect(n(db, 'invites')).toBe(0);
    expect(find(t)).toBeNull();
    expect(db.prepare('SELECT joined_via FROM world_members WHERE user_id = ?').get(u)).toEqual({ joined_via: 'invite' });
    expect(getWorld(db, world.id)!.rev).toBe(world.rev + 1);
  });
  it('owner and existing member get already; the link stays open', () => {
    const { db, owner, world, worldInvite, find } = setup();
    const m = createUserForTest(db, 'm');
    db.prepare("INSERT INTO world_members(world_id, user_id, joined_at, joined_via) VALUES (?, ?, 0, 'invite')").run(world.id, m);
    const inv = find(worldInvite())!;
    expect(db.transaction(() => acceptInvite(db, owner, inv, T0))()).toEqual({ kind: 'already', worldId: world.id });
    expect(db.transaction(() => acceptInvite(db, m, inv, T0))()).toEqual({ kind: 'already', worldId: world.id });
    expect(n(db, 'invites')).toBe(1);
    expect(getWorld(db, world.id)!.rev).toBe(world.rev);
  });
  it('a general invite joins no world', () => {
    const { db, owner, find } = setup();
    const inv = find(createInvite(db, { worldId: null, createdBy: owner, now: T0 }).token)!;
    expect(acceptInvite(db, createUserForTest(db, 'u'), inv, T0)).toEqual({ kind: 'invalid' });
    expect(n(db, 'invites')).toBe(1);
  });
  it('keeps the link when the members insert fails', () => {
    const { db, worldInvite, find } = setup();
    const u = createUserForTest(db, 'u');
    db.exec("CREATE TRIGGER boom BEFORE INSERT ON world_members BEGIN SELECT RAISE(ABORT, 'boom'); END");
    const t = worldInvite();
    expect(() => db.transaction(() => acceptInvite(db, u, find(t)!, T0))()).toThrow('boom');
    expect(find(t)).not.toBeNull();
  });
});

describe('general invites', () => {
  it('isServerOwner looks at the user\'s Discord identity', () => {
    const { db, owner } = setup();
    const other = createUserForTest(db, 'x');
    expect(isServerOwner(db, OWNERS, owner)).toBe(true);
    expect(isServerOwner(db, OWNERS, other)).toBe(false);
    expect(isServerOwner(db, new Set(), owner)).toBe(false);
  });
  it('work only while their creator is a server owner, and once', () => {
    const { db, owner } = setup();
    const t = createInvite(db, { worldId: null, createdBy: owner, now: T0 }).token;
    expect(findInvite(db, t, T0, new Set(['someone-else']))).toBeNull();
    const inv = findInvite(db, t, T0, OWNERS);
    expect(inv).toMatchObject({ worldId: null, createdBy: owner });
    consumeInvite(db, inv!);
    expect(findInvite(db, t, T0, OWNERS)).toBeNull();
  });
});
