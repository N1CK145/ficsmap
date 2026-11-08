import { randomUUID } from 'node:crypto';
import type { Db } from '../db/db.js';
import type { DatasetIndex } from '../../shared/dataset.js';
import type { MemberDto, WorldSummaryDto } from '../../shared/api.js';
import { HttpError } from '../errors.js';

export interface WorldRow {
  id: string;
  name: string;
  owner_id: number;
  dataset_version: string;
  rev: number;
  invite_epoch: number;
  created_at: number;
  last_import_at: number | null;
  last_import_meta: string | null;
  node_settings: string | null;
}

export function createWorld(db: Db, ownerId: number, name: string, datasetVersion: string, now: number): WorldRow {
  const id = randomUUID();
  return db.transaction((): WorldRow => {
    db.prepare('INSERT INTO worlds(id, name, owner_id, dataset_version, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, name, ownerId, datasetVersion, now);
    db.prepare("INSERT INTO world_members(world_id, user_id, joined_at, joined_via) VALUES (?, ?, ?, 'owner')")
      .run(id, ownerId, now);
    return getWorld(db, id)!;
  })();
}

export function getWorld(db: Db, worldId: string): WorldRow | undefined {
  return db.prepare('SELECT * FROM worlds WHERE id = ?').get(worldId) as WorldRow | undefined;
}

export function roleOf(db: Db, worldId: string, userId: number): 'owner' | 'member' | null {
  const r = db.prepare(
    `SELECT w.owner_id AS owner_id FROM world_members m JOIN worlds w ON w.id = m.world_id
     WHERE m.world_id = ? AND m.user_id = ?`,
  ).get(worldId, userId) as { owner_id: number } | undefined;
  if (!r) return null;
  return r.owner_id === userId ? 'owner' : 'member';
}

export function bumpRev(db: Db, worldId: string): number {
  const r = db.prepare('UPDATE worlds SET rev = rev + 1 WHERE id = ? RETURNING rev').get(worldId) as
    { rev: number } | undefined;
  if (!r) throw new HttpError(404, 'not_found', 'Not found');
  return r.rev;
}

/** Counts marks whose actor is in the dataset (mismatch rows included). */
export function progress(db: Db, worldId: string, index: DatasetIndex): { done: number; total: number } {
  const rows = db.prepare('SELECT actor_name FROM marks WHERE world_id = ?').all(worldId) as { actor_name: string }[];
  return { done: rows.filter(r => index.has(r.actor_name)).length, total: index.items.length };
}

export function listWorlds(db: Db, userId: number, index: DatasetIndex): WorldSummaryDto[] {
  const rows = db.prepare(
    `SELECT w.id, w.name, w.owner_id, w.last_import_at,
            (SELECT COUNT(*) FROM world_members WHERE world_id = w.id) AS member_count
     FROM worlds w JOIN world_members m ON m.world_id = w.id
     WHERE m.user_id = ? ORDER BY w.created_at DESC, w.rowid DESC`,
  ).all(userId) as { id: string; name: string; owner_id: number; last_import_at: number | null; member_count: number }[];
  return rows.map(r => ({
    id: r.id,
    name: r.name,
    role: r.owner_id === userId ? 'owner' : 'member',
    memberCount: r.member_count,
    progress: progress(db, r.id, index),
    lastImportAt: r.last_import_at,
  }));
}

export function renameWorld(db: Db, worldId: string, name: string): number {
  const r = db.prepare('UPDATE worlds SET name = ?, rev = rev + 1 WHERE id = ? RETURNING rev').get(name, worldId) as
    { rev: number } | undefined;
  if (!r) throw new HttpError(404, 'not_found', 'Not found');
  return r.rev;
}

export function deleteWorld(db: Db, worldId: string): void {
  db.prepare('DELETE FROM worlds WHERE id = ?').run(worldId);
}

export function listMembers(db: Db, worldId: string): MemberDto[] {
  const rows = db.prepare(
    `SELECT u.id, u.display_name, u.avatar_url, m.joined_via, m.joined_at
     FROM world_members m JOIN users u ON u.id = m.user_id
     WHERE m.world_id = ? ORDER BY m.joined_at, u.id`,
  ).all(worldId) as { id: number; display_name: string; avatar_url: string | null; joined_via: string; joined_at: number }[];
  return rows.map(r => ({
    userId: r.id, displayName: r.display_name, avatarUrl: r.avatar_url, joinedVia: r.joined_via, joinedAt: r.joined_at,
  }));
}

export function removeMember(db: Db, worldId: string, userId: number): void {
  const w = getWorld(db, worldId);
  if (w?.owner_id === userId) throw new HttpError(403, 'forbidden', 'The owner cannot be removed');
  db.prepare('DELETE FROM world_members WHERE world_id = ? AND user_id = ?').run(worldId, userId);
}
