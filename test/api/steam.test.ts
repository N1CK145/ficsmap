import { createSteamClient, STEAM_OPENID } from '../../src/server/auth/steam.js';
import { makeTestApp, rawCookie, testConfig } from './helpers.js';

const json = { origin: 'https://ficsmap.test', 'content-type': 'application/json' };
const OWNER_STEAM = '76561197960287930'; // on testConfig.ownerSteamIds
const FRIEND_STEAM = '76561197960287931';

/**
 * The real Steam client against a stubbed Steam: check_authentication answers `valid`, GetPlayerSummaries names
 * every player "P-<last 4 digits>".
 */
function stubSteam({ valid = true, apiKey = 'KEY' as string | null } = {}) {
  const fetchFn = (async (url: string | URL | Request) => {
    const u = new URL(String(url));
    if (u.href === STEAM_OPENID) return new Response(`ns:http://specs.openid.net/auth/2.0\nis_valid:${valid}\n`);
    const id = u.searchParams.get('steamids')!;
    return Response.json({ response: { players: [{ steamid: id, personaname: `P-${id.slice(-4)}`, avatarmedium: `https://avatars.test/${id}.jpg` }] } });
  }) as unknown as typeof fetch;
  return createSteamClient({ steamApiKey: apiKey }, fetchFn);
}

type App = Awaited<ReturnType<typeof makeTestApp>>['app'];

/** Starts a Steam sign-in; returns the state, the oauth_tx cookie and where Steam was asked to send the browser back. */
async function startSteam(app: App, qs = '', cookie?: string) {
  const res = await app.inject({ url: `/auth/steam/login${qs}`, headers: cookie ? { cookie } : {} });
  const returnTo = new URL(res.headers.location as string).searchParams.get('openid.return_to')!;
  const state = new URL(returnTo).searchParams.get('state')!;
  return { res, state, returnTo, tx: `oauth_tx=${rawCookie(res, 'oauth_tx')}` };
}

/** Steam sending the browser back with a positive assertion for `steamId`. */
function steamBack(app: App, start: { returnTo: string; state: string; tx: string }, steamId: string, extraCookie = '', over: Record<string, string> = {}) {
  const claimed = `https://steamcommunity.com/openid/id/${steamId}`;
  const params = new URLSearchParams({
    state: start.state,
    'openid.ns': 'http://specs.openid.net/auth/2.0',
    'openid.mode': 'id_res',
    'openid.op_endpoint': STEAM_OPENID,
    'openid.claimed_id': claimed,
    'openid.identity': claimed,
    'openid.return_to': start.returnTo,
    'openid.response_nonce': `${new Date().toISOString().slice(0, 19)}Zabc`,
    'openid.assoc_handle': '1234567890',
    'openid.signed': 'signed,op_endpoint,claimed_id,identity,return_to,response_nonce,assoc_handle',
    'openid.sig': 'c2ln',
    ...over,
  });
  return app.inject({ url: `/auth/steam/callback?${params}`, headers: { cookie: [start.tx, extraCookie].filter(Boolean).join('; ') } });
}

const sidOf = (res: { cookies: { name: string; value: string }[] }) => `sid=${res.cookies.find(c => c.name === 'sid')!.value}`;

