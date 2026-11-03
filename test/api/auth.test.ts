import { createHash } from 'node:crypto';
import { makeTestApp, rawCookie, testConfig, fakeDiscord } from './helpers.js';

const json = { origin: 'https://ficsmap.test', 'content-type': 'application/json' };
const n = (db: { prepare(s: string): { get(): unknown } }, t: string) =>
  (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;

async function startLogin(app: Awaited<ReturnType<typeof makeTestApp>>['app'], qs = '') {
  const res = await app.inject(`/auth/login${qs}`);
  const state = new URL(res.headers.location as string).searchParams.get('state')!;
  return { res, state, cookie: `oauth_tx=${rawCookie(res, 'oauth_tx')}` };
}

describe('auth', () => {
  it('login redirects to Discord with a signed oauth_tx cookie', async () => {
    const { app } = await makeTestApp();
    const { res } = await startLogin(app);
    expect(res.statusCode).toBe(302);
    const tx = res.cookies.find(c => c.name === 'oauth_tx')!;
    expect(tx).toMatchObject({ httpOnly: true, path: '/auth', maxAge: 600, sameSite: 'Lax' });
    expect(tx.value).toContain('.');
  });
  it('login -> callback sets sid and redirects to returnTo', async () => {
    const { app } = await makeTestApp();
    const { state, cookie } = await startLogin(app, '?returnTo=/worlds/x');
    const res = await app.inject({ url: `/auth/discord/callback?code=owner-1&state=${state}`, headers: { cookie } });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/worlds/x');
    const sid = res.cookies.find(c => c.name === 'sid')!;
    expect(sid).toMatchObject({ httpOnly: true, path: '/', sameSite: 'Lax', maxAge: 30 * 86400 });
    expect(res.cookies.find(c => c.name === 'oauth_tx')?.value).toBe('');
  });
  it('replaces an external returnTo with /', async () => {
    for (const bad of ['//evil.com', 'https://evil.com', 'x', '/\t/evil.com', '/\n/x', '/\\evil.com', '/%09/evil.com', '/%0a/evil.com', '/%zz', '/.//evil.com', '/%2e%2e//evil.com', '/..//evil.com', '/%2e//evil.com', '/a/..//evil.com', '/.\\/evil.com', '/' + 'a'.repeat(3000)]) {
      const { app } = await makeTestApp(); // fresh app: keeps the 10/min /auth rate limit out of the loop
      const { state, cookie } = await startLogin(app, `?returnTo=${encodeURIComponent(bad)}`);
      const res = await app.inject({ url: `/auth/discord/callback?code=owner-1&state=${state}`, headers: { cookie } });
      expect([bad.slice(0, 20), res.headers.location]).toEqual([bad.slice(0, 20), '/']);
    }
  });
  it('keeps a normal returnTo with query', async () => {
    const { app } = await makeTestApp();
    const { state, cookie } = await startLogin(app, `?returnTo=${encodeURIComponent('/w/abc?x=1')}`);
    const res = await app.inject({ url: `/auth/discord/callback?code=owner-1&state=${state}`, headers: { cookie } });
    expect(res.headers.location).toBe('/w/abc?x=1');
  });
  it('allows a same-origin path that normalises to a single leading slash', async () => {
    const { app } = await makeTestApp();
    const { state, cookie } = await startLogin(app, '?returnTo=/x/../../evil.com');
    const res = await app.inject({ url: `/auth/discord/callback?code=owner-1&state=${state}`, headers: { cookie } });
    expect(res.headers.location).toBe('/evil.com');
  });
  it('uses PKCE S256: challenge on authorize, verifier on exchange', async () => {
    const seen: { challenge?: string; verifier?: string } = {};
    const { app } = await makeTestApp({
      discord: {
        authorizeUrl: (s, c) => { seen.challenge = c; return fakeDiscord.authorizeUrl(s, c); },
        exchangeCode: (code, v) => { seen.verifier = v; return fakeDiscord.exchangeCode(code, v); },
      },
    });
    const { state, cookie } = await startLogin(app);
    await app.inject({ url: `/auth/discord/callback?code=owner-1&state=${state}`, headers: { cookie } });
    expect(createHash('sha256').update(seen.verifier!).digest('base64url')).toBe(seen.challenge);
  });
  it('replaces an older session on login', async () => {
    const { app, login, deps } = await makeTestApp();
    const old = await login('owner-1');
    const { state, cookie } = await startLogin(app);
    await app.inject({ url: `/auth/discord/callback?code=owner-1&state=${state}`, headers: { cookie: `${cookie}; ${old}` } });
    expect(n(deps.db, 'sessions')).toBe(1);
  });
  it('rejects an oversized invite token', async () => {
    const { app } = await makeTestApp();
    const res = await app.inject(`/auth/login?invite=${'a'.repeat(2049)}`);
    expect(res.headers.location).toBe('/login?error=invite_invalid');
    expect(res.cookies.find(c => c.name === 'oauth_tx')).toBeUndefined();
  });
  it('sets Secure on sid and oauth_tx when cookieSecure is true', async () => {
    const { app } = await makeTestApp({ config: { ...testConfig, cookieSecure: true } });
    const start = await app.inject('/auth/login');
    expect(String(start.headers['set-cookie'])).toMatch(/oauth_tx=[^;]*;.*Secure/i);
    const state = new URL(start.headers.location as string).searchParams.get('state')!;
    const res = await app.inject({ url: `/auth/discord/callback?code=owner-1&state=${state}`, headers: { cookie: `oauth_tx=${rawCookie(start, 'oauth_tx')}` } });
    const sid = ([] as string[]).concat(res.headers['set-cookie'] as string[]).find(l => l.startsWith('sid=') && !l.startsWith('sid=;'))!;
    expect(sid).toMatch(/Secure/i);
  });
  it('state mismatch redirects to expired and writes nothing', async () => {
    const { app, deps } = await makeTestApp();
    const { cookie } = await startLogin(app);
    const res = await app.inject({ url: '/auth/discord/callback?code=owner-1&state=wrong', headers: { cookie } });
    expect(res.headers.location).toBe('/login?error=expired');
    expect(n(deps.db, 'users')).toBe(0);
  });
  it('missing or tampered oauth_tx is expired', async () => {
    const { app, deps } = await makeTestApp();
    const { state, cookie } = await startLogin(app);
    const a = await app.inject({ url: `/auth/discord/callback?code=owner-1&state=${state}` });
    expect(a.headers.location).toBe('/login?error=expired');
    const b = await app.inject({ url: `/auth/discord/callback?code=owner-1&state=${state}`, headers: { cookie: cookie.slice(0, -2) + 'xx' } });
    expect(b.headers.location).toBe('/login?error=expired');
    expect(n(deps.db, 'users')).toBe(0);
  });
  it('?error=access_denied redirects to cancelled', async () => {
    const { app } = await makeTestApp();
    const res = await app.inject('/auth/discord/callback?error=access_denied');
    expect(res.headers.location).toBe('/login?error=cancelled');
  });
  it('non-owner without invite gets invite_only and no rows', async () => {
    const { app, deps } = await makeTestApp();
    const { state, cookie } = await startLogin(app);
    const res = await app.inject({ url: `/auth/discord/callback?code=stranger&state=${state}`, headers: { cookie } });
    expect(res.headers.location).toBe('/login?error=invite_only');
    expect(n(deps.db, 'users')).toBe(0);
    expect(n(deps.db, 'identities')).toBe(0);
    expect(n(deps.db, 'sessions')).toBe(0);
  });
  it('Discord exchange failure redirects to failed', async () => {
    const { app } = await makeTestApp({
      discord: { authorizeUrl: (s, _c) => `https://discord.test/?state=${s}`, exchangeCode: async () => { throw new Error('boom'); } },
    });
    const { state, cookie } = await startLogin(app);
    const res = await app.inject({ url: `/auth/discord/callback?code=x&state=${state}`, headers: { cookie } });
    expect(res.headers.location).toBe('/login?error=failed');
  });
  it('/api/me is 401 without cookie, DTO with it', async () => {
    const { app, login } = await makeTestApp();
    expect((await app.inject('/api/me')).statusCode).toBe(401);
    const cookie = await login('owner-1');
    const res = await app.inject({ url: '/api/me', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      id: 1, displayName: 'user-owner-1', avatarUrl: null, email: 'owner-1@example.test', datasetVersion: 'test',
    });
  });
  it('an expired session is treated as absent', async () => {
    let now = 1_000_000;
    const { app, login } = await makeTestApp({ now: () => now });
    const cookie = await login('owner-1');
    now += 31 * 86400_000;
    expect((await app.inject({ url: '/api/me', headers: { cookie } })).statusCode).toBe(401);
  });
  it('logout deletes the session; without session also 204', async () => {
    const { app, login, deps } = await makeTestApp();
    const cookie = await login('owner-1');
    const res = await app.inject({ method: 'POST', url: '/auth/logout', payload: '{}', headers: { ...json, cookie } });
    expect(res.statusCode).toBe(204);
    expect(res.cookies.find(c => c.name === 'sid')?.value).toBe('');
    expect(n(deps.db, 'sessions')).toBe(0);
    expect((await app.inject({ url: '/api/me', headers: { cookie } })).statusCode).toBe(401);
    const again = await app.inject({ method: 'POST', url: '/auth/logout', payload: '{}', headers: json });
    expect(again.statusCode).toBe(204);
  });
  it('rate-limits /auth/* to 10 per minute', async () => {
    const { app } = await makeTestApp();
    let last = 0;
    for (let i = 0; i < 11; i++) last = (await app.inject('/auth/login')).statusCode;
    expect(last).toBe(429);
  });
  it('createUserForTest makes a non-owner usable for login', async () => {
    const { app, login, createUser } = await makeTestApp();
    const id = createUser('friend');
    const cookie = await login('friend');
    const me = (await app.inject({ url: '/api/me', headers: { cookie } })).json();
    expect(me.id).toBe(id);
  });
});
