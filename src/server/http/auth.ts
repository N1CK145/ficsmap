import type { FastifyInstance, FastifyReply } from 'fastify';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { AppDeps } from '../app.js';
import type { DiscordProfile } from '../auth/discord.js';
import { createSession, deleteSession, SESSION_TTL_MS } from '../auth/session.js';
import { acceptInvite } from '../domain/invites.js';
import { findOrCreateUser } from '../domain/users.js';

export interface OauthTx {
  state: string;
  returnTo: string;
  inviteToken?: string | undefined;
  verifier: string;
}

const txSchema = z.object({ state: z.string().min(1), returnTo: z.string(), inviteToken: z.string().optional(), verifier: z.string().min(1) });
const TX_MAX_AGE_S = 600;
const authLimit = { rateLimit: { max: 10, timeWindow: '1 minute' } };

const PRINTABLE_ASCII = /^[\x21-\x7e]+$/;
const MAX_INVITE_LENGTH = 2048;
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

/** Thrown inside the login transaction to undo a just-created account whose invite turned out unusable. */
class Rollback extends Error {}

/**
 * Account-resolution step of the callback. With an invite, the user lookup/creation and the invite
 * acceptance share one transaction (spec §8); the JWT is verified before it (async).
 */
export async function resolveLogin(deps: AppDeps, profile: DiscordProfile, tx: OauthTx): Promise<LoginResolution> {
  const now = (deps.now ?? Date.now)();
  const base = { ownerIds: deps.config.ownerDiscordIds, now };
  if (!tx.inviteToken) {
    const outcome = findOrCreateUser(deps.db, profile, { ...base, allowCreate: false });
    return outcome.kind === 'ok' ? { kind: 'ok', userId: outcome.userId, redirectTo: tx.returnTo } : outcome;
  }

  const claims = await deps.invites!.verify(tx.inviteToken);
  const invitePage = `/invite/${encodeURIComponent(tx.inviteToken)}`;
  let result: LoginResolution | undefined;
  let joinedWorld: string | undefined;
  try {
    deps.db.transaction(() => {
      const outcome = findOrCreateUser(deps.db, profile, { ...base, allowCreate: claims !== null });
      if (outcome.kind !== 'ok') {
        result = { kind: 'invite_invalid' };
        return;
      }
      if (!claims) {
        result = { kind: 'ok', userId: outcome.userId, redirectTo: invitePage };
        return;
      }
      const accepted = acceptInvite(deps.db, outcome.userId, claims, now);
      if (accepted.kind === 'invalid') {
        // Only an account that exists solely because of this invite is undone; allowlisted owners stay.
        if (outcome.created && !deps.config.ownerDiscordIds.has(profile.id)) throw new Rollback();
        result = { kind: 'ok', userId: outcome.userId, redirectTo: invitePage };
        return;
      }
      if (accepted.kind === 'joined') joinedWorld = accepted.worldId;
      const flag = accepted.kind === 'joined' ? 'joined' : 'already';
      result = { kind: 'ok', userId: outcome.userId, redirectTo: `/w/${accepted.worldId}?${flag}=1` };
    })();
  } catch (err) {
    if (err instanceof Rollback) return { kind: 'invite_invalid' };
    throw err;
  }
  if (joinedWorld) deps.hub?.broadcast(joinedWorld, { type: 'members' });
  return result!;
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

  app.get('/auth/login', { config: authLimit }, async (req, reply) => {
    const q = req.query as { returnTo?: unknown; invite?: unknown };
    if (typeof q.invite === 'string' && q.invite.length > MAX_INVITE_LENGTH) {
      return reply.redirect('/login?error=invite_invalid', 302);
    }
    const tx: OauthTx = {
      state: randomBytes(24).toString('base64url'),
      returnTo: safeReturnTo(q.returnTo, config.publicUrl),
      verifier: randomBytes(32).toString('base64url'),
    };
    if (typeof q.invite === 'string' && q.invite) tx.inviteToken = q.invite;
    const challenge = createHash('sha256').update(tx.verifier).digest('base64url');
    reply.setCookie('oauth_tx', JSON.stringify(tx), { ...cookieBase, path: '/auth', maxAge: TX_MAX_AGE_S, signed: true });
    return reply.redirect(deps.discord.authorizeUrl(tx.state, challenge), 302);
  });

  app.get('/auth/discord/callback', { config: authLimit }, async (req, reply) => {
    const q = req.query as { code?: unknown; state?: unknown; error?: unknown };
    const tx = readTx(req.cookies.oauth_tx);
    const fail = (error: string) => {
      clearTx(reply);
      // With an invite, a cancel or a Discord failure goes back to the invite page (sign-in button again),
      // so the invite is not lost; nothing was written and the token stays valid.
      const invite = error === 'cancelled' || error === 'failed' ? tx?.inviteToken : undefined;
      return reply.redirect(invite ? `/invite/${encodeURIComponent(invite)}` : `/login?error=${error}`, 302);
    };

    if (typeof q.error === 'string') return fail('cancelled');
    if (!tx) return fail('expired');
    if (typeof q.state !== 'string' || typeof q.code !== 'string' || !q.code || !same(q.state, tx.state)) {
      return fail('expired');
    }

    let profile: DiscordProfile;
    try {
      profile = await deps.discord.exchangeCode(q.code, tx.verifier);
    } catch (err) {
      req.log.error({ err }, 'discord code exchange failed');
      return fail('failed');
    }
    const outcome = await resolveLogin(deps, profile, tx);
    if (outcome.kind !== 'ok') return fail(outcome.kind);

    const oldSid = req.cookies.sid;
    if (oldSid) deleteSession(db, oldSid);
    const sid = createSession(db, outcome.userId, now());
    clearTx(reply);
    reply.setCookie('sid', sid, { ...cookieBase, path: '/', maxAge: SESSION_TTL_MS / 1000 });
    return reply.redirect(outcome.redirectTo, 302);
  });

  app.post('/auth/logout', { config: authLimit }, async (req, reply) => {
    const sid = req.cookies.sid;
    if (sid) deleteSession(db, sid);
    if (req.user) deps.hub?.closeUserEverywhere(req.user.id);
    reply.clearCookie('sid', { ...cookieBase, path: '/' });
    return reply.code(204).send();
  });
}
