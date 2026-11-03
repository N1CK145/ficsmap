import type { FastifyInstance } from 'fastify';
import type { MeDto } from '../../shared/api.js';
import type { AppDeps } from '../app.js';
import { requireUser } from '../auth/guards.js';

export function registerMeRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get('/api/me', { preHandler: requireUser }, async (req): Promise<MeDto> => {
    const u = req.user!;
    return {
      id: u.id,
      displayName: u.display_name,
      avatarUrl: u.avatar_url,
      email: u.email,
      datasetVersion: deps.config.datasetVersion,
    };
  });
}
