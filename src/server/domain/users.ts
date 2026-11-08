import type { Db } from '../db/db.js';
import type { DiscordProfile } from '../auth/discord.js';
import { cleanPrefs, type UserPrefs } from '../../shared/prefs.js';

export interface UserRow {
  id: number;
  display_name: string;
  avatar_url: string | null;
  email: string | null;
  email_verified: 0 | 1;
}

export type LoginOutcome = { kind: 'ok'; userId: number; created: boolean } | { kind: 'invite_only' };

export interface FindOrCreateOpts {
  ownerIds: Set<string>;
  /** True when a verified invite token allows creating the account. */
  allowCreate: boolean;
  now: number;
}

const PROVIDER = 'discord';

/** Runs its writes in one transaction; nested inside the caller's transaction it joins it. */
export function findOrCreateUser(db: Db, p: DiscordProfile, opts: FindOrCreateOpts): LoginOutcome {
  const displayName = p.globalName ?? p.username;
  const avatarUrl = p.avatar ? `https://cdn.discordapp.com/avatars/${p.id}/${p.avatar}.png?size=64` : null;
  const email = p.verified ? p.email : null;
  const verified = email ? 1 : 0;

  return db.transaction((): LoginOutcome => {
    const existing = db.prepare('SELECT user_id FROM identities WHERE provider = ? AND subject = ?')
      .get(PROVIDER, p.id) as { user_id: number } | undefined;
    if (existing) {
      db.prepare(
        `UPDATE users SET display_name = ?, avatar_url = ?, email = ?, email_verified = ?, last_login_at = ? WHERE id = ?`,
      ).run(displayName, avatarUrl, email, verified, opts.now, existing.user_id);
      db.prepare(
        `UPDATE identities SET username = ?, email = ?, email_verified = ?, last_login_at = ? WHERE provider = ? AND subject = ?`,
      ).run(p.username, email, verified, opts.now, PROVIDER, p.id);
      return { kind: 'ok', userId: existing.user_id, created: false };
    }
    if (!opts.allowCreate && !opts.ownerIds.has(p.id)) return { kind: 'invite_only' };
    const userId = Number(db.prepare(
      `INSERT INTO users(display_name, avatar_url, email, email_verified, created_at, last_login_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(displayName, avatarUrl, email, verified, opts.now, opts.now).lastInsertRowid);
    db.prepare(
      `INSERT INTO identities(user_id, provider, subject, username, email, email_verified, created_at, last_login_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(userId, PROVIDER, p.id, p.username, email, verified, opts.now, opts.now);
    return { kind: 'ok', userId, created: true };
  })();
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
