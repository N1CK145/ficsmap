import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { AppDeps } from '../app.js';
import { discordLoginProfile, type DiscordProfile } from '../auth/discord.js';
import { createSteamClient } from '../auth/steam.js';
import { createSession, deleteSession, SESSION_TTL_MS } from '../auth/session.js';
import { acceptInvite, consumeInvite, findInvite } from '../domain/invites.js';
import { findOrCreateUser, isOwnerIdentity, linkIdentity, type LoginProfile } from '../domain/users.js';

export interface OauthTx {
  state: string;
  returnTo: string;
  inviteToken?: string | undefined;
  verifier: string;
  /** Set when a signed-in user adds this provider to their account (`?link=1`) instead of signing in. */
  linkUserId?: number | undefined;
}

const txSchema = z.object({
  state: z.string().min(1), returnTo: z.string(), inviteToken: z.string().optional(), verifier: z.string().min(1),
  linkUserId: z.number().int().positive().optional(),
});
const TX_MAX_AGE_S = 600;
const authLimit = { rateLimit: { max: 10, timeWindow: '1 minute' } };

const PRINTABLE_ASCII = /^[\x21-\x7e]+$/;
const MAX_INVITE_LENGTH = 64; // invite tokens are 43 characters
const MAX_RETURN_TO_LENGTH = 2048;

/** Only same-origin absolute paths; anything a browser could reinterpret (control chars, `\`, `//`) becomes `/`. */
export function safeReturnTo(v: unknown, publicUrl: string): string {
  if (typeof v !== 'string' || v.length > MAX_RETURN_TO_LENGTH || !v.startsWith('/') || !PRINTABLE_ASCII.test(v)) return '/';
  try {
    if (!PRINTABLE_ASCII.test(decodeURIComponent(v))) return '/';
    const base = new URL(publicUrl);
    const u = new URL(v, base);
    if (u.origin !== base.origin) return '/';
    // Dot-segment normalisation can yield `//host` or `/\host`, which browsers read as scheme-relative.
    const out = u.pathname + u.search + u.hash;
    if (!/^\/(?![/\\])/.test(out)) return '/';
    return new URL(out, base).origin === base.origin ? out : '/';
  } catch {
    return '/';
  }
}

export type LoginResolution =
  | { kind: 'ok'; userId: number; redirectTo: string }
  | { kind: 'invite_only' }
  | { kind: 'invite_invalid' };

/**
 * Account-resolution step of the callback. With an invite, looking it up, finding or creating the user and using the
 * invite share one transaction (spec §8), so an account is only created together with a link that is still open.
 */
export async function resolveLogin(deps: AppDeps, profile: LoginProfile, tx: OauthTx): Promise<LoginResolution> {
  const { db, config } = deps;
  const now = (deps.now ?? Date.now)();
  const base = { owners: config, now };
  const token = tx.inviteToken;
  if (!token) {
    const outcome = findOrCreateUser(db, profile, { ...base, allowCreate: false });
    return outcome.kind === 'ok' ? { kind: 'ok', userId: outcome.userId, redirectTo: tx.returnTo } : outcome;
  }

  const invitePage = `/invite/${encodeURIComponent(token)}`;
  let joinedWorld: string | undefined;
  const result = db.transaction((): LoginResolution => {
    const invite = findInvite(db, token, now, config);
    const outcome = findOrCreateUser(db, profile, { ...base, allowCreate: invite !== null });
    if (outcome.kind !== 'ok') return { kind: 'invite_invalid' };
    // An existing account with a stale link ends on its "no longer valid" page.
    if (!invite) return { kind: 'ok', userId: outcome.userId, redirectTo: invitePage };
    if (invite.worldId === null) {
      // A general invite is used up only by the account it created; allowlisted owners leave it for someone else.
      if (outcome.created && !isOwnerIdentity(config, profile.provider, profile.subject)) consumeInvite(db, invite);
      return { kind: 'ok', userId: outcome.userId, redirectTo: '/' };
    }
    const accepted = acceptInvite(db, outcome.userId, invite, now);
    if (accepted.kind === 'invalid') return { kind: 'ok', userId: outcome.userId, redirectTo: invitePage };
    if (accepted.kind === 'joined') joinedWorld = accepted.worldId;
    const flag = accepted.kind === 'joined' ? 'joined' : 'already';
    return { kind: 'ok', userId: outcome.userId, redirectTo: `/w/${accepted.worldId}?${flag}=1` };
  })();
  if (joinedWorld) deps.hub?.broadcast(joinedWorld, { type: 'members' });
  return result;
}

