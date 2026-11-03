import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../app.js';
import type { RouteDto } from '../../shared/api.js';
import { makeWorldGuards } from '../auth/guards.js';
import { HttpError } from '../errors.js';
import { createRoute, deleteRoute, getRoute, listRoutes, RouteInputSchema, updateRoute } from '../domain/routes.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function registerRouteRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db, hub } = deps;
  const now = deps.now ?? Date.now;
  const { requireMember } = makeWorldGuards(db);
  const limit = {
    rateLimit: {
      max: 30,
      timeWindow: '1 minute',
      keyGenerator: (req: { user?: { id: number }; ip: string }) => (req.user ? `route:u${req.user.id}` : req.ip),
    },
  };

  /** Loads the route in this world and checks creator-or-owner; 404 for unknown ids, 403 otherwise. */
  const requireEditable = async (req: Parameters<typeof requireMember>[0]): Promise<void> => {
    const routeId = (req.params as { routeId: string }).routeId;
    if (!UUID_RE.test(routeId)) throw new HttpError(404, 'not_found', 'Not found');
    const route = getRoute(db, req.world!.id, routeId);
    if (!route) throw new HttpError(404, 'not_found', 'Not found');
    const creator = route.createdBy !== null && route.createdBy === req.user!.id;
    if (!creator && req.role !== 'owner') throw new HttpError(403, 'forbidden', 'Only the creator or the owner can change this route');
  };
  const editable = [requireMember, requireEditable];

  app.get('/api/worlds/:id/routes', { preHandler: requireMember }, async (req): Promise<RouteDto[]> =>
    listRoutes(db, req.world!.id));

  app.post('/api/worlds/:id/routes', { preHandler: requireMember, config: limit }, async (req, reply): Promise<RouteDto> => {
    const input = RouteInputSchema.parse(req.body);
    const { route, rev } = createRoute(db, req.world!.id, input, req.user!.id, now());
    hub!.broadcast(req.world!.id, { type: 'routes', rev });
    return reply.code(201).send(route);
  });

  app.put('/api/worlds/:id/routes/:routeId', { preHandler: editable, config: limit }, async (req): Promise<RouteDto> => {
    const input = RouteInputSchema.parse(req.body);
    const { route, rev } = updateRoute(db, req.world!.id, (req.params as { routeId: string }).routeId, input, now());
    hub!.broadcast(req.world!.id, { type: 'routes', rev });
    return route;
  });

  app.delete('/api/worlds/:id/routes/:routeId', { preHandler: editable, config: limit }, async (req, reply) => {
    const { rev } = deleteRoute(db, req.world!.id, (req.params as { routeId: string }).routeId);
    hub!.broadcast(req.world!.id, { type: 'routes', rev });
    return reply.code(204).send();
  });
}
