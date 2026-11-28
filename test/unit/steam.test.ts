import { createSteamClient, steamAuthorizeUrl, SteamAuthError, verifySteamAssertion, STEAM_OPENID } from '../../src/server/auth/steam.js';
import { testConfig } from '../api/helpers.js';

const STEAM_ID = '76561197960287930';
const RETURN_TO = 'https://ficsmap.test/auth/steam/callback?state=abc';
const NOW = Date.UTC(2026, 10, 28, 12, 0, 0);

/** An assertion as Steam sends it back to return_to (positive, signed). */
function assertion(over: Record<string, string | undefined> = {}): Record<string, string> {
  const base: Record<string, string | undefined> = {
    state: 'abc',
    'openid.ns': 'http://specs.openid.net/auth/2.0',
    'openid.mode': 'id_res',
    'openid.op_endpoint': STEAM_OPENID,
    'openid.claimed_id': `https://steamcommunity.com/openid/id/${STEAM_ID}`,
    'openid.identity': `https://steamcommunity.com/openid/id/${STEAM_ID}`,
    'openid.return_to': RETURN_TO,
    'openid.response_nonce': '2026-11-28T11:59:30ZbA1x',
    'openid.assoc_handle': '1234567890',
    'openid.signed': 'signed,op_endpoint,claimed_id,identity,return_to,response_nonce,assoc_handle',
    'openid.sig': 'c2lnbmF0dXJl',
    ...over,
  };
  return Object.fromEntries(Object.entries(base).filter(([, v]) => v !== undefined)) as Record<string, string>;
}

/** A fetch stub for Steam's check_authentication; records what it was sent. */
function steamFetch(body = 'ns:http://specs.openid.net/auth/2.0\nis_valid:true\n', status = 200) {
  const calls: { url: string; body: URLSearchParams }[] = [];
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), body: new URLSearchParams(String(init?.body)) });
    return new Response(body, { status });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