describe('sign-in with Steam', () => {
  it('sends the browser to Steam with return_to on this site and the realm of PUBLIC_URL', async () => {
    const { app } = await makeTestApp({ steam: stubSteam() });
    const { res, returnTo, state } = await startSteam(app);
    expect(res.statusCode).toBe(302);
    const u = new URL(res.headers.location as string);
    expect(u.origin + u.pathname).toBe(STEAM_OPENID);
    expect(u.searchParams.get('openid.realm')).toBe('https://ficsmap.test/');
    expect(returnTo).toBe(`https://ficsmap.test/auth/steam/callback?state=${state}`);
    expect(res.cookies.find(c => c.name === 'oauth_tx')).toMatchObject({ httpOnly: true, path: '/auth', maxAge: 600 });
  });

  it('signs in a server owner from OWNER_STEAM_IDS with the Steam name and avatar', async () => {
    const { app, deps } = await makeTestApp({ steam: stubSteam() });
    const start = await startSteam(app, '?returnTo=/w/x');
    const res = await steamBack(app, start, OWNER_STEAM);
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/w/x');
    const me = (await app.inject({ url: '/api/me', headers: { cookie: sidOf(res) } })).json();
    expect(me).toMatchObject({ displayName: 'P-7930', avatarUrl: `https://avatars.test/${OWNER_STEAM}.jpg`, serverOwner: true });
    expect(me.identities).toEqual([{ provider: 'steam', subject: OWNER_STEAM, name: 'P-7930' }]);
    expect(deps.db.prepare("SELECT COUNT(*) AS n FROM identities WHERE provider = 'steam'").get()).toEqual({ n: 1 });
  });

  it('shows the SteamID as name without STEAM_API_KEY', async () => {
    const { app } = await makeTestApp({ steam: stubSteam({ apiKey: null }) });
    const res = await steamBack(app, await startSteam(app), OWNER_STEAM);
    expect((await app.inject({ url: '/api/me', headers: { cookie: sidOf(res) } })).json().displayName).toBe(OWNER_STEAM);
  });

  it('is invite-only for everyone else', async () => {
    const { app, deps } = await makeTestApp({ steam: stubSteam() });
    const res = await steamBack(app, await startSteam(app), FRIEND_STEAM);
    expect(res.headers.location).toBe('/login?error=invite_only');
    expect(deps.db.prepare('SELECT COUNT(*) AS n FROM users').get()).toEqual({ n: 0 });
  });

  it('joins a world through an invite link and creates the account', async () => {
    const { app, login, deps } = await makeTestApp({ steam: stubSteam() });
    const owner = await login('owner-1');
    const world = (await app.inject({ method: 'POST', url: '/api/worlds', headers: { ...json, cookie: owner }, payload: { name: 'W' } })).json();
    const link = (await app.inject({ url: `/api/worlds/${world.id}/invite-link`, headers: { cookie: owner } })).json().url as string;
    const token = link.split('/invite/')[1]!;
    const res = await steamBack(app, await startSteam(app, `?invite=${token}&returnTo=/`), FRIEND_STEAM);
    expect(res.headers.location).toBe(`/w/${world.id}?joined=1`);
    const members = (await app.inject({ url: `/api/worlds/${world.id}`, headers: { cookie: sidOf(res) } })).json().members;
    expect(members.map((m: { displayName: string }) => m.displayName)).toEqual(['user-owner-1', 'P-7931']);
    expect(deps.db.prepare('SELECT COUNT(*) AS n FROM invites').get()).toEqual({ n: 0 });
  });

  it('the invite page offers Steam next to Discord', async () => {
    const { app, login } = await makeTestApp({ steam: stubSteam() });
    const owner = await login('owner-1');
    const world = (await app.inject({ method: 'POST', url: '/api/worlds', headers: { ...json, cookie: owner }, payload: { name: 'W' } })).json();
    const link = (await app.inject({ url: `/api/worlds/${world.id}/invite-link`, headers: { cookie: owner } })).json().url as string;
    const token = link.split('/invite/')[1]!;
    const page = await app.inject({ url: `/invite/${token}`, headers: { 'accept-language': 'en' } });
    expect(page.body).toContain(`href="/auth/login?invite=${token}&amp;returnTo=/"`);
    expect(page.body).toContain(`href="/auth/steam/login?invite=${token}&amp;returnTo=/"`);
    expect(page.body).toContain('Sign in with Steam to join');
  });

  it('rejects an assertion Steam does not confirm; with an invite it goes back to the invite page', async () => {
    const { app } = await makeTestApp({ steam: stubSteam({ valid: false }) });
    expect((await steamBack(app, await startSteam(app), OWNER_STEAM)).headers.location).toBe('/login?error=failed');
    const withInvite = await steamBack(app, await startSteam(app, `?invite=${'a'.repeat(43)}`), OWNER_STEAM);
    expect(withInvite.headers.location).toBe(`/invite/${'a'.repeat(43)}`);
  });

  it('rejects a forged return_to, a wrong state and a missing cookie; a cancel says so', async () => {
    const { app } = await makeTestApp({ steam: stubSteam() });
    const start = await startSteam(app);
    expect((await steamBack(app, start, OWNER_STEAM, '', { 'openid.return_to': 'https://evil.example/auth/steam/callback' })).headers.location).toBe('/login?error=failed');
    const s2 = await startSteam(app);
    expect((await steamBack(app, { ...s2, state: 'other' }, OWNER_STEAM)).headers.location).toBe('/login?error=expired');
    const s3 = await startSteam(app);
    expect((await steamBack(app, { ...s3, tx: '' }, OWNER_STEAM)).headers.location).toBe('/login?error=expired');
    const s4 = await startSteam(app);
    const cancel = await app.inject({ url: `/auth/steam/callback?state=${s4.state}&openid.mode=cancel`, headers: { cookie: s4.tx } });
    expect(cancel.headers.location).toBe('/login?error=cancelled');
  });
});

