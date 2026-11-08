import type { NodeExtractor, NodeSettings, ResourceNodeOverride, SaveResourceNodes } from './resourceNodes.js';

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
  | 'internal';

export interface ApiError {
  error: ApiErrorCode;
  message: string;
}

export interface MeDto {
  id: number;
  displayName: string;
  avatarUrl: string | null;
  /** The user's own verified e-mail; never exposed to other users. */
  email: string | null;
  datasetVersion: string;
}

export interface MemberDto {
  userId: number;
  displayName: string;
  avatarUrl: string | null;
  joinedVia: string;
  joinedAt: number;
}

export interface WorldSummaryDto {
  id: string;
  name: string;
  role: 'owner' | 'member';
  memberCount: number;
  progress: { done: number; total: number };
  lastImportAt: number | null;
}

export interface WorldDto {
  id: string;
  name: string;
  isOwner: boolean;
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
