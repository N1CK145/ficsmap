import { addMember, makeTestApp, rawCookie } from './helpers.js';
import { createWorld } from '../../src/server/domain/worlds.js';
import { SseHub } from '../../src/server/sse/hub.js';

const json = { origin: 'https://ficsmap.test', 'content-type': 'application/json' };
const n = (db: { prepare(s: string): { get(): unknown } }, t: string) =>
  (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;

async function setup(over: Parameters<typeof makeTestApp>[0] = {}, worldName = 'Massage-2') {
  const ctx = await makeTestApp(over);
  const ownerId = ctx.createUser('owner-1');
  const world = createWorld(ctx.deps.db, ownerId, worldName, 'test', 0);
  const token = async () => (await ctx.deps.invites!.sign(world.id, 0)).token;
  return { ...ctx, world, token };
}

async function loginWithInvite(app: Awaited<ReturnType<typeof makeTestApp>>['app'], token: string, code: string, cookie?: string) {
  const start = await app.inject({ url: `/auth/login?invite=${encodeURIComponent(token)}&returnTo=/`, headers: cookie ? { cookie } : {} });
  const state = new URL(start.headers.location as string).searchParams.get('state')!;
  return app.inject({
    url: `/auth/discord/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`,
    headers: { cookie: `oauth_tx=${rawCookie(start, 'oauth_tx')}` },
  });
}

describe('GET /invite/:token', () => {
  it('renders the landing page without a session and writes nothing (twice)', async () => {
    const { app, deps, token } = await setup();
    const t = await token();
    const before = [n(deps.db, 'invite_uses'), n(deps.db, 'users'), n(deps.db, 'world_members'), n(deps.db, 'sessions')];
    for (let i = 0; i < 2; i++) {
      const res = await app.inject(`/invite/${t}`);
      expect(res.statusCode).toBe(200);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.headers['x-robots-tag']).toBe('noindex');
      expect(res.headers['content-type']).toContain('text/html');
      expect(res.body).toContain('lang="en"');
      expect(res.body).toContain('Massage-2');
      expect(res.body).toContain('user-owner-1');
      expect(res.body).toContain('0 %');
      expect(res.body).toContain('Invite valid until');
      expect(res.body).toContain(`/auth/login?invite=${t}&amp;returnTo=/`);
    }
    expect([n(deps.db, 'invite_uses'), n(deps.db, 'users'), n(deps.db, 'world_members'), n(deps.db, 'sessions')]).toEqual(before);
  });
  it('shows round(done/total*100) as progress', async () => {
    const { app, deps, world, token } = await setup();
    const actor = deps.dataset.items[0]!.name;
    deps.db.prepare('INSERT INTO marks(world_id, actor_name, updated_at) VALUES (?, ?, 0)').run(world.id, actor);
    const pct = Math.round(100 / deps.dataset.items.length);
    expect((await app.inject(`/invite/${await token()}`)).body).toContain(`${pct} %`);
  });
  it('escapes user-controlled names', async () => {
    const { app, token } = await setup({}, '<img src=x onerror=alert(1)>"&');
    const res = await app.inject(`/invite/${await token()}`);
    expect(res.body).not.toContain('<img src=x');
    expect(res.body).toContain('&lt;img src=x onerror=alert(1)&gt;&quot;&amp;');
  });
  it('invalid tokens get a generic 200 page without names', async () => {
    const { app } = await setup();
    const res = await app.inject('/invite/garbage');
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("This invite link isn't valid");
    expect(res.body).not.toContain('Massage-2');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-robots-tag']).toBe('noindex');
  });
  it('expired token is generic invalid', async () => {
    let now = 1_800_000_000_000;
    const { app, token } = await setup({ now: () => now });
    const t = await token();
    now += 8 * 86_400_000;
    expect((await app.inject(`/invite/${t}`)).body).toContain("This invite link isn't valid");
  });
  it('uses German copy for Accept-Language: de', async () => {
    const { app, token } = await setup();
    const res = await app.inject({ url: `/invite/${await token()}`, headers: { 'accept-language': 'de-DE,de;q=0.9' } });
    expect(res.body).toContain('lang="de"');
    expect(res.body).toContain('Mit Discord anmelden');
    expect(res.body).not.toContain('Sign in with Discord');
    const bad = await app.inject({ url: '/invite/x', headers: { 'accept-language': 'de' } });
    expect(bad.body).toContain('lang="de"');
  });
  it('auto-joins a logged-in non-member and redirects', async () => {
    const { app, deps, world, token, login, createUser } = await setup();
    createUser('guest');
    const cookie = await login('guest');
    const res = await app.inject({ url: `/invite/${await token()}`, headers: { cookie } });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe(`/w/${world.id}?joined=1`);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(n(deps.db, 'invite_uses')).toBe(1);
  });
  it('broadcasts members after a join', async () => {
    const hub = new SseHub();
    const events: unknown[] = [];
    const orig = hub.broadcast.bind(hub);
    hub.broadcast = (id, e) => { events.push([id, e]); orig(id, e); };
    const { app, world, token } = await setup({ hub });
    const r = await loginWithInvite(app, await token(), 'guest');
    expect(r.headers.location).toBe(`/w/${world.id}?joined=1`);
    expect(events).toContainEqual([world.id, { type: 'members' }]);
  });
  it('owner opening the link gets already=1 and the token stays valid', async () => {
    const { app, deps, world, token, login } = await setup();
    const t = await token();
    const oc = await login('owner-1');
    const r1 = await app.inject({ url: `/invite/${t}`, headers: { cookie: oc } });
    expect(r1.headers.location).toBe(`/w/${world.id}?already=1`);
    expect(n(deps.db, 'invite_uses')).toBe(0);
  });
  it('a different user reusing the token sees "no longer valid"', async () => {
    const { app, token, login, createUser } = await setup();
    createUser('g1'); createUser('g2');
    const t = await token();
    const c1 = await login('g1');
    await app.inject({ url: `/invite/${t}`, headers: { cookie: c1 } });
    const c2 = await login('g2');
    const res = await app.inject({ url: `/invite/${t}`, headers: { cookie: c2 } });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('This invite is no longer valid. Ask the owner for a new link.');
    expect(res.body).toContain('href="/"');
    expect(res.body).not.toContain('Massage-2');
    expect(res.headers['cache-control']).toBe('no-store');
  });
  it('rate limits to 10/min per IP', async () => {
    const { app } = await setup();
    const codes: number[] = [];
    for (let i = 0; i < 11; i++) codes.push((await app.inject('/invite/x')).statusCode);
    expect(codes.slice(0, 10).every(c => c === 200)).toBe(true);
    expect(codes[10]).toBe(429);
  });
});

