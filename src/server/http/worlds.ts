import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { WorldDto, WorldRole, WorldSummaryDto } from '../../shared/api.js';
import type { AppDeps } from '../app.js';
import { makeWorldGuards, requireUser } from '../auth/guards.js';
import type { Db } from '../db/db.js';
import { createWorld, deleteWorld, getWorld, listMembers, listWorlds, renameWorld, type WorldRow } from '../domain/worlds.js';

const NameBody = z.object({ name: z.string().trim().min(1).max(80) });

/** The world as the requesting user sees it; `role` is theirs (req.role). */
export function worldDto(db: Db, w: WorldRow, role: WorldRole): WorldDto {
  const owner = db.prepare('SELECT id, display_name FROM users WHERE id = ?').get(w.owner_id) as
    { id: number; display_name: string };
  let lastImport: WorldDto['lastImport'] = null;
  if (w.last_import_at !== null && w.last_import_meta) {
    const m = JSON.parse(w.last_import_meta) as { fileName: string; sessionName: string };
    lastImport = { at: w.last_import_at, sessionName: m.sessionName, fileName: m.fileName };
  }
  return {
    id: w.id,
    name: w.name,
    role,
    rev: w.rev,
    datasetVersion: w.dataset_version,
    owner: { id: owner.id, displayName: owner.display_name },
    members: listMembers(db, w.id),
    lastImport,
  };
}

export function registerWorldRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db, dataset } = deps;
  const now = deps.now ?? Date.now;
  const { requireMember, requireAdmin, requireOwner } = makeWorldGuards(db);

  app.get('/api/worlds', { preHandler: requireUser }, async (req): Promise<WorldSummaryDto[]> =>
    listWorlds(db, req.user!.id, dataset));

  app.post('/api/worlds', { preHandler: requireUser }, async (req, reply): Promise<WorldDto> => {
    const { name } = NameBody.parse(req.body);
    const w = createWorld(db, req.user!.id, name, dataset.ds.version, now());
    reply.code(201);
    return worldDto(db, w, 'owner');
  });

  app.get('/api/worlds/:id', { preHandler: requireMember }, async (req): Promise<WorldDto> =>
    worldDto(db, req.world!, req.role!));

  app.patch('/api/worlds/:id', { preHandler: requireAdmin }, async (req): Promise<WorldDto> => {
    const { name } = NameBody.parse(req.body);
    const rev = renameWorld(db, req.world!.id, name);
    deps.hub!.broadcast(req.world!.id, { type: 'world', name, rev });
    return worldDto(db, getWorld(db, req.world!.id)!, req.role!);
  });

  app.delete('/api/worlds/:id', { preHandler: requireOwner }, async (req, reply) => {
    deleteWorld(db, req.world!.id);
    deps.hub!.broadcast(req.world!.id, { type: 'deleted' });
    deps.hub!.closeWorld(req.world!.id);
    return reply.code(204).send();
  });
}
