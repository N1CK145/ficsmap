import type { NodeExtractor, NodeSettings, ResourceNodeOverride, SaveResourceNodes } from './resourceNodes.js';
import type { UserPrefs } from './prefs.js';
import type { MemberRole, WorldRole } from './roles.js';

export type { MemberRole, WorldRole } from './roles.js';

export type ApiErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'invalid_body'
  | 'invalid_origin'
  | 'rate_limited'
  | 'invite_invalid'
  /** A per-world limit is reached (e.g. the number of factory snapshots). */
  | 'limit_reached'
  /** An uploaded save belongs to another session than the world's (save watcher). */
  | 'session_mismatch'
  /** The server cannot take the request now (the save parse queue is full); try again later. */
  | 'busy'
  /** The server runs in maintenance mode (an older version on newer data): nothing is read or written. */
  | 'maintenance'
  /** The account's only sign-in cannot be removed (`DELETE /api/me/identities/:provider`). */
  | 'last_identity'
  | 'internal';

export interface ApiError {
  error: ApiErrorCode;
  message: string;
}

/** `GET /api/version`. In maintenance mode also `maintenance: true` and the version the data was last used by. */
export interface VersionDto {
  version: string;
  maintenance?: boolean;
  dataVersion?: string;
}

/**
 * What an activity feed entry is about: checks changed (`count` of them), a save imported, factory snapshots added,
 * routes changed, the world renamed (`detail`: the new name), a member joined, left or was removed (`target`), a role
 * changed (`target`, `detail`: the new role) or the world was handed over (`target`: the new owner).
 */
export type ActivityKind = 'marks' | 'import' | 'snapshots' | 'routes' | 'rename' | 'join' | 'leave' | 'remove' | 'role' | 'owner';

/** One entry of `GET /api/worlds/:id/activity`, newest first. A deleted account is null. */
export interface ActivityDto {
  id: number;
  kind: ActivityKind;
  by: { id: number; name: string } | null;
  target: { id: number; name: string } | null;
  detail: string | null;
  /** How many changes the entry adds up (checks, imports, snapshots, route edits); 1 otherwise. */
  count: number;
  at: number;
}

/** A way to sign in (`identities.provider`). */
export type LoginProvider = 'discord' | 'steam';
export const LOGIN_PROVIDERS: readonly LoginProvider[] = ['discord', 'steam'];

/** One of the user's own sign-ins: the provider's id (Discord id, SteamID64) and account name if known. */
export interface IdentityDto { provider: LoginProvider; subject: string; name: string | null }

export interface MeDto {
  id: number;
  displayName: string;
  avatarUrl: string | null;
  /** The user's own verified e-mail; never exposed to other users. */
  email: string | null;
  datasetVersion: string;
  /** The user's preferences (src/shared/prefs.ts); always sent by the server. A missing key has its default. */
  prefs?: UserPrefs;
  /** True for a server owner (OWNER_DISCORD_IDS, OWNER_STEAM_IDS), who may create general invites (`GET /api/invite-link`). */
  serverOwner?: boolean;
  /** The user's sign-ins (Discord, Steam); always sent by the server. */
  identities?: IdentityDto[];
}

export interface MemberDto {
  userId: number;
  displayName: string;
  avatarUrl: string | null;
  joinedVia: string;
  joinedAt: number;
  role: WorldRole;
}

/** `PUT /api/worlds/:id/members/:userId/role`: owner only; an admin may also set themselves back to `member`. */
export interface MemberRoleInput {
  role: MemberRole;
}

export interface WorldSummaryDto {
  id: string;
  name: string;
  role: WorldRole;
  memberCount: number;
  progress: { done: number; total: number };
  lastImportAt: number | null;
}

export interface WorldDto {
  id: string;
  name: string;
  /** The requesting user's role in this world. */
  role: WorldRole;
  rev: number;
  datasetVersion: string;
  owner: { id: number; displayName: string };
  members: MemberDto[];
  lastImport: { at: number; sessionName: string; fileName: string } | null;
}

export interface ImportRequest {
  fileName: string;
  sessionName: string;
  saveTime: number;
  build: number;
  collected: string[];
  /** What the save says about resource nodes; when present it replaces the world's node data (older clients omit it). */
  resourceNodes?: SaveResourceNodes;
}

export interface ImportResultDto {
  rev: number;
  /** Names in the save that had no mark row before. */
  newlyChecked: number;
  /** Marks now flagged (!): checked in the world, absent from the save, actor in the dataset. */
  conflicts: number;
  /** Distinct names in the request that are not in the dataset. */
  ignored: number;
  /** Distinct in-dataset names the save reports. */
  collectedTotal: number;
}

export interface RouteDto {
  id: string;
  name: string;
  startActor: string;
  stops: string[];
  createdBy: number | null;
  createdByName: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface RouteInput {
  name: string;
  startActor: string;
  stops: string[];
}

/** One mark as it was before a bulk change; `POST /marks/restore` takes these back (undo). */
export type RestoreRow = [actor: string, collected: boolean, mismatch: 0 | 1];

/** `GET /api/worlds/:id/marks`: every checked actor of the world. */
export interface MarksDto {
  rev: number;
  marks: [actor: string, mismatch: 0 | 1, updatedBy: number | null, updatedAt: number][];
}

/**
 * `GET /api/worlds/:id/resource-nodes`: the world's resource nodes where its last save import differs from the
 * default map, and the extractors standing on nodes in that save.
 */
export interface ResourceNodesDto {
  overrides: ResourceNodeOverride[];
  settings: NodeSettings | null;
  extractors: NodeExtractor[];
}

/** An upload token of the save watcher (`GET /api/worlds/:id/upload-tokens`); the secret is never listed. */
export interface UploadTokenDto {
  id: number;
  label: string;
  /** Saves of any session are accepted, not only the world's. */
  anySession: boolean;
  createdAt: number;
  createdBy: string | null;
  lastUsedAt: number | null;
}

export interface UploadTokenInput {
  label: string;
  anySession: boolean;
}

/** `POST /api/worlds/:id/upload-tokens`: the new token and its secret, shown this once. */
export interface CreatedUploadTokenDto {
  token: UploadTokenDto;
  secret: string;
}

/**
 * `POST /api/worlds/:id/saves` (save watcher): `imported` = newer than the world's last import, applied like an import
 * and stored as a snapshot; `snapshot` = older, stored for the timeline only; `duplicate` = the world has it already.
 */
export type SaveUploadStatus = 'imported' | 'snapshot' | 'duplicate';

export interface SaveUploadResultDto {
  status: SaveUploadStatus;
  sessionName: string;
  saveTime: number;
  /** Only for `imported`: as `ImportResultDto`. */
  newlyChecked?: number;
  conflicts?: number;
  /**
   * A factory snapshot of this save was stored (and kept). False when the save had none, the world's limit is reached
   * or the retention rule thinned it at once (an old save whose hour, day or week has a newer one).
   */
  snapshot: boolean;
  /** Why no snapshot was stored, when that matters (`limit_reached`, `thinned`, `no_factory`, `invalid_factory`). */
  note?: string;
}
