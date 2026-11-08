import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Db } from '../db/db.js';
import type { UploadTokenDto, UploadTokenInput } from '../../shared/api.js';
import { MAX_UPLOAD_TOKENS_PER_WORLD, UPLOAD_TOKEN_RE } from '../../shared/saveUpload.js';
import { HttpError } from '../errors.js';

/**
 * Upload tokens of the save watcher: a token lets a script upload saves to one world, nothing else. The token is
 * `fsm_<id>_<secret>`; only the SHA-256 of the secret is stored. The id finds the row, the secret is compared in
 * constant time, so a guess learns nothing from timing. Revoking sets `revoked_at`; a revoked token never works again.
 */

export interface UploadTokenRow {
  id: number;
  world_id: string;
  label: string;
  any_session: 0 | 1;
  created_by: number | null;
  created_at: number;
  last_used_at: number | null;
  revoked_at: number | null;
}

const hashSecret = (secret: string): Buffer => createHash('sha256').update(secret).digest();

function toDto(r: UploadTokenRow & { created_by_name: string | null }): UploadTokenDto {
  return {
    id: r.id,
    label: r.label,
    anySession: r.any_session === 1,
    createdAt: r.created_at,
    createdBy: r.created_by_name,
    lastUsedAt: r.last_used_at,
  };
}

const SELECT = `SELECT t.id, t.world_id, t.label, t.any_session, t.created_by, t.created_at, t.last_used_at, t.revoked_at,
    u.display_name AS created_by_name
  FROM upload_tokens t LEFT JOIN users u ON u.id = t.created_by`;

/** Creates a token; the secret is returned this once. 409 `limit_reached` beyond MAX_UPLOAD_TOKENS_PER_WORLD active ones. */
export function createUploadToken(
  db: Db, worldId: string, input: UploadTokenInput, userId: number, now: number,
): { token: UploadTokenDto; secret: string } {
  const secret = randomBytes(32).toString('base64url');
  return db.transaction(() => {
    const { n } = db.prepare('SELECT count(*) AS n FROM upload_tokens WHERE world_id = ? AND revoked_at IS NULL').get(worldId) as { n: number };
    if (n >= MAX_UPLOAD_TOKENS_PER_WORLD) {
      throw new HttpError(409, 'limit_reached', `A world has at most ${MAX_UPLOAD_TOKENS_PER_WORLD} upload tokens`);
    }
    const id = Number(db.prepare(
      `INSERT INTO upload_tokens(world_id, label, secret_hash, any_session, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(worldId, input.label, hashSecret(secret), input.anySession ? 1 : 0, userId, now).lastInsertRowid);
    const row = db.prepare(`${SELECT} WHERE t.id = ?`).get(id) as UploadTokenRow & { created_by_name: string | null };
    return { token: toDto(row), secret: `fsm_${id}_${secret}` };
  })();
}

/** The world's active tokens, newest first. */
export function listUploadTokens(db: Db, worldId: string): UploadTokenDto[] {
  const rows = db.prepare(`${SELECT} WHERE t.world_id = ? AND t.revoked_at IS NULL ORDER BY t.created_at DESC, t.id DESC`)
    .all(worldId) as (UploadTokenRow & { created_by_name: string | null })[];
  return rows.map(toDto);
}

/** Revokes one active token of this world; 404 when there is none with this id. */
export function revokeUploadToken(db: Db, worldId: string, id: number, now: number): void {
  const { changes } = db.prepare('UPDATE upload_tokens SET revoked_at = ? WHERE world_id = ? AND id = ? AND revoked_at IS NULL')
    .run(now, worldId, id);
  if (changes === 0) throw new HttpError(404, 'not_found', 'Not found');
}

/**
 * Revokes the active tokens a user created in this world: a token uploads with its creator's rights, so it stops
 * when they lose them (removed, left, or no longer admin). Returns how many were revoked.
 */
export function revokeUploadTokensBy(db: Db, worldId: string, userId: number, now: number): number {
  return db.prepare('UPDATE upload_tokens SET revoked_at = ? WHERE world_id = ? AND created_by = ? AND revoked_at IS NULL')
    .run(now, worldId, userId).changes;
}

/** The id in a well-formed token (`fsm_<id>_…`), for rate limiting; undefined otherwise. */
export function uploadTokenId(token: string): string | undefined {
  return UPLOAD_TOKEN_RE.exec(token)?.[1];
}

/**
 * The active token row for this token and world, or null: malformed, unknown, revoked, another world's, or a wrong
 * secret all look the same to the caller.
 */
export function authenticateUploadToken(db: Db, worldId: string, token: string): UploadTokenRow | null {
  const m = UPLOAD_TOKEN_RE.exec(token);
  if (!m) return null;
  const row = db.prepare(
    `SELECT id, world_id, label, any_session, created_by, created_at, last_used_at, revoked_at, secret_hash
       FROM upload_tokens WHERE id = ?`,
  ).get(Number(m[1])) as (UploadTokenRow & { secret_hash: Buffer }) | undefined;
  // Hash and compare even without a row, so an unknown id costs the same as a wrong secret.
  const expected = row?.secret_hash ?? Buffer.alloc(32);
  const ok = timingSafeEqual(hashSecret(m[2]!), expected);
  if (!row || !ok || row.revoked_at !== null || row.world_id !== worldId) return null;
  const { secret_hash: _hash, ...rest } = row;
  return rest;
}

export function touchUploadToken(db: Db, id: number, now: number): void {
  db.prepare('UPDATE upload_tokens SET last_used_at = ? WHERE id = ?').run(now, id);
}
