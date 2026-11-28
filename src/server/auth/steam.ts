import { z } from 'zod';
import type { Config } from '../config.js';

/**
 * Sign-in with Steam: OpenID 2.0 against Steam's own provider (no app registration, no secret). Steam sends the
 * browser back to `return_to` with a signed assertion; the server checks its fields and then asks Steam itself
 * (`check_authentication`) whether the signature is valid, so nothing in the query is trusted on its own.
 */
export const STEAM_OPENID = 'https://steamcommunity.com/openid/login';
const OPENID_NS = 'http://specs.openid.net/auth/2.0';
const IDENTIFIER_SELECT = 'http://specs.openid.net/auth/2.0/identifier_select';
/** A SteamID64 as claimed id; https only. */
const CLAIMED_ID = /^https:\/\/steamcommunity\.com\/openid\/id\/(\d{17})$/;
/** Fields the assertion must have signed, or Steam's confirmation would not cover them. */
const MUST_SIGN = ['op_endpoint', 'claimed_id', 'identity', 'return_to', 'response_nonce'];
/** How old (or, for clock skew, how far ahead) the assertion's nonce may be. */
const NONCE_MAX_AGE_MS = 5 * 60_000;
const SUMMARIES_URL = 'https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/';

export class SteamAuthError extends Error {}

export interface SteamPlayer { name: string; avatarUrl: string | null }

export interface SteamClient {
  /** Where to send the browser; Steam comes back to `returnTo` (which must start with `realm`). */
  authorizeUrl(returnTo: string, realm: string): string;
  /** The SteamID64 the assertion in `query` proves, or throws `SteamAuthError`. */
  verify(query: Record<string, unknown>, expectedReturnTo: string): Promise<string>;
  /** Name and avatar from the Steam Web API; null without `STEAM_API_KEY` or when it fails. */
  profile(steamId: string): Promise<SteamPlayer | null>;
}

export function steamAuthorizeUrl(returnTo: string, realm: string): string {
  const u = new URL(STEAM_OPENID);
  u.search = new URLSearchParams({
    'openid.ns': OPENID_NS,
    'openid.mode': 'checkid_setup',
    'openid.return_to': returnTo,
    'openid.realm': realm,
    'openid.identity': IDENTIFIER_SELECT,
    'openid.claimed_id': IDENTIFIER_SELECT,
  }).toString();
  return u.toString();
}

/**
 * Checks a positive assertion from Steam and returns its SteamID64: OpenID 2.0, mode `id_res`, Steam as provider,
 * `return_to` exactly the one this login sent, claimed id and identity the same Steam id, the important fields
 * signed, a fresh nonce, and finally Steam's own `is_valid:true` for the whole assertion.
 */
export async function verifySteamAssertion(
  query: Record<string, unknown>, expectedReturnTo: string, fetchFn: typeof fetch = fetch, now = Date.now(),
): Promise<string> {
  const openid: Record<string, string> = {};
  for (const [k, v] of Object.entries(query)) {
    if (!k.startsWith('openid.')) continue;
    if (typeof v !== 'string') throw new SteamAuthError(`repeated or invalid ${k}`);
    openid[k.slice('openid.'.length)] = v;
  }
  const fail = (why: string): never => { throw new SteamAuthError(why); };
  if (openid.ns !== OPENID_NS) fail('not OpenID 2.0');
  if (openid.mode !== 'id_res') fail(`mode ${openid.mode ?? 'missing'}`);
  if (openid.op_endpoint !== STEAM_OPENID) fail('not Steam');
  if (openid.return_to !== expectedReturnTo) fail('return_to does not match');
  const m = CLAIMED_ID.exec(openid.claimed_id ?? '');
  if (!m) fail('claimed_id is not a Steam id');
  if (openid.identity !== openid.claimed_id) fail('identity differs from claimed_id');
  if (!openid.sig) fail('no signature');
  const signed = new Set((openid.signed ?? '').split(','));
  if (!MUST_SIGN.every(f => signed.has(f))) fail('assertion does not sign its fields');
  const issued = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ)/.exec(openid.response_nonce ?? '');
  const at = issued ? Date.parse(issued[1]!) : NaN;
  if (!Number.isFinite(at) || Math.abs(now - at) > NONCE_MAX_AGE_MS) fail('stale or malformed nonce');

  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(openid)) body.set(`openid.${k}`, k === 'mode' ? 'check_authentication' : v);
  const res = await fetchFn(STEAM_OPENID, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) fail(`check_authentication returned ${res.status}`);
  const lines = (await res.text()).split('\n').map(l => l.trim());
  if (!lines.includes('is_valid:true')) fail('Steam did not confirm the assertion');
  return m![1]!;
}

const summariesSchema = z.object({
  response: z.object({
    players: z.array(z.object({ steamid: z.string(), personaname: z.string().min(1), avatarmedium: z.string().nullish() })),
  }),
});

export function createSteamClient(c: Pick<Config, 'steamApiKey'>, fetchFn: typeof fetch = fetch): SteamClient {
  return {
    authorizeUrl: steamAuthorizeUrl,
    verify: (query, expectedReturnTo) => verifySteamAssertion(query, expectedReturnTo, fetchFn),
    async profile(steamId) {
      if (!c.steamApiKey) return null;
      try {
        const u = new URL(SUMMARIES_URL);
        u.search = new URLSearchParams({ key: c.steamApiKey, steamids: steamId }).toString();
        const res = await fetchFn(u, { signal: AbortSignal.timeout(10_000) });
        if (!res.ok) return null;
        const player = summariesSchema.parse(await res.json()).response.players.find(p => p.steamid === steamId);
        return player ? { name: player.personaname, avatarUrl: player.avatarmedium ?? null } : null;
      } catch {
        return null;
      }
    },
  };
}
