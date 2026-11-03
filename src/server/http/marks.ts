import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../app.js';
import { makeWorldGuards } from '../auth/guards.js';
import { HttpError } from '../errors.js';
import { bulkMarks, listMarks, restoreMarks, setMark, type MarkTuple, type RestoreRow } from '../domain/marks.js';

const Actor = z.string().regex(/^[A-Za-z0-9_]{1,128}$/);
const MAX_ACTORS = 10_000;

const PutBody = z.object({ collected: z.boolean() });
const BulkBody = z.object({
  actors: z.array(Actor).max(MAX_ACTORS),
  collected: z.boolean(),
  onlyIfMismatch: z.boolean().default(false),
});
const RestoreBody = z.object({
  rows: z.array(z.tuple([Actor, z.boolean(), z.union([z.literal(0), z.literal(1)])])).max(MAX_ACTORS),
});

export function registerMarkRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db, hub, dataset } = deps;
  const now = deps.now ?? Date.now;
  const { requireMember } = makeWorldGuards(db);
  const limit = {
    rateLimit: {
      max: 120,
      timeWindow: '1 minute',
      keyGenerator: (req: { user?: { id: number }; ip: string }) => (req.user ? `u${req.user.id}` : req.ip),
    },
  };

  app.get('/api/worlds/:id/marks', { preHandler: requireMember }, async (req): Promise<{ rev: number; marks: MarkTuple[] }> =>
    db.transaction(() => {
      const id = req.world!.id;
      const rev = (db.prepare('SELECT rev FROM worlds WHERE id = ?').get(id) as { rev: number }).rev;
      return { rev, marks: listMarks(db, id) };
    })());

  app.put('/api/worlds/:id/marks/:actor', { preHandler: requireMember, config: limit }, async req => {
    const actor = Actor.safeParse((req.params as { actor: string }).actor);
    if (!actor.success || !dataset.has(actor.data)) throw new HttpError(400, 'invalid_body', 'Invalid actor name');
    const { collected } = PutBody.parse(req.body);
    const at = now();
    const { rev } = setMark(db, req.world!.id, actor.data, collected, req.user!.id, at);
    hub!.broadcast(req.world!.id, {
      type: 'mark', actor: actor.data, collected, mismatch: false, by: req.user!.id, at, rev,
    });
    return { rev };
  });

  app.post('/api/worlds/:id/marks/bulk', { preHandler: requireMember, config: limit }, async req => {
    const body = BulkBody.parse(req.body);
    // Unknown actors are dropped (spec §5: their existing marks stay, kept but hidden).
    const actors = body.actors.filter(a => dataset.has(a));
    const out = bulkMarks(db, req.world!.id, { ...body, actors }, req.user!.id, now());
    hub!.broadcast(req.world!.id, { type: 'marks-bulk', rev: out.rev });
    return out satisfies { rev: number; previous: RestoreRow[] };
  });

  app.post('/api/worlds/:id/marks/restore', { preHandler: requireMember, config: limit }, async req => {
    const rows = RestoreBody.parse(req.body).rows.filter(([a]) => dataset.has(a));
    const { rev } = restoreMarks(db, req.world!.id, rows, req.user!.id, now());
    hub!.broadcast(req.world!.id, { type: 'marks-bulk', rev });
    return { rev };
  });
}
