import { SignJWT } from 'jose';
import { openDb, type Db } from '../../src/server/db/db.js';
import { redactUrl } from '../../src/server/redact.js';
import { INVITE_CLOCK_TOLERANCE_S, acceptInvite, createInviteService, decodeInviteToken, encodeInviteToken, purgeInviteUses, revokeInvites, type InviteClaims } from '../../src/server/domain/invites.js';
import { createWorld, getWorld } from '../../src/server/domain/worlds.js';
import { createUserForTest } from '../api/helpers.js';

const SECRET = 'i'.repeat(32);
const ISS = 'https://ficsmap.test';
const DAY = 86_400_000;
const T0 = 1_800_000_000_000;
const n = (db: Db, t: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;

function setup(now = T0) {
  const db = openDb(':memory:');
  const owner = createUserForTest(db, 'o');
  const world = createWorld(db, owner, 'W', 'test', now);
  const svc = createInviteService({ secret: SECRET, issuer: ISS, now: () => now });
  return { db, owner, world, svc };
}

async function claimsFor(svc: ReturnType<typeof setup>['svc'], worldId: string, ep = 0): Promise<InviteClaims> {
  const { token } = await svc.sign(worldId, ep);
  const c = await svc.verify(token);
  if (!c) throw new Error('verify failed');
  return c;
}

describe('invite service', () => {
  it('signs a token that verifies and expires in 7 days', async () => {
    const { svc, world } = setup();
    const { token, expiresAt } = await svc.sign(world.id, 3);
    expect(expiresAt).toBe(Math.floor(T0 / 1000) * 1000 + 7 * DAY);
    const c = await svc.verify(token);
    expect(c).toMatchObject({ worldId: world.id, ep: 3, exp: expiresAt / 1000 });
    expect(c!.jti.length).toBeGreaterThanOrEqual(22);
  });
  it('gives each token a fresh jti', async () => {
    const { svc, world } = setup();
    const a = await claimsFor(svc, world.id), b = await claimsFor(svc, world.id);
    expect(a.jti).not.toBe(b.jti);
  });
  it('rejects an expired token (+8 d)', async () => {
    const { svc, world } = setup();
    const { token } = await svc.sign(world.id, 0);
    const later = createInviteService({ secret: SECRET, issuer: ISS, now: () => T0 + 8 * DAY });
    expect(await later.verify(token)).toBeNull();
  });
  const forge = async (o: { aud?: string; iss?: string; alg?: string; secret?: string; sub?: string; ep?: unknown }) => {
    const { world } = setup();
    return encodeInviteToken(await new SignJWT({ ep: o.ep ?? 0 })
      .setProtectedHeader({ alg: o.alg ?? 'HS256' })
      .setSubject(o.sub ?? world.id).setJti('abcdefghijklmnopqrstuv')
      .setIssuedAt(Math.floor(T0 / 1000)).setExpirationTime(Math.floor(T0 / 1000) + 3600)
      .setIssuer(o.iss ?? ISS).setAudience(o.aud ?? 'ficsmap:invite')
      .sign(new TextEncoder().encode(o.secret ?? SECRET)));
  };
  it('issues the JWT Base64url-encoded once more, and rejects the bare JWT', async () => {
    const { svc, world } = setup();
    const { token } = await svc.sign(world.id, 0);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    const jwt = decodeInviteToken(token);
    expect(jwt?.split('.')).toHaveLength(3);
    expect(await svc.verify(token)).not.toBeNull();
    expect(await svc.verify(jwt!)).toBeNull();
  });
  it('rejects tokens that are not canonical Base64url', async () => {
    const { svc, world } = setup();
    const { token } = await svc.sign(world.id, 0);
    expect(decodeInviteToken(`${token}=`)).toBeNull();
    expect(decodeInviteToken(token.replace(/-/g, '+').replace(/_/g, '/'))).toBe(token.includes('-') || token.includes('_') ? null : decodeInviteToken(token));
    expect(await svc.verify(`${token}A`)).toBeNull();
  });
  it('accepts a hand-forged token that matches (sanity for the forge helper)', async () => {
    const { svc } = setup();
    expect(await svc.verify(await forge({}))).not.toBeNull();
  });
  it('rejects wrong audience, issuer, secret, alg HS512', async () => {
    const { svc } = setup();
    expect(await svc.verify(await forge({ aud: 'other' }))).toBeNull();
    expect(await svc.verify(await forge({ iss: 'https://evil.test' }))).toBeNull();
    expect(await svc.verify(await forge({ secret: 'x'.repeat(32) }))).toBeNull();
    expect(await svc.verify(await forge({ alg: 'HS512' }))).toBeNull();
  });
  it('rejects alg none', async () => {
    const { svc, world } = setup();
    const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const t = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({
      iss: ISS, aud: 'ficsmap:invite', sub: world.id, jti: 'abcdefghijklmnopqrstuv', ep: 0,
      iat: Math.floor(T0 / 1000), exp: Math.floor(T0 / 1000) + 3600,
    })}.`;
    expect(await svc.verify(encodeInviteToken(t))).toBeNull();
  });
  it('rejects malformed sub or ep and garbage', async () => {
    const { svc } = setup();
    expect(await svc.verify(await forge({ sub: 'not-a-uuid' }))).toBeNull();
    expect(await svc.verify(await forge({ ep: 'x' }))).toBeNull();
    expect(await svc.verify(await forge({ ep: 1.5 }))).toBeNull();
    expect(await svc.verify('garbage')).toBeNull();
    expect(await svc.verify('')).toBeNull();
  });
});

describe('acceptInvite', () => {
  it('joins a new user, writes use + member, bumps rev', async () => {
    const { db, world, svc } = setup();
    const u = createUserForTest(db, 'u');
    const c = await claimsFor(svc, world.id);
    const r = db.transaction(() => acceptInvite(db, u, c, T0))();
    expect(r).toEqual({ kind: 'joined', worldId: world.id });
    expect(n(db, 'invite_uses')).toBe(1);
    expect(db.prepare('SELECT joined_via FROM world_members WHERE user_id = ?').get(u)).toEqual({ joined_via: 'invite' });
    expect(getWorld(db, world.id)!.rev).toBe(world.rev + 1);
    expect(db.prepare('SELECT expires_at FROM invite_uses').get()).toEqual({ expires_at: (c.exp + INVITE_CLOCK_TOLERANCE_S) * 1000 });
  });
  it('second use by another user is invalid and writes nothing', async () => {
    const { db, world, svc } = setup();
    const u1 = createUserForTest(db, 'u1'), u2 = createUserForTest(db, 'u2');
    const c = await claimsFor(svc, world.id);
    db.transaction(() => acceptInvite(db, u1, c, T0))();
    const r = db.transaction(() => acceptInvite(db, u2, c, T0))();
    expect(r).toEqual({ kind: 'invalid' });
    expect(n(db, 'world_members')).toBe(2);
    expect(n(db, 'invite_uses')).toBe(1);
  });
  it('revoked epoch is invalid', async () => {
    const { db, world, svc } = setup();
    const u = createUserForTest(db, 'u');
    const c = await claimsFor(svc, world.id);
    expect(revokeInvites(db, world.id)).toBe(1);
    expect(db.transaction(() => acceptInvite(db, u, c, T0))()).toEqual({ kind: 'invalid' });
    expect(n(db, 'invite_uses')).toBe(0);
  });
  it('missing world is invalid', async () => {
    const { db, svc, world } = setup();
    const u = createUserForTest(db, 'u');
    const c = await claimsFor(svc, world.id);
    db.prepare('DELETE FROM worlds WHERE id = ?').run(world.id);
    expect(db.transaction(() => acceptInvite(db, u, c, T0))()).toEqual({ kind: 'invalid' });
  });
  it('owner and existing member get already; token not consumed', async () => {
    const { db, owner, world, svc } = setup();
    const m = createUserForTest(db, 'm');
    db.prepare("INSERT INTO world_members(world_id, user_id, joined_at, joined_via) VALUES (?, ?, 0, 'invite')").run(world.id, m);
    const c = await claimsFor(svc, world.id);
    expect(db.transaction(() => acceptInvite(db, owner, c, T0))()).toEqual({ kind: 'already', worldId: world.id });
    expect(db.transaction(() => acceptInvite(db, m, c, T0))()).toEqual({ kind: 'already', worldId: world.id });
    expect(n(db, 'invite_uses')).toBe(0);
    expect(getWorld(db, world.id)!.rev).toBe(world.rev);
  });
  it('rolls back invite_uses when the members insert fails', async () => {
    const { db, world, svc } = setup();
    const u = createUserForTest(db, 'u');
    db.exec("CREATE TRIGGER boom BEFORE INSERT ON world_members BEGIN SELECT RAISE(ABORT, 'boom'); END");
    const c = await claimsFor(svc, world.id);
    expect(() => db.transaction(() => acceptInvite(db, u, c, T0))()).toThrow('boom');
    expect(n(db, 'invite_uses')).toBe(0);
  });
  it('fails (FK) for a deleted user without leaving rows', async () => {
    const { db, world, svc } = setup();
    const u = createUserForTest(db, 'u');
    db.prepare('DELETE FROM users WHERE id = ?').run(u);
    const c = await claimsFor(svc, world.id);
    expect(() => db.transaction(() => acceptInvite(db, u, c, T0))()).toThrow();
    expect(n(db, 'invite_uses')).toBe(0);
  });
  it('a used jti cannot be replayed after an early purge, inside the clock-tolerance window', async () => {
    const { db, world, svc } = setup();
    const a = createUserForTest(db, 'a'), b = createUserForTest(db, 'b');
    const { token } = await svc.sign(world.id, 0);
    const c = (await svc.verify(token))!;
    db.transaction(() => acceptInvite(db, a, c, T0))();
    purgeInviteUses(db, c.exp * 1000 + 1);
    const lateNow = c.exp * 1000 + 30_000;
    const late = createInviteService({ secret: SECRET, issuer: ISS, now: () => lateNow });
    const again = await late.verify(token);
    expect(again).not.toBeNull(); // still inside the 60 s tolerance
    expect(db.transaction(() => acceptInvite(db, b, again!, lateNow))()).toEqual({ kind: 'invalid' });
  });
  it('redactUrl hides invite tokens in path and query', () => {
    expect(redactUrl('/invite/abc.def.ghi')).toBe('/invite/[redacted]');
    expect(redactUrl('/invite/abc.def?x=1')).toBe('/invite/[redacted]?x=1');
    expect(redactUrl('/auth/login?invite=abc.def&returnTo=/')).toBe('/auth/login?invite=[redacted]&returnTo=/');
    expect(redactUrl('/auth/login?returnTo=/&invite=abc')).toBe('/auth/login?returnTo=/&invite=[redacted]');
    expect(redactUrl('/api/worlds')).toBe('/api/worlds');
  });
  it('purgeInviteUses removes only expired rows', async () => {
    const { db, world, svc } = setup();
    const u = createUserForTest(db, 'u');
    const c = await claimsFor(svc, world.id);
    db.transaction(() => acceptInvite(db, u, c, T0))();
    expect(purgeInviteUses(db, c.exp * 1000 + 1)).toBe(0); // still inside the verify tolerance
    expect(purgeInviteUses(db, (c.exp + INVITE_CLOCK_TOLERANCE_S) * 1000 + 1)).toBe(1);
    expect(n(db, 'invite_uses')).toBe(0);
  });
});