describe('Steam OpenID 2.0', () => {
  it('builds the authorize URL with identifier_select, return_to and realm', () => {
    const u = new URL(steamAuthorizeUrl(RETURN_TO, 'https://ficsmap.test/'));
    expect(u.origin + u.pathname).toBe(STEAM_OPENID);
    expect(Object.fromEntries(u.searchParams)).toEqual({
      'openid.ns': 'http://specs.openid.net/auth/2.0',
      'openid.mode': 'checkid_setup',
      'openid.return_to': RETURN_TO,
      'openid.realm': 'https://ficsmap.test/',
      'openid.identity': 'http://specs.openid.net/auth/2.0/identifier_select',
      'openid.claimed_id': 'http://specs.openid.net/auth/2.0/identifier_select',
    });
  });

  it('accepts a valid assertion after Steam confirms it, sending every openid field back with check_authentication', async () => {
    const { fn, calls } = steamFetch();
    expect(await verifySteamAssertion(assertion(), RETURN_TO, fn, NOW)).toBe(STEAM_ID);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(STEAM_OPENID);
    const sent = Object.fromEntries(calls[0]!.body);
    expect(sent['openid.mode']).toBe('check_authentication');
    expect(sent['openid.sig']).toBe('c2lnbmF0dXJl');
    expect(sent['openid.claimed_id']).toBe(`https://steamcommunity.com/openid/id/${STEAM_ID}`);
    expect(sent).not.toHaveProperty('state');
  });

  const rejected: [string, Record<string, string | undefined>][] = [
    ['another mode', { 'openid.mode': 'cancel' }],
    ['another namespace', { 'openid.ns': 'http://openid.net/signon/1.1' }],
    ['another provider', { 'openid.op_endpoint': 'https://evil.example/openid/login' }],
    ['another return_to', { 'openid.return_to': 'https://ficsmap.test/auth/steam/callback?state=other' }],
    ['a return_to of another site', { 'openid.return_to': 'https://evil.example/auth/steam/callback?state=abc' }],
    ['a claimed_id that is no Steam id', { 'openid.claimed_id': 'https://evil.example/openid/id/76561197960287930', 'openid.identity': 'https://evil.example/openid/id/76561197960287930' }],
    ['a short steam id', { 'openid.claimed_id': 'https://steamcommunity.com/openid/id/123', 'openid.identity': 'https://steamcommunity.com/openid/id/123' }],
    ['http instead of https', { 'openid.claimed_id': `http://steamcommunity.com/openid/id/${STEAM_ID}`, 'openid.identity': `http://steamcommunity.com/openid/id/${STEAM_ID}` }],
    ['identity other than claimed_id', { 'openid.identity': 'https://steamcommunity.com/openid/id/76561197960287931' }],
    ['claimed_id not signed', { 'openid.signed': 'signed,op_endpoint,identity,return_to,response_nonce,assoc_handle' }],
    ['return_to not signed', { 'openid.signed': 'signed,op_endpoint,claimed_id,identity,response_nonce,assoc_handle' }],
    ['no signature', { 'openid.sig': undefined }],
    ['an old nonce', { 'openid.response_nonce': '2026-11-28T11:50:00Zx' }],
    ['a malformed nonce', { 'openid.response_nonce': 'yesterday' }],
  ];
  for (const [what, over] of rejected) {
    it(`rejects ${what} without asking Steam`, async () => {
      const { fn, calls } = steamFetch();
      await expect(verifySteamAssertion(assertion(over), RETURN_TO, fn, NOW)).rejects.toBeInstanceOf(SteamAuthError);
      expect(calls).toHaveLength(0);
    });
  }

  it('rejects repeated fields (arrays) in the query', async () => {
    const { fn } = steamFetch();
    const q = { ...assertion(), 'openid.claimed_id': [`https://steamcommunity.com/openid/id/${STEAM_ID}`, 'x'] } as unknown as Record<string, string>;
    await expect(verifySteamAssertion(q, RETURN_TO, fn, NOW)).rejects.toBeInstanceOf(SteamAuthError);
  });

  it('rejects when Steam does not confirm the assertion or fails', async () => {
    for (const [body, status] of [['ns:http://specs.openid.net/auth/2.0\nis_valid:false\n', 200], ['is_valid:true', 500], ['is_valid:truex\n', 200]] as const) {
      const { fn } = steamFetch(body, status);
      await expect(verifySteamAssertion(assertion(), RETURN_TO, fn, NOW)).rejects.toBeInstanceOf(SteamAuthError);
    }
  });

  describe('profile', () => {
    it('is null without STEAM_API_KEY and asks nobody', async () => {
      const fn = vi.fn() as unknown as typeof fetch;
      const client = createSteamClient({ ...testConfig, steamApiKey: null }, fn);
      expect(await client.profile(STEAM_ID)).toBeNull();
      expect(fn).not.toHaveBeenCalled();
    });
    it('reads name and avatar from GetPlayerSummaries with the key', async () => {
      const urls: string[] = [];
      const fn = vi.fn(async (url: string | URL | Request) => {
        urls.push(String(url));
        return Response.json({ response: { players: [{ steamid: STEAM_ID, personaname: 'Pioneer', avatarmedium: 'https://avatars.steamstatic.com/x_medium.jpg' }] } });
      }) as unknown as typeof fetch;
      const client = createSteamClient({ ...testConfig, steamApiKey: 'KEY' }, fn);
      expect(await client.profile(STEAM_ID)).toEqual({ name: 'Pioneer', avatarUrl: 'https://avatars.steamstatic.com/x_medium.jpg' });
      const u = new URL(urls[0]!);
      expect(u.origin + u.pathname).toBe('https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/');
      expect(u.searchParams.get('steamids')).toBe(STEAM_ID);
      expect(u.searchParams.get('key')).toBe('KEY');
    });
    it('is null when the Web API fails or knows no such player', async () => {
      for (const res of [new Response('x', { status: 403 }), Response.json({ response: { players: [] } })]) {
        const client = createSteamClient({ ...testConfig, steamApiKey: 'KEY' }, (async () => res) as unknown as typeof fetch);
        expect(await client.profile(STEAM_ID)).toBeNull();
      }
    });
  });
});
