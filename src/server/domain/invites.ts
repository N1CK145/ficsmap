import { randomBytes } from 'node:crypto';
import { jwtVerify, SignJWT } from 'jose';
import type { Db } from '../db/db.js';
import { bumpRev, getWorld } from './worlds.js';

export interface InviteClaims { worldId: string; jti: string; ep: number; exp: number }
export interface InviteService {
  sign(worldId: string, epoch: number): Promise<{ token: string; expiresAt: number }>;
  verify(token: string): Promise<InviteClaims | null>;
}

export type AcceptResult =
  | { kind: 'joined'; worldId: string }
  | { kind: 'already'; worldId: string }
  | { kind: 'invalid' };

const AUDIENCE = 'ficsmap:invite';
/** Shared by jwtVerify and the invite_uses retention: a used jti must outlive the window in which its token still verifies. */
export const INVITE_CLOCK_TOLERANCE_S = 60;
const TTL_S = 7 * 24 * 3600;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;

/** The link token is the compact JWT, Base64url-encoded once more (URL-safe, no padding). */
export function encodeInviteToken(jwt: string): string {
  return Buffer.from(jwt, 'utf8').toString('base64url');
}

/** The JWT inside a link token, or null when it is not canonical Base64url. */
export function decodeInviteToken(token: string): string | null {
  if (!BASE64URL_RE.test(token)) return null;
  const jwt = Buffer.from(token, 'base64url').toString('utf8');
  // Node's decoder skips junk; only the one canonical spelling of a token is accepted.
  return encodeInviteToken(jwt) === token ? jwt : null;
}

export function createInviteService(o: { secret: string; issuer: string; now: () => number }): InviteService {
  const key = new TextEncoder().encode(o.secret);
  return {
    async sign(worldId, epoch) {
      const iat = Math.floor(o.now() / 1000);
      const jwt = await new SignJWT({ ep: epoch })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(worldId)
        .setJti(randomBytes(16).toString('base64url'))
        .setIssuedAt(iat)
        .setExpirationTime(iat + TTL_S)
        .setIssuer(o.issuer)
        .setAudience(AUDIENCE)
        .sign(key);
      return { token: encodeInviteToken(jwt), expiresAt: (iat + TTL_S) * 1000 };
    },
    async verify(token) {
      const jwt = decodeInviteToken(token);
      if (jwt === null) return null;
      try {
        const { payload } = await jwtVerify(jwt, key, {
          algorithms: ['HS256'],
          issuer: o.issuer,
          audience: AUDIENCE,
          clockTolerance: INVITE_CLOCK_TOLERANCE_S,
          currentDate: new Date(o.now()),
          requiredClaims: ['sub', 'jti', 'exp'],
        });
        const { sub, jti, exp, ep } = payload as { sub?: unknown; jti?: unknown; exp?: unknown; ep?: unknown };
        if (typeof sub !== 'string' || !UUID_RE.test(sub)) return null;
        if (typeof jti !== 'string' || typeof exp !== 'number') return null;
        if (typeof ep !== 'number' || !Number.isInteger(ep)) return null;
        return { worldId: sub, jti, ep, exp };
      } catch {
        return null;
      }
    },
  };
}

/** Sync; call inside `db.transaction` so a failure after the `invite_uses` insert rolls it back. */
export function acceptInvite(db: Db, userId: number, c: InviteClaims, now: number): AcceptResult {
  const world = getWorld(db, c.worldId);
  if (!world || world.invite_epoch !== c.ep) return { kind: 'invalid' };
  const isMember = db.prepare('SELECT 1 FROM world_members WHERE world_id = ? AND user_id = ?').get(c.worldId, userId);
  if (world.owner_id === userId || isMember) return { kind: 'already', worldId: c.worldId };
  const used = db.prepare(
    'INSERT INTO invite_uses(jti, world_id, user_id, used_at, expires_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(jti) DO NOTHING',
  ).run(c.jti, c.worldId, userId, now, (c.exp + INVITE_CLOCK_TOLERANCE_S) * 1000);
  if (used.changes === 0) return { kind: 'invalid' };
  db.prepare("INSERT INTO world_members(world_id, user_id, joined_at, joined_via) VALUES (?, ?, ?, 'invite')")
    .run(c.worldId, userId, now);
  bumpRev(db, c.worldId);
  return { kind: 'joined', worldId: c.worldId };
}

/** Invalidates every link not yet used; returns the new epoch. */
export function revokeInvites(db: Db, worldId: string): number {
  const r = db.prepare('UPDATE worlds SET invite_epoch = invite_epoch + 1 WHERE id = ? RETURNING invite_epoch')
    .get(worldId) as { invite_epoch: number } | undefined;
  return r?.invite_epoch ?? 0;
}

export function purgeInviteUses(db: Db, now: number): number {
  return db.prepare('DELETE FROM invite_uses WHERE expires_at < ?').run(now).changes;
}