describe('linking Steam and Discord', () => {
  it('a signed-in Discord user links Steam, then signs in with either', async () => {
    const { app, login } = await makeTestApp({ steam: stubSteam() });
    const discord = await login('owner-1');
    const start = await startSteam(app, '?link=1', discord);
    const linked = await steamBack(app, start, FRIEND_STEAM, discord);
    expect(linked.headers.location).toBe('/profile?linked=steam');
    expect(linked.cookies.find(c => c.name === 'sid')).toBeUndefined();
    const me = (await app.inject({ url: '/api/me', headers: { cookie: discord } })).json();
    expect(me.identities.map((i: { provider: string }) => i.provider)).toEqual(['discord', 'steam']);
    // FRIEND_STEAM is no owner, but it is linked now: signing in with it opens the same account, name unchanged.
    const viaSteam = await steamBack(app, await startSteam(app), FRIEND_STEAM);
    const again = (await app.inject({ url: '/api/me', headers: { cookie: sidOf(viaSteam) } })).json();
    expect(again).toMatchObject({ id: me.id, displayName: 'P-7931' });
  });

  it('a Steam-only account links Discord the same way', async () => {
    const { app } = await makeTestApp({ steam: stubSteam() });
    const steamSid = sidOf(await steamBack(app, await startSteam(app), OWNER_STEAM));
    const start = await app.inject({ url: '/auth/login?link=1', headers: { cookie: steamSid } });
    const state = new URL(start.headers.location as string).searchParams.get('state')!;
    const res = await app.inject({ url: `/auth/discord/callback?code=friend&state=${state}`, headers: { cookie: `${steamSid}; oauth_tx=${rawCookie(start, 'oauth_tx')}` } });
    expect(res.headers.location).toBe('/profile?linked=discord');
    const me = (await app.inject({ url: '/api/me', headers: { cookie: steamSid } })).json();
    expect(me.identities.map((i: { provider: string }) => i.provider)).toEqual(['discord', 'steam']);
  });

  it('never links a Steam account another user signs in with, and needs the same session to finish', async () => {
    const { app, login } = await makeTestApp({ steam: stubSteam() });
    await steamBack(app, await startSteam(app), OWNER_STEAM); // OWNER_STEAM has its own account now
    const discord = await login('owner-1');
    const taken = await steamBack(app, await startSteam(app, '?link=1', discord), OWNER_STEAM, discord);
    expect(taken.headers.location).toBe('/profile?link_error=taken');
    // Started while signed in, finished without the session: nothing is linked.
    const noSession = await steamBack(app, await startSteam(app, '?link=1', discord), FRIEND_STEAM);
    expect(noSession.headers.location).toBe('/profile?link_error=expired');
    const me = (await app.inject({ url: '/api/me', headers: { cookie: discord } })).json();
    expect(me.identities.map((i: { provider: string }) => i.provider)).toEqual(['discord']);
  });

  it('`link=1` without a session is an ordinary sign-in', async () => {
    const { app } = await makeTestApp({ steam: stubSteam() });
    const res = await steamBack(app, await startSteam(app, '?link=1&returnTo=/w/x'), OWNER_STEAM);
    expect(res.headers.location).toBe('/w/x');
  });

  it('unlinks a provider, but never the last one', async () => {
    const { app, login } = await makeTestApp({ steam: stubSteam(), config: { ...testConfig } });
    const discord = await login('owner-1');
    await steamBack(app, await startSteam(app, '?link=1', discord), FRIEND_STEAM, discord);
    const del = (p: string) => app.inject({ method: 'DELETE', url: `/api/me/identities/${p}`, headers: { cookie: discord, origin: json.origin } });
    expect((await del('github')).statusCode).toBe(404);
    expect((await del('discord')).statusCode).toBe(204);
    const last = await del('steam');
    expect(last.statusCode).toBe(409);
    expect(last.json().error).toBe('last_identity');
    expect((await del('discord')).statusCode).toBe(404);
    expect((await app.inject({ method: 'DELETE', url: '/api/me/identities/steam', headers: { origin: json.origin } })).statusCode).toBe(401);
  });
});
