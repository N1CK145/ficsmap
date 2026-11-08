import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AppDeps } from '../app.js';
import type { SaveUploadResultDto } from '../../shared/api.js';
import { MAX_SAVE_UPLOAD_BYTES, SAVE_UPLOADS_PER_HOUR } from '../../shared/saveUpload.js';
import { HttpError } from '../errors.js';
import { authenticateUploadToken, touchUploadToken, uploadTokenId, type UploadTokenRow } from '../domain/uploadTokens.js';
import { applyUpload, planUpload } from '../domain/saveUpload.js';
import { getWorld } from '../domain/worlds.js';
import { readSaveHeader } from '../parse/header.js';
import { SaveParseError, type SaveParser } from '../parse/pool.js';

declare module 'fastify' {
  interface FastifyRequest {
    uploadToken?: UploadTokenRow;
  }
}

/** The route pattern; `app.ts` exempts it from the cookie CSRF check (it takes a bearer token, never a cookie). */
export const SAVE_UPLOAD_ROUTE = '/api/worlds/:id/saves';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BEARER = /^Bearer[ ]+([^\s]+)$/i;
/** Seconds a script should wait when the parse queue is full. */
const BUSY_RETRY_AFTER = 60;

function bearer(req: FastifyRequest): string | undefined {
  return BEARER.exec(req.headers.authorization ?? '')?.[1];
}

/**
 * The file name a script sends in `X-Save-Name` (percent-encoded UTF-8; raw bytes are accepted too), reduced to a
 * plain name: no path, no control characters, at most 255 characters. Only shown as the world's last import.
 */
export function saveFileName(header: unknown, sessionName: string): string {
  let name = typeof header === 'string' ? header : '';
  try {
    name = decodeURIComponent(name);
  } catch {
    name = Buffer.from(name, 'latin1').toString('utf8');
  }
  name = name.split(/[\\/]/).pop() ?? '';
  name = name.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 255);
  return name || `${sessionName.slice(0, 250) || 'save'}.sav`;
}

/**
 * `POST /api/worlds/:id/saves`: the save watcher's upload. `Authorization: Bearer <upload token>`, the raw `.sav` as
 * `application/octet-stream` (at most MAX_SAVE_UPLOAD_BYTES), optional `X-Save-Name`. The token is checked before
 * the body is read. The header decides the plan (session, newer or older, duplicate) without parsing; then the save
 * is parsed in a worker (`parse/pool.ts`) and applied (`domain/saveUpload.ts`). Answers 201 `imported`/`snapshot`
 * or 200 `duplicate` (`SaveUploadResultDto`).
 */
export function registerSaveRoutes(app: FastifyInstance, deps: AppDeps & { saveParser: SaveParser }): void {
  const { db, dataset, hub, saveParser } = deps;
  const now = deps.now ?? Date.now;

  void app.register(async scope => {
    scope.addContentTypeParser('application/octet-stream', { parseAs: 'buffer', bodyLimit: MAX_SAVE_UPLOAD_BYTES }, async (_req: FastifyRequest, body: Buffer) => body);

    scope.post(SAVE_UPLOAD_ROUTE, {
      bodyLimit: MAX_SAVE_UPLOAD_BYTES,
      // Before the body is read: an unknown or revoked token never gets the server to buffer a save.
      onRequest: async (req, reply) => {
        const id = (req.params as { id?: string }).id ?? '';
        const token = bearer(req);
        const row = token && UUID_RE.test(id) ? authenticateUploadToken(db, id, token) : null;
        const world = row ? getWorld(db, id) : undefined;
        if (!row || !world) {
          reply.header('WWW-Authenticate', 'Bearer');
          throw new HttpError(401, 'unauthorized', 'Invalid or revoked upload token');
        }
        if (!/^application\/octet-stream\s*(;|$)/i.test(req.headers['content-type'] ?? '')) {
          throw new HttpError(415, 'invalid_body', 'The body must be a .sav file sent as application/octet-stream');
        }
        req.uploadToken = row;
        req.world = world;
      },
      config: {
        rateLimit: {
          max: SAVE_UPLOADS_PER_HOUR,
          timeWindow: '1 hour',
          // Per token (its id); a request without a well-formed token counts against its IP.
          keyGenerator: (req: FastifyRequest) => {
            const tid = uploadTokenId(bearer(req) ?? '');
            return tid ? `saves:token:${tid}` : `saves:ip:${req.ip}`;
          },
        },
      },
    }, async (req, reply): Promise<SaveUploadResultDto> => {
      const token = req.uploadToken!;
      const body = req.body;
      if (!Buffer.isBuffer(body) || body.length === 0) throw new HttpError(400, 'invalid_body', 'The body must be a .sav file');
      // A copy the worker can own (the request's buffer may share memory with others).
      const buffer = body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer;
      const header = readSaveHeader(buffer);
      if (!header) throw new HttpError(400, 'invalid_body', 'The file has no readable Satisfactory save header');

      const anySession = token.any_session === 1;
      const userId = token.created_by ?? req.world!.owner_id;
      touchUploadToken(db, token.id, now());
      if (planUpload(db, req.world!, header, anySession) === 'duplicate') {
        return reply.code(200).send({ status: 'duplicate', sessionName: header.sessionName, saveTime: header.saveTime, snapshot: true } satisfies SaveUploadResultDto);
      }

      let parsed;
      try {
        parsed = await saveParser.parse(buffer);
      } catch (err) {
        if (!(err instanceof SaveParseError)) throw err;
        if (err.code === 'busy' || err.code === 'timeout') {
          reply.header('Retry-After', String(BUSY_RETRY_AFTER));
          throw new HttpError(503, 'busy', err.message);
        }
        throw new HttpError(400, 'invalid_body', err.message);
      }
      // The world may have changed while the save was parsed (a browser import, another upload): plan again.
      const world = getWorld(db, req.world!.id);
      if (!world) throw new HttpError(404, 'not_found', 'Not found');
      const result = { ...parsed.result, meta: { ...parsed.result.meta, sessionName: header.sessionName, saveTime: header.saveTime } };
      const plan = planUpload(db, world, header, anySession);
      if (plan === 'duplicate') {
        return reply.code(200).send({ status: 'duplicate', sessionName: header.sessionName, saveTime: header.saveTime, snapshot: true } satisfies SaveUploadResultDto);
      }
      const { dto, events } = await applyUpload(db, dataset, {
        world, plan, result, userId, now: now(),
        fileName: saveFileName(req.headers['x-save-name'], header.sessionName),
      });
      for (const e of events) hub!.broadcast(world.id, e);
      req.log.info({ world: world.id, token: token.id, status: dto.status, parseMs: parsed.timing.parseMs, totalMs: parsed.timing.totalMs, bytes: body.length }, 'save uploaded');
      return reply.code(201).send(dto);
    });
  });
}
