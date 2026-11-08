import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../app.js';
import { makeWorldGuards } from '../auth/guards.js';
import { HttpError } from '../errors.js';
import { revokeUploadTokensBy } from '../domain/uploadTokens.js';
import { removeMember, roleOf, setMemberRole } from '../domain/worlds.js';

const USER_ID = /^[1-9][0-9]{0,15}$/;
const RoleBody = z.object({ role: z.enum(['admin', 'member']) });

/**
 * Members of a world (src/shared/roles.ts):
 * - `DELETE /api/worlds/:id/members/:userId`: anyone may leave (themselves); the owner may remove anyone else, an
 *   admin only plain members. The owner cannot be removed. 204.
 * - `PUT /api/worlds/:id/members/:userId/role` `{role: 'admin' | 'member'}`: owner only; an admin may set themselves
 *   back to `member`. The owner's role never changes. 204.
 * Losing a member or an admin revokes the upload tokens they created. Both broadcast `members`, so every client
 * refetches the world (and with it its own role).
 */
export function registerMemberRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db } = deps;
  const now = deps.now ?? Date.now;
  const { requireMember } = makeWorldGuards(db);

  /** The target user id from the path, if they are a member of the loaded world; 404 otherwise. */
  const target = (params: unknown, worldId: string) => {
    const raw = (params as { userId: string }).userId;
    if (!USER_ID.test(raw)) throw new HttpError(404, 'not_found', 'Not found');
    const userId = Number(raw);
    const role = roleOf(db, worldId, userId);
    if (!role) throw new HttpError(404, 'not_found', 'Not found');
    return { userId, role };
  };

  app.delete('/api/worlds/:id/members/:userId', { preHandler: requireMember }, async (req, reply) => {
    const world = req.world!;
    const t = target(req.params, world.id);
    if (t.role === 'owner') throw new HttpError(403, 'forbidden', 'The owner cannot be removed');
    if (t.userId !== req.user!.id) {
      if (req.role === 'member') throw new HttpError(403, 'forbidden', 'Members may only remove themselves');
      if (req.role === 'admin' && t.role !== 'member') throw new HttpError(403, 'forbidden', 'Admins may only remove members');
    }
    db.transaction(() => {
      removeMember(db, world.id, t.userId);
      revokeUploadTokensBy(db, world.id, t.userId, now());
    })();
    deps.hub!.broadcast(world.id, { type: 'removed', userId: t.userId });
    deps.hub!.closeUser(world.id, t.userId);
    deps.hub!.broadcast(world.id, { type: 'members' });
    return reply.code(204).send();
  });

  app.put('/api/worlds/:id/members/:userId/role', { preHandler: requireMember }, async (req, reply) => {
    const world = req.world!;
    const t = target(req.params, world.id);
    const { role } = RoleBody.parse(req.body);
    if (t.role === 'owner') throw new HttpError(403, 'forbidden', "The owner's role cannot be changed");
    const stepDown = t.userId === req.user!.id && role === 'member';
    if (req.role !== 'owner' && !stepDown) throw new HttpError(403, 'forbidden', 'Only the owner can change roles');
    if (t.role !== role) {
      db.transaction(() => {
        setMemberRole(db, world.id, t.userId, role);
        if (role === 'member') revokeUploadTokensBy(db, world.id, t.userId, now());
      })();
      deps.hub!.broadcast(world.id, { type: 'members' });
    }
    return reply.code(204).send();
  });
}
