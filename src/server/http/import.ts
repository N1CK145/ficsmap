import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../app.js';
import type { ImportResultDto } from '../../shared/api.js';
import { makeWorldGuards } from '../auth/guards.js';
import { applyImport } from '../domain/importSave.js';
import { EXTRACTOR_KINDS, MAX_CLOCK, MAX_SHARDS, type ExtractorKind } from '../../shared/resourceNodes.js';

const ActorName = z.string().regex(/^[A-Za-z0-9_]{1,128}$/);
const ClassName = z.string().regex(/^[A-Za-z0-9_]{1,64}$/);
const EnumName = z.string().regex(/^[A-Za-z0-9_]{1,40}$/);
/** The game has 625 nodes, geysers and well points; room for more without letting a body grow unbounded. */
const MAX_NODE_OVERRIDES = 2000;
/** One building per node plus portable miners (several can share a node); keeps the body within its limit. */
const MAX_EXTRACTORS = 2000;

const Body = z.object({
  fileName: z.string().min(1).max(255),
  sessionName: z.string().max(255),
  saveTime: z.number().int().min(0),
  build: z.number().int().min(0),
  collected: z.array(ActorName).max(10_000),
  resourceNodes: z.object({
    overrides: z.array(z.tuple([ActorName, ClassName.nullable(), z.enum(['impure', 'normal', 'pure']).nullable()])).max(MAX_NODE_OVERRIDES),
    settings: z.object({ randomization: EnumName.nullable(), purity: EnumName.nullable(), seed: z.number().int().nullable() }).nullable(),
    extractors: z.array(z.tuple([
      ActorName,
      z.enum(EXTRACTOR_KINDS as [ExtractorKind, ...ExtractorKind[]]),
      z.number().min(0).max(MAX_CLOCK).nullable(),
      z.number().int().min(0).max(MAX_SHARDS).nullable(),
    ])).max(MAX_EXTRACTORS).optional(),
  }).optional(),
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
