import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../app.js';
import type { ImportResultDto } from '../../shared/api.js';
import { makeWorldGuards } from '../auth/guards.js';
import { applyImport } from '../domain/importSave.js';

const Body = z.object({
  fileName: z.string().min(1).max(255),
  sessionName: z.string().max(255),
  saveTime: z.number().int().min(0),
  build: z.number().int().min(0),
  collected: z.array(z.string().regex(/^[A-Za-z0-9_]{1,128}$/)).max(10_000),
});

export function registerImportRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db, dataset, hub } = deps;
  const now = deps.now ?? Date.now;
  const { requireOwner } = makeWorldGuards(db);

  app.post('/api/worlds/:id/import', {
    preHandler: requireOwner,
    bodyLimit: 524_288,
    config: {
      rateLimit: {
        max: 6,
        timeWindow: '1 hour',
        keyGenerator: (req: { params: unknown; user?: { id: number }; ip: string }) =>
          `import:${(req.params as { id: string }).id}:${req.user?.id ?? req.ip}`,
      },
    },
  }, async (req): Promise<ImportResultDto> => {
    const body = Body.parse(req.body);
    const out = applyImport(db, req.world!.id, body, dataset, req.user!.id, now());
    hub!.broadcast(req.world!.id, { type: 'import', rev: out.rev });
    return out;
  });
}
