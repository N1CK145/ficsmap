/**
 * The save watcher's upload (`POST /api/worlds/:id/saves`) and its tokens, shared by the server and the script
 * generator.
 */

/** The largest save body accepted (compressed, as the game writes it). Real saves are a few MB; megabases a few dozen. */
export const MAX_SAVE_UPLOAD_BYTES = 64 * 2 ** 20;
/** Active (not revoked) upload tokens per world. */
export const MAX_UPLOAD_TOKENS_PER_WORLD = 20;
export const MAX_UPLOAD_TOKEN_LABEL = 80;
/** Uploads per token and hour (an autosave every 5 minutes is 12). */
export const SAVE_UPLOADS_PER_HOUR = 60;

/** `fsm_<id>_<secret>`: the row id, then 32 random bytes in base64url. Only [A-Za-z0-9_-], so it is safe in scripts. */
export const UPLOAD_TOKEN_RE = /^fsm_([1-9][0-9]{0,15})_([A-Za-z0-9_-]{43})$/;

export function isUploadToken(s: string): boolean {
  return UPLOAD_TOKEN_RE.test(s);
}
