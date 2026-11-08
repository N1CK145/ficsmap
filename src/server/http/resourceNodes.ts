import type { FastifyInstance } from 'fastify';
import type { ResourceNodesDto } from '../../shared/api.js';
import type { AppDeps } from '../app.js';
import { makeWorldGuards } from '../auth/guards.js';
import { getResourceNodes } from '../domain/resourceNodes.js';

/** The world's resource nodes from its last save import (members); written by the import. */
export function registerResourceNodeRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db } = deps;
  const { requireMember } = makeWorldGuards(db);
  app.get('/api/worlds/:id/resource-nodes', { preHandler: requireMember }, async (req): Promise<ResourceNodesDto> =>
    getResourceNodes(db, req.world!.id));
}
