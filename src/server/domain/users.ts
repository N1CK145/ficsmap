import type { Db } from '../db/db.js';
import type { IdentityDto, LoginProvider } from '../../shared/api.js';
import { cleanPrefs, type UserPrefs } from '../../shared/prefs.js';

export interface UserRow {
  id: number;
  display_name: string;
  avatar_url: string | null;
  email: string | null;
  email_verified: 0 | 1;
}

/** Who signed in, in the same shape for every provider (`identities.provider`, `identities.subject`). */
export interface LoginProfile {
  provider: LoginProvider;
  /** The provider's stable id: Discord user id, SteamID64. */
  subject: string;
  /** The account name at the provider (Discord username, Steam persona name), if known. */
  username: string | null;
  /** The name to show; null when the provider gave none (Steam without STEAM_API_KEY): an existing name stays. */
  displayName: string | null;
  avatarUrl: string | null;
  /** A verified e-mail, null for none; left out by providers that never have one (Steam), which keeps the stored one. */
  email?: string | null;
}

/** The allowlists of server owners per provider (OWNER_DISCORD_IDS, OWNER_STEAM_IDS). */
export interface ServerOwners { ownerDiscordIds: Set<string>; ownerSteamIds: Set<string> }

export function isOwnerIdentity(owners: ServerOwners, provider: LoginProvider, subject: string): boolean {
  return (provider === 'discord' ? owners.ownerDiscordIds : owners.ownerSteamIds).has(subject);
}

export type LoginOutcome = { kind: 'ok'; userId: number; created: boolean } | { kind: 'invite_only' };

export interface FindOrCreateOpts {
  owners: ServerOwners;
  /** True when a verified invite token allows creating the account. */
  allowCreate: boolean;
  now: number;
}

/** Refreshes the account from a sign-in: name and avatar when the provider gave a name, e-mail when it knows one. */
function refreshUser(db: Db, userId: number, p: LoginProfile, now: number): void {
  if (p.displayName !== null) {
    db.prepare('UPDATE users SET display_name = ?, avatar_url = ? WHERE id = ?').run(p.displayName, p.avatarUrl, userId);
  }
  if (p.email !== undefined) {
    db.prepare('UPDATE users SET email = ?, email_verified = ? WHERE id = ?').run(p.email, p.email ? 1 : 0, userId);
  }
  db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(now, userId);
}

function insertIdentity(db: Db, userId: number, p: LoginProfile, now: number): void {
  db.prepare(
    `INSERT INTO identities(user_id, provider, subject, username, email, email_verified, created_at, last_login_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(userId, p.provider, p.subject, p.username, p.email ?? null, p.email ? 1 : 0, now, now);
}

/** Runs its writes in one transaction; nested inside the caller's transaction it joins it. */
export function findOrCreateUser(db: Db, p: LoginProfile, opts: FindOrCreateOpts): LoginOutcome {
  return db.transaction((): LoginOutcome => {
    const existing = db.prepare('SELECT user_id FROM identities WHERE provider = ? AND subject = ?')
      .get(p.provider, p.subject) as { user_id: number } | undefined;
    if (existing) {
      refreshUser(db, existing.user_id, p, opts.now);
      db.prepare(
        `UPDATE identities SET username = coalesce(?, username), email = ?, email_verified = ?, last_login_at = ?
         WHERE provider = ? AND subject = ?`,
      ).run(p.username, p.email ?? null, p.email ? 1 : 0, opts.now, p.provider, p.subject);
      return { kind: 'ok', userId: existing.user_id, created: false };
    }
    if (!opts.allowCreate && !isOwnerIdentity(opts.owners, p.provider, p.subject)) return { kind: 'invite_only' };
    const email = p.email ?? null;
    const userId = Number(db.prepare(
      `INSERT INTO users(display_name, avatar_url, email, email_verified, created_at, last_login_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(p.displayName ?? p.username ?? p.subject, p.avatarUrl, email, email ? 1 : 0, opts.now, opts.now).lastInsertRowid);
    insertIdentity(db, userId, p, opts.now);
    return { kind: 'ok', userId, created: true };
  })();
}

export type LinkOutcome = 'linked' | 'already' | 'taken' | 'provider_taken';

/**
 * Adds a sign-in to an existing account (the user signed in with the other provider while logged in): `linked`;
 * `already` when it is linked to this account; `taken` when another account signs in with it; `provider_taken` when
 * this account already has a different one of that provider (unlink it first).
 */
export function linkIdentity(db: Db, userId: number, p: LoginProfile, now: number): LinkOutcome {
  return db.transaction((): LinkOutcome => {
    const owner = db.prepare('SELECT user_id FROM identities WHERE provider = ? AND subject = ?')
      .get(p.provider, p.subject) as { user_id: number } | undefined;
    if (owner) return owner.user_id === userId ? 'already' : 'taken';
    if (db.prepare('SELECT 1 FROM identities WHERE user_id = ? AND provider = ?').get(userId, p.provider)) return 'provider_taken';
    insertIdentity(db, userId, p, now);
    return 'linked';
  })();
}

/** Removes the account's sign-in with `provider`: `none` without one, `last` when it is the only way in (kept). */
export function unlinkIdentity(db: Db, userId: number, provider: LoginProvider): 'ok' | 'none' | 'last' {
  return db.transaction(() => {
    const rows = db.prepare('SELECT provider FROM identities WHERE user_id = ?').all(userId) as { provider: string }[];
    if (!rows.some(r => r.provider === provider)) return 'none';
    if (rows.length === 1) return 'last';
    db.prepare('DELETE FROM identities WHERE user_id = ? AND provider = ?').run(userId, provider);
    return 'ok';
  })();
}

/** The account's sign-ins, for its own profile page. */
export function listIdentities(db: Db, userId: number): IdentityDto[] {
  const rows = db.prepare('SELECT provider, subject, username FROM identities WHERE user_id = ? ORDER BY provider')
    .all(userId) as { provider: LoginProvider; subject: string; username: string | null }[];
  return rows.map(r => ({ provider: r.provider, subject: r.subject, name: r.username }));
}

/** True when one of the user's identities is on an owner allowlist (a server owner, not a world owner). */
export function isServerOwner(db: Db, owners: ServerOwners, userId: number): boolean {
  if (owners.ownerDiscordIds.size === 0 && owners.ownerSteamIds.size === 0) return false;
  const rows = db.prepare('SELECT provider, subject FROM identities WHERE user_id = ?')
    .all(userId) as { provider: LoginProvider; subject: string }[];
  return rows.some(r => isOwnerIdentity(owners, r.provider, r.subject));
}

/** The user's stored preferences; invalid or unknown stored keys are left out. */
export function getPrefs(db: Db, userId: number): UserPrefs {
  const row = db.prepare('SELECT prefs FROM users WHERE id = ?').get(userId) as { prefs: string } | undefined;
  if (!row) return {};
  try {
    return cleanPrefs(JSON.parse(row.prefs));
  } catch {
    return {};
  }
}

/** Merges `patch` (already validated) into the stored preferences and returns the result. */
export function updatePrefs(db: Db, userId: number, patch: UserPrefs): UserPrefs {
  return db.transaction(() => {
    const prefs = cleanPrefs({ ...getPrefs(db, userId), ...patch });
    db.prepare('UPDATE users SET prefs = ? WHERE id = ?').run(JSON.stringify(prefs), userId);
    return prefs;
  })();
}