const same = (a: string, b: string): boolean => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

export function registerAuthRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { config, db } = deps;
  /** The signed oauth_tx cookie, or undefined when missing, tampered or malformed. */
  const readTx = (raw: string | undefined): OauthTx | undefined => {
    const unsigned = raw ? app.unsignCookie(raw) : undefined;
    if (!unsigned?.valid || unsigned.value === null) return undefined;
    try {
      return txSchema.parse(JSON.parse(unsigned.value));
    } catch {
      return undefined;
    }
  };
  const now = deps.now ?? Date.now;
  const cookieBase = { httpOnly: true, secure: config.cookieSecure, sameSite: 'lax' as const };
  const clearTx = (reply: FastifyReply) => reply.clearCookie('oauth_tx', { ...cookieBase, path: '/auth' });

  const steam = deps.steam ?? createSteamClient(config);
  const publicBase = config.publicUrl.replace(/\/$/, '');
  const steamReturnTo = (state: string) => `${publicBase}/auth/steam/callback?state=${encodeURIComponent(state)}`;

  /**
   * The transaction of a sign-in that is starting, stored in the signed `oauth_tx` cookie until the provider calls
   * back; undefined (after redirecting) for an invite token that cannot be one. `?link=1` from a signed-in user adds
   * the provider to their account instead of signing in.
   */
  const startTx = (req: FastifyRequest, reply: FastifyReply): OauthTx | undefined => {
    const q = req.query as { returnTo?: unknown; invite?: unknown; link?: unknown };
    if (typeof q.invite === 'string' && q.invite.length > MAX_INVITE_LENGTH) {
      void reply.redirect('/login?error=invite_invalid', 302);
      return undefined;
    }
    const tx: OauthTx = {
      state: randomBytes(24).toString('base64url'),
      returnTo: safeReturnTo(q.returnTo, config.publicUrl),
      verifier: randomBytes(32).toString('base64url'),
    };
    if (q.link === '1' && req.user) tx.linkUserId = req.user.id;
    else if (typeof q.invite === 'string' && q.invite) tx.inviteToken = q.invite;
    reply.setCookie('oauth_tx', JSON.stringify(tx), { ...cookieBase, path: '/auth', maxAge: TX_MAX_AGE_S, signed: true });
    return tx;
  };

  /** Ends a failed or cancelled callback: back to the profile when linking, the invite page or the login page. */
  const failWith = (reply: FastifyReply, tx: OauthTx | undefined, error: string) => {
    clearTx(reply);
    if (tx?.linkUserId !== undefined) return reply.redirect(`/profile?link_error=${error}`, 302);
    // With an invite, a cancel or a provider failure goes back to the invite page (sign-in button again),
    // so the invite is not lost; nothing was written and the token stays valid.
    const invite = error === 'cancelled' || error === 'failed' ? tx?.inviteToken : undefined;
    return reply.redirect(invite ? `/invite/${encodeURIComponent(invite)}` : `/login?error=${error}`, 302);
  };

  /** The provider confirmed `profile`: links it to the signed-in account, or signs in (creating it with an invite). */
  const finish = async (req: FastifyRequest, reply: FastifyReply, tx: OauthTx, profile: LoginProfile) => {
    if (tx.linkUserId !== undefined) {
      // Only the user who started linking, still signed in, may complete it.
      if (req.user?.id !== tx.linkUserId) return failWith(reply, tx, 'expired');
      const linked = linkIdentity(db, tx.linkUserId, profile, now());
      clearTx(reply);
      return reply.redirect(linked === 'linked' || linked === 'already' ? `/profile?linked=${profile.provider}` : `/profile?link_error=${linked}`, 302);
    }
    const outcome = await resolveLogin(deps, profile, tx);
    if (outcome.kind !== 'ok') return failWith(reply, tx, outcome.kind);

    const oldSid = req.cookies.sid;
    if (oldSid) deleteSession(db, oldSid);
    const sid = createSession(db, outcome.userId, now());
    clearTx(reply);
    reply.setCookie('sid', sid, { ...cookieBase, path: '/', maxAge: SESSION_TTL_MS / 1000 });
    return reply.redirect(outcome.redirectTo, 302);
  };

  app.get('/auth/login', { config: authLimit }, async (req, reply) => {
    const tx = startTx(req, reply);
    if (!tx) return reply;
    const challenge = createHash('sha256').update(tx.verifier).digest('base64url');
    return reply.redirect(deps.discord.authorizeUrl(tx.state, challenge), 302);
  });

  app.get('/auth/discord/callback', { config: authLimit }, async (req, reply) => {
    const q = req.query as { code?: unknown; state?: unknown; error?: unknown };
    const tx = readTx(req.cookies.oauth_tx);
    if (typeof q.error === 'string') return failWith(reply, tx, 'cancelled');
    if (!tx) return failWith(reply, tx, 'expired');
    if (typeof q.state !== 'string' || typeof q.code !== 'string' || !q.code || !same(q.state, tx.state)) {
      return failWith(reply, tx, 'expired');
    }

    let profile: DiscordProfile;
    try {
      profile = await deps.discord.exchangeCode(q.code, tx.verifier);
    } catch (err) {
      req.log.error({ err }, 'discord code exchange failed');
      return failWith(reply, tx, 'failed');
    }
    return finish(req, reply, tx, discordLoginProfile(profile));
  });

  // Sign-in with Steam (OpenID 2.0, src/server/auth/steam.ts). The state travels in return_to and must match the cookie.
  app.get('/auth/steam/login', { config: authLimit }, async (req, reply) => {
    const tx = startTx(req, reply);
    if (!tx) return reply;
    return reply.redirect(steam.authorizeUrl(steamReturnTo(tx.state), `${new URL(config.publicUrl).origin}/`), 302);
  });

  app.get('/auth/steam/callback', { config: authLimit }, async (req, reply) => {
    const q = req.query as Record<string, unknown>;
    const tx = readTx(req.cookies.oauth_tx);
    if (q['openid.mode'] === 'cancel') return failWith(reply, tx, 'cancelled');
    if (!tx || typeof q.state !== 'string' || !same(q.state, tx.state)) return failWith(reply, tx, 'expired');

    let steamId: string;
    try {
      steamId = await steam.verify(q, steamReturnTo(tx.state));
    } catch (err) {
      req.log.warn({ err }, 'steam assertion rejected');
      return failWith(reply, tx, 'failed');
    }
    const player = await steam.profile(steamId);
    return finish(req, reply, tx, {
      provider: 'steam', subject: steamId, username: player?.name ?? null, displayName: player?.name ?? null, avatarUrl: player?.avatarUrl ?? null,
    });
  });

  app.post('/auth/logout', { config: authLimit }, async (req, reply) => {
    const sid = req.cookies.sid;
    if (sid) deleteSession(db, sid);
    if (req.user) deps.hub?.closeUserEverywhere(req.user.id);
    reply.clearCookie('sid', { ...cookieBase, path: '/' });
    return reply.code(204).send();
  });
}
