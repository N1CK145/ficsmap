import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../app.js';
import { makeWorldGuards } from '../auth/guards.js';
import { HttpError } from '../errors.js';
import { removeMember, roleOf } from '../domain/worlds.js';

export function registerMemberRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db } = deps;
  const { requireMember } = makeWorldGuards(db);

  app.delete('/api/worlds/:id/members/:userId', { preHandler: requireMember }, async (req, reply) => {
    const raw = (req.params as { userId: string }).userId;
    if (!/^[1-9][0-9]{0,15}$/.test(raw)) throw new HttpError(404, 'not_found', 'Not found');
    const target = Number(raw);
    const world = req.world!;
    if (!roleOf(db, world.id, target)) throw new HttpError(404, 'not_found', 'Not found');
    if (target === world.owner_id) throw new HttpError(403, 'forbidden', 'The owner cannot be removed');
    if (req.role !== 'owner' && target !== req.user!.id) {
      throw new HttpError(403, 'forbidden', 'Members may only remove themselves');
    }
    removeMember(db, world.id, target);
    deps.hub!.broadcast(world.id, { type: 'removed', userId: target });
    deps.hub!.closeUser(world.id, target);
    deps.hub!.broadcast(world.id, { type: 'members' });
    return reply.code(204).send();
  });
}
