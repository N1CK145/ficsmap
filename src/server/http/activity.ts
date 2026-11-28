import type { FastifyInstance } from 'fastify';
import type { ActivityDto } from '../../shared/api.js';
import type { AppDeps } from '../app.js';
import { makeWorldGuards } from '../auth/guards.js';
import { listActivity } from '../domain/activity.js';

/** `GET /api/worlds/:id/activity`: the world's 50 newest feed entries for every member (src/server/domain/activity.ts). */
export function registerActivityRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { requireMember } = makeWorldGuards(deps.db);
  app.get('/api/worlds/:id/activity', { preHandler: requireMember }, async (req): Promise<ActivityDto[]> =>
    listActivity(deps.db, req.world!.id));
}
