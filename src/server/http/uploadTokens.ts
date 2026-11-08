import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../app.js';
import type { CreatedUploadTokenDto, UploadTokenDto } from '../../shared/api.js';
import { MAX_UPLOAD_TOKEN_LABEL } from '../../shared/saveUpload.js';
import { makeWorldGuards } from '../auth/guards.js';
import { HttpError } from '../errors.js';
import { createUploadToken, listUploadTokens, revokeUploadToken } from '../domain/uploadTokens.js';

const Body = z.object({
  label: z.string().trim().min(1).max(MAX_UPLOAD_TOKEN_LABEL),
  anySession: z.boolean().default(false),
});
const TOKEN_ID = /^[1-9][0-9]{0,15}$/;

/**
 * Upload tokens of the save watcher (owner or admin, like the save import):
 * - `GET /api/worlds/:id/upload-tokens`: the active tokens, without secrets.
 * - `POST /api/worlds/:id/upload-tokens` `{label, anySession}`: 201 `{token, secret}`; the secret is shown this once.
 * - `DELETE /api/worlds/:id/upload-tokens/:tid`: revokes it (204).
 */
export function registerUploadTokenRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db } = deps;
  const now = deps.now ?? Date.now;
  const { requireAdmin } = makeWorldGuards(db);

  app.get('/api/worlds/:id/upload-tokens', { preHandler: requireAdmin }, async (req, reply): Promise<UploadTokenDto[]> => {
    reply.header('Cache-Control', 'no-store');
    return listUploadTokens(db, req.world!.id);
  });

  app.post('/api/worlds/:id/upload-tokens', {
    preHandler: requireAdmin,
    config: { rateLimit: { max: 30, timeWindow: '1 hour' } },
  }, async (req, reply): Promise<CreatedUploadTokenDto> => {
    const body = Body.parse(req.body);
    const created = createUploadToken(db, req.world!.id, body, req.user!.id, now());
    return reply.code(201).header('Cache-Control', 'no-store').send(created);
  });

  app.delete('/api/worlds/:id/upload-tokens/:tid', { preHandler: requireAdmin }, async (req, reply) => {
    const tid = (req.params as { tid?: string }).tid ?? '';
    if (!TOKEN_ID.test(tid)) throw new HttpError(404, 'not_found', 'Not found');
    revokeUploadToken(db, req.world!.id, Number(tid), now());
    return reply.code(204).send();
  });
}
