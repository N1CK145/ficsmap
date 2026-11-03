import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Db } from '../db/db.js';
import { HttpError } from '../errors.js';
import type { RouteDto, RouteInput } from '../../shared/api.js';
import { MAX_ROUTE_STOPS } from '../../shared/route.js';
import { bumpRev } from './worlds.js';

const Actor = z.string().regex(/^[A-Za-z0-9_]{1,128}$/);

export const RouteInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  startActor: Actor,
  stops: z.array(Actor).min(1).max(MAX_ROUTE_STOPS),
}).refine(r => new Set(r.stops).size === r.stops.length, { message: 'Duplicate stops', path: ['stops'] })
  .refine(r => !r.stops.includes(r.startActor), { message: 'Start is also a stop', path: ['stops'] });

interface RouteRow {
  id: string; name: string; start_actor: string; stops: string; created_by: number | null;
  created_by_name: string | null; created_at: number; updated_at: number;
}

const SELECT = `SELECT r.id, r.name, r.start_actor, r.stops, r.created_by, u.display_name AS created_by_name,
  r.created_at, r.updated_at FROM routes r LEFT JOIN users u ON u.id = r.created_by`;

function toDto(r: RouteRow): RouteDto {
  return {
    id: r.id, name: r.name, startActor: r.start_actor, stops: JSON.parse(r.stops) as string[],
    createdBy: r.created_by, createdByName: r.created_by_name, createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

export function getRoute(db: Db, worldId: string, routeId: string): RouteDto | undefined {
  const row = db.prepare(`${SELECT} WHERE r.id = ? AND r.world_id = ?`).get(routeId, worldId) as RouteRow | undefined;
  return row && toDto(row);
}

export function listRoutes(db: Db, worldId: string): RouteDto[] {
  const rows = db.prepare(`${SELECT} WHERE r.world_id = ? ORDER BY r.updated_at DESC, r.created_at DESC, r.id`)
    .all(worldId) as RouteRow[];
  return rows.map(toDto);
}

function notFound(): HttpError {
  return new HttpError(404, 'not_found', 'Not found');
}

export function createRoute(
  db: Db, worldId: string, input: RouteInput, userId: number, now: number,
): { route: RouteDto; rev: number } {
  return db.transaction(() => {
    const id = randomUUID();
    db.prepare(
      'INSERT INTO routes(id, world_id, name, start_actor, stops, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(id, worldId, input.name, input.startActor, JSON.stringify(input.stops), userId, now, now);
    return { route: getRoute(db, worldId, id)!, rev: bumpRev(db, worldId) };
  })();
}

export function updateRoute(
  db: Db, worldId: string, routeId: string, input: RouteInput, now: number,
): { route: RouteDto; rev: number } {
  return db.transaction(() => {
    const r = db.prepare('UPDATE routes SET name = ?, start_actor = ?, stops = ?, updated_at = ? WHERE id = ? AND world_id = ?')
      .run(input.name, input.startActor, JSON.stringify(input.stops), now, routeId, worldId);
    if (r.changes === 0) throw notFound();
    return { route: getRoute(db, worldId, routeId)!, rev: bumpRev(db, worldId) };
  })();
}

export function deleteRoute(db: Db, worldId: string, routeId: string): { rev: number } {
  return db.transaction(() => {
    if (db.prepare('DELETE FROM routes WHERE id = ? AND world_id = ?').run(routeId, worldId).changes === 0) throw notFound();
    return { rev: bumpRev(db, worldId) };
  })();
}
