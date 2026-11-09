import { createHash, randomBytes } from 'node:crypto';
import type { Db } from '../db/db.js';
import { isServerOwner } from './users.js';
import { bumpRev } from './worlds.js';

/**
 * Invite links (`/invite/<token>`) carry a random one-time token. Only its SHA-256 is stored in `invites`; using the
 * link deletes the row, so it works once. A world invite (`world_id` set) joins that world and creates the account if
 * needed; a general invite (`world_id` null, from a server owner in OWNER_DISCORD_IDS) only creates the account.
 */
export interface Invite {
  /** SHA-256 of the token, the row's key. */
  hash: Buffer;
  /** null for a general invite. */
  worldId: string | null;
  createdBy: number;
  expiresAt: number;
}

export type AcceptResult =
  | { kind: 'joined'; worldId: string }
  | { kind: 'already'; worldId: string }
  | { kind: 'invalid' };

export const INVITE_TTL_MS = 7 * 24 * 3600 * 1000;
/** 32 random bytes, Base64url without padding. */
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

const hashToken = (token: string): Buffer => createHash('sha256').update(token).digest();

/** A new link token for a world (or, with `worldId` null, a general invite), valid for 7 days. */
export function createInvite(db: Db, o: { worldId: string | null; createdBy: number; now: number }): { token: string; expiresAt: number } {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = o.now + INVITE_TTL_MS;
  db.prepare('INSERT INTO invites(token_hash, world_id, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?)')
    .run(hashToken(token), o.worldId, o.createdBy, o.now, expiresAt);
  return { token, expiresAt };
}

/**
 * The invite behind `token` while it can still be used: not used, not expired, not revoked, and for a general invite
 * its creator still a server owner (taking someone off OWNER_DISCORD_IDS invalidates the links they handed out).
 */
export function findInvite(db: Db, token: string, now: number, ownerIds: Set<string>): Invite | null {
  if (!TOKEN_RE.test(token)) return null;
  const hash = hashToken(token);
  const row = db.prepare('SELECT world_id, created_by, expires_at FROM invites WHERE token_hash = ? AND expires_at > ?')
    .get(hash, now) as { world_id: string | null; created_by: number; expires_at: number } | undefined;
  if (!row) return null;
  if (row.world_id === null && !isServerOwner(db, ownerIds, row.created_by)) return null;
  return { hash, worldId: row.world_id, createdBy: row.created_by, expiresAt: row.expires_at };
}

/** Uses the invite up. Sync; call inside the transaction that acts on it, so a failure keeps the link. */
export function consumeInvite(db: Db, invite: Invite): void {
  db.prepare('DELETE FROM invites WHERE token_hash = ?').run(invite.hash);
}

/**
 * Joins `userId` to the invite's world and uses the link up; the owner and members get `already` and leave it for
 * someone else. Sync; call inside `db.transaction`, after `findInvite` in the same transaction.
 */
export function acceptInvite(db: Db, userId: number, invite: Invite, now: number): AcceptResult {
  const worldId = invite.worldId;
  if (worldId === null) return { kind: 'invalid' };
  const isMember = db.prepare('SELECT 1 FROM world_members WHERE world_id = ? AND user_id = ?').get(worldId, userId);
  const isOwner = db.prepare('SELECT 1 FROM worlds WHERE id = ? AND owner_id = ?').get(worldId, userId);
  if (isOwner || isMember) return { kind: 'already', worldId };
  consumeInvite(db, invite);
  db.prepare("INSERT INTO world_members(world_id, user_id, joined_at, joined_via) VALUES (?, ?, ?, 'invite')")
    .run(worldId, userId, now);
  bumpRev(db, worldId);
  return { kind: 'joined', worldId };
}

/** Invalidates every open link of the world; returns how many there were. */
export function revokeInvites(db: Db, worldId: string): number {
  return db.prepare('DELETE FROM invites WHERE world_id = ?').run(worldId).changes;
}

export function purgeInvites(db: Db, now: number): number {
  return db.prepare('DELETE FROM invites WHERE expires_at <= ?').run(now).changes;
}