describe('invite API', () => {
  it('owner gets url + expiresAt, no-store, no DB write', async () => {
    const { app, deps, world, login } = await setup();
    const cookie = await login('owner-1');
    const rev = (deps.db.prepare('SELECT rev FROM worlds WHERE id = ?').get(world.id) as { rev: number }).rev;
    const res = await app.inject({ url: `/api/worlds/${world.id}/invite-link`, headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const body = res.json() as { url: string; expiresAt: number };
    expect(body.url.startsWith('https://ficsmap.test/invite/')).toBe(true);
    expect(typeof body.expiresAt).toBe('number');
    const claims = await deps.invites!.verify(body.url.split('/invite/')[1]!);
    expect(claims?.worldId).toBe(world.id);
    expect((deps.db.prepare('SELECT rev FROM worlds WHERE id = ?').get(world.id) as { rev: number }).rev).toBe(rev);
    expect(n(deps.db, 'invite_uses')).toBe(0);
  });
  it('member gets 403, anonymous 401, non-member 404', async () => {
    const { app, deps, world, createUser, login } = await setup();
    addMember(deps.db, world.id, createUser('mem'));
    const mc = await login('mem');
    const r = await app.inject({ url: `/api/worlds/${world.id}/invite-link`, headers: { cookie: mc } });
    expect(r.statusCode).toBe(403);
    const rv = await app.inject({ method: 'POST', url: `/api/worlds/${world.id}/invite-links/revoke`, headers: { ...json, cookie: mc }, payload: {} });
    expect(rv.statusCode).toBe(403);
    expect((await app.inject(`/api/worlds/${world.id}/invite-link`)).statusCode).toBe(401);
    createUser('out');
    const oc = await login('out');
    expect((await app.inject({ url: `/api/worlds/${world.id}/invite-link`, headers: { cookie: oc } })).statusCode).toBe(404);
  });
  it('revoke returns ok and invalidates old links', async () => {
    const { app, world, login, token } = await setup();
    const t = await token();
    const oc = await login('owner-1');
    const rv = await app.inject({ method: 'POST', url: `/api/worlds/${world.id}/invite-links/revoke`, headers: { ...json, cookie: oc }, payload: {} });
    expect(rv.statusCode).toBe(200);
    expect(rv.json()).toEqual({ ok: true });
    const page = await app.inject(`/invite/${t}`);
    expect(page.body).toContain("This invite link isn't valid");
    expect(page.body).not.toContain('Massage-2');
    // a fresh link carries the new epoch
    const fresh = (await app.inject({ url: `/api/worlds/${world.id}/invite-link`, headers: { cookie: oc } })).json() as { url: string };
    expect((await app.inject(fresh.url.replace('https://ficsmap.test', ''))).body).toContain('Massage-2');
  });
});

describe('invalid invite with a session', () => {
  it('revoked link shows no-longer-valid', async () => {
    const { app, world, token, login, createUser } = await setup();
    const t = await token();
    const oc = await login('owner-1');
    await app.inject({ method: 'POST', url: `/api/worlds/${world.id}/invite-links/revoke`, headers: { ...json, cookie: oc }, payload: {} });
    createUser('guest');
    const res = await app.inject({ url: `/invite/${t}`, headers: { cookie: await login('guest') } });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('This invite is no longer valid. Ask the owner for a new link.');
    expect(res.body).toContain('href="/"');
    expect(res.body).not.toContain('Massage-2');
  });
  it('expired token shows no-longer-valid', async () => {
    let now = 1_800_000_000_000;
    const { app, token, login, createUser } = await setup({ now: () => now });
    const t = await token();
    createUser('guest');
    const cookie = await login('guest');
    now += 8 * 86_400_000;
    const res = await app.inject({ url: `/invite/${t}`, headers: { cookie } });
    expect(res.body).toContain('This invite is no longer valid. Ask the owner for a new link.');
  });
});

describe('invite page security headers', () => {
  it('are set on every state', async () => {
    const { app, token, login, createUser } = await setup();
    createUser('guest');
    const cookie = await login('guest');
    const t = await token();
    const landing = await app.inject(`/invite/${t}`);
    const generic = await app.inject('/invite/garbage');
    const invalidAuthed = await app.inject({ url: '/invite/garbage', headers: { cookie } });
    const redirect = await app.inject({ url: `/invite/${t}`, headers: { cookie } });
    for (const r of [landing, generic, invalidAuthed, redirect]) {
      expect(r.headers['referrer-policy']).toBe('no-referrer');
      expect(r.headers['x-content-type-options']).toBe('nosniff');
      expect(r.headers['content-security-policy']).toBe(
        "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; form-action 'none'");
      expect(r.headers['cache-control']).toBe('no-store');
    }
  });
});

describe('login with invite', () => {
  it('a new allowlisted owner with a used or revoked (validly signed) token keeps the account', async () => {
    for (const mode of ['used', 'revoked'] as const) {
      const { app, deps, world, token, createUser } = await setup();
      // owner-1 is already the world owner here; use a second allowlisted id instead.
      deps.config.ownerDiscordIds.add('owner-2');
      const t = await token();
      if (mode === 'used') {
        createUser('first');
        await loginWithInvite(app, t, 'first');
      } else {
        deps.db.prepare('UPDATE worlds SET invite_epoch = invite_epoch + 1 WHERE id = ?').run(world.id);
      }
      const res = await loginWithInvite(app, t, 'owner-2');
      expect([mode, res.headers.location]).toEqual([mode, `/invite/${t}`]);
      expect(res.cookies.find(c => c.name === 'sid')).toBeTruthy();
      expect(deps.db.prepare("SELECT COUNT(*) AS n FROM identities WHERE subject = 'owner-2'").get()).toEqual({ n: 1 });
      deps.config.ownerDiscordIds.delete('owner-2');
    }
  });
  it('an owner-allowlisted new user is never rolled back by an invalid invite', async () => {
    const { app, deps } = await makeTestApp();
    const res = await loginWithInvite(app, 'garbage', 'owner-1');
    expect(res.headers.location).toBe('/invite/garbage');
    expect(res.cookies.find(c => c.name === 'sid')).toBeTruthy();
    expect(deps.db.prepare("SELECT COUNT(*) AS n FROM identities WHERE subject = 'owner-1'").get()).toEqual({ n: 1 });
  });
  it('a cancelled callback leaves the token valid for the next user', async () => {
    const { app, deps, token } = await setup();
    const t = await token();
    const start = await app.inject(`/auth/login?invite=${t}`);
    const cancelled = await app.inject({
      url: '/auth/discord/callback?error=access_denied',
      headers: { cookie: `oauth_tx=${rawCookie(start, 'oauth_tx')}` },
    });
    // Back to the invite landing page (sign-in button again), not the bare login page that forgot the invite.
    expect(cancelled.headers.location).toBe(`/invite/${t}`);
    expect(cancelled.cookies.find(c => c.name === 'oauth_tx')?.value).toBe('');
    expect([n(deps.db, 'invite_uses'), n(deps.db, 'users'), n(deps.db, 'sessions')]).toEqual([0, 1, 0]);
    const res = await loginWithInvite(app, t, 'newbie');
    expect(res.headers.location).toMatch(/^\/w\/[0-9a-f-]{36}\?joined=1$/);
  });
  it('a failed Discord exchange with an invite returns to the invite page and leaves the token valid', async () => {
    const failing = { authorizeUrl: (s: string) => `https://discord.test/?state=${s}`, exchangeCode: async () => { throw new Error('boom'); } };
    const { app, deps, token } = await setup({ discord: failing });
    const t = await token();
    const failed = await loginWithInvite(app, t, 'newbie');
    expect(failed.headers.location).toBe(`/invite/${t}`);
    expect(failed.cookies.find(c => c.name === 'sid')).toBeUndefined();
    expect([n(deps.db, 'invite_uses'), n(deps.db, 'users'), n(deps.db, 'sessions')]).toEqual([0, 1, 0]);
    expect(await deps.invites!.verify(t)).not.toBeNull();
  });
  it('a cancelled callback with a tampered oauth_tx stays on the login page', async () => {
    const { app, token } = await setup();
    const start = await app.inject(`/auth/login?invite=${await token()}`);
    const res = await app.inject({
      url: '/auth/discord/callback?error=access_denied',
      headers: { cookie: `oauth_tx=${rawCookie(start, 'oauth_tx').slice(0, -2)}xx` },
    });
    expect(res.headers.location).toBe('/login?error=cancelled');
  });
  it('a new Discord user is created and joined in one transaction', async () => {
    const { app, deps, world, token } = await setup();
    const res = await loginWithInvite(app, await token(), 'newbie');
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe(`/w/${world.id}?joined=1`);
    expect(res.cookies.find(c => c.name === 'sid')).toBeTruthy();
    expect(deps.db.prepare("SELECT COUNT(*) AS n FROM identities WHERE subject = 'newbie'").get()).toEqual({ n: 1 });
    expect(n(deps.db, 'invite_uses')).toBe(1);
    expect(deps.db.prepare("SELECT joined_via FROM world_members m JOIN identities i ON i.user_id = m.user_id WHERE i.subject = 'newbie'").get())
      .toEqual({ joined_via: 'invite' });
  });
  it('an already-used token with a new user rolls everything back', async () => {
    const { app, deps, token } = await setup();
    const t = await token();
    await loginWithInvite(app, t, 'first');
    const users = n(deps.db, 'users'), idents = n(deps.db, 'identities'), sessions = n(deps.db, 'sessions');
    const res = await loginWithInvite(app, t, 'second');
    expect(res.headers.location).toBe('/login?error=invite_invalid');
    expect(res.cookies.find(c => c.name === 'sid')).toBeUndefined();
    expect([n(deps.db, 'users'), n(deps.db, 'identities'), n(deps.db, 'sessions')]).toEqual([users, idents, sessions]);
    expect(n(deps.db, 'invite_uses')).toBe(1);
  });
  it('an invalid token (garbage) with a new user is invite_invalid', async () => {
    const { app, deps } = await setup();
    const users = n(deps.db, 'users');
    const res = await loginWithInvite(app, 'garbage', 'stranger');
    expect(res.headers.location).toBe('/login?error=invite_invalid');
    expect(n(deps.db, 'users')).toBe(users);
  });
  it('an existing user with a garbage invite gets a session and lands on the invite page', async () => {
    const { app, deps, createUser } = await setup();
    createUser('existing');
    const res = await loginWithInvite(app, 'garbage', 'existing');
    expect(res.headers.location).toBe('/invite/garbage');
    const sid = res.cookies.find(c => c.name === 'sid')!;
    const page = await app.inject({ url: '/invite/garbage', headers: { cookie: `sid=${sid.value}` } });
    expect(page.body).toContain('This invite is no longer valid. Ask the owner for a new link.');
    expect(n(deps.db, 'sessions')).toBe(1);
  });
  it('an existing user with a used token ends on the no-longer-valid page', async () => {
    const { app, token, createUser } = await setup();
    const t = await token();
    await loginWithInvite(app, t, 'first');
    createUser('existing');
    const res = await loginWithInvite(app, t, 'existing');
    expect(res.headers.location).toBe(`/invite/${t}`);
  });
  it('an owner logging in with an invite for their own world gets already=1', async () => {
    const { app, world, token } = await setup();
    const res = await loginWithInvite(app, await token(), 'owner-1');
    expect(res.headers.location).toBe(`/w/${world.id}?already=1`);
  });
});
