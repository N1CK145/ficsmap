import { z } from 'zod';
import type { Config } from '../config.js';

export interface DiscordProfile {
  id: string;
  username: string;
  globalName: string | null;
  avatar: string | null;
  email: string | null;
  verified: boolean;
}

export interface DiscordClient {
  authorizeUrl(state: string, codeChallenge: string): string;
  exchangeCode(code: string, codeVerifier: string): Promise<DiscordProfile>;
}

const AUTHORIZE_URL = 'https://discord.com/oauth2/authorize';
const TOKEN_URL = 'https://discord.com/api/oauth2/token';
const ME_URL = 'https://discord.com/api/users/@me';

const tokenSchema = z.object({ access_token: z.string().min(1) });
const meSchema = z.object({
  id: z.string().min(1),
  username: z.string(),
  global_name: z.string().nullish(),
  avatar: z.string().nullish(),
  email: z.string().nullish(),
  verified: z.boolean().optional(),
});

export function createDiscordClient(c: Config): DiscordClient {
  const redirectUri = new URL('/auth/discord/callback', c.publicUrl).toString();
  return {
    authorizeUrl(state, codeChallenge) {
      const u = new URL(AUTHORIZE_URL);
      u.search = new URLSearchParams({
        response_type: 'code',
        client_id: c.discordClientId,
        scope: 'identify',
        state,
        redirect_uri: redirectUri,
        prompt: 'none',
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
      }).toString();
      return u.toString();
    },
    async exchangeCode(code, codeVerifier) {
      const signal = AbortSignal.timeout(10_000);
      const tokenRes = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirectUri,
          client_id: c.discordClientId,
          client_secret: c.discordClientSecret,
          code_verifier: codeVerifier,
        }),
        signal,
      });
      if (!tokenRes.ok) throw new Error(`Discord token endpoint returned ${tokenRes.status}`);
      const { access_token } = tokenSchema.parse(await tokenRes.json());
      const meRes = await fetch(ME_URL, { headers: { authorization: `Bearer ${access_token}` }, signal });
      if (!meRes.ok) throw new Error(`Discord /users/@me returned ${meRes.status}`);
      const me = meSchema.parse(await meRes.json());
      // The access token is discarded here and never stored.
      return {
        id: me.id,
        username: me.username,
        globalName: me.global_name ?? null,
        avatar: me.avatar ?? null,
        email: me.email ?? null,
        verified: me.verified === true,
      };
    },
  };
}
