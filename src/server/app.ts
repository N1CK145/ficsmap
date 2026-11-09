import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import { ZodError } from 'zod';
import type { DatasetIndex } from '../shared/dataset.js';
import type { ApiError, ApiErrorCode } from '../shared/api.js';
import type { Config } from './config.js';
import type { Db } from './db/db.js';
import type { DiscordClient } from './auth/discord.js';
import { HttpError } from './errors.js';
import { registerSessionLoader } from './auth/guards.js';
import { registerAuthRoutes } from './http/auth.js';
import { registerMeRoutes } from './http/me.js';
import { registerWorldRoutes } from './http/worlds.js';
import { registerMemberRoutes } from './http/members.js';
import { registerMarkRoutes } from './http/marks.js';
import { registerImportRoutes } from './http/import.js';
import { registerResourceNodeRoutes } from './http/resourceNodes.js';
import { registerRouteRoutes } from './http/routes.js';
import { registerSnapshotRoutes } from './http/snapshots.js';
import { registerSaveRoutes, SAVE_UPLOAD_ROUTE } from './http/saves.js';
import { registerUploadTokenRoutes } from './http/uploadTokens.js';
import { registerEventRoutes } from './http/events.js';
import { registerInviteRoutes } from './http/invites.js';
import { registerSpa } from './http/spa.js';
import { appVersion } from './version/appVersion.js';
import { redactUrl } from './redact.js';
import { SseHub } from './sse/hub.js';
import { createParsePool, type SaveParser } from './parse/pool.js';

export interface AppDeps {
  config: Config;
  db: Db;
  dataset: DatasetIndex;
  discord: DiscordClient;
  now?: () => number;
  hub?: SseHub;
  /** Parses saves uploaded by the save watcher; default a worker pool on the dataset (tests pass a fake). */
  saveParser?: SaveParser;
}

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const SECURITY_HEADERS: [string, string][] = [
  ['X-Content-Type-Options', 'nosniff'],
  ['Referrer-Policy', 'same-origin'],
  ['X-Frame-Options', 'DENY'],
  ['Content-Security-Policy', "frame-ancestors 'none'"],
];
const LIMITED_ROUTES = /^\/(api|auth|invite)(\/|$)/;
/**
 * Routes that authenticate with a bearer token and never read the session cookie (the save watcher's upload). A
 * cross-site page cannot set `Authorization`, so the Origin and JSON checks do not apply. Matched on the route
 * pattern: a request only matches when it reaches that handler.
 */
const BEARER_ROUTES = new Set([`POST ${SAVE_UPLOAD_ROUTE}`]);

/** GET/HEAD on anything that is not an API, auth or invite route (matched on the route pattern, so encoding cannot dodge it). */
function isStaticGet(req: FastifyRequest): boolean {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  return !LIMITED_ROUTES.test(req.routeOptions.url ?? req.url);
}

export async function buildApp(input: AppDeps): Promise<FastifyInstance> {
  const deps: AppDeps = {
    ...input,
    hub: input.hub ?? new SseHub(),
  };
  const { config, db } = deps;
  const app = Fastify({
    trustProxy: config.trustProxy,
    logger: config.logLevel === 'silent' ? false : {
      level: config.logLevel,
      serializers: {
        req: req => ({ method: req.method, url: redactUrl(req.url), host: req.host, remoteAddress: req.ip, remotePort: req.socket?.remotePort }),
      },
    },
  });
  const allowedOrigin = new URL(config.publicUrl).origin;

  await app.register(cookie, { secret: config.sessionSecret });
  // Static GETs (tiles, assets, dataset, SPA shell) are exempt: zooming the map alone fetches
  // hundreds of tiles and would otherwise lock the API (incl. mark writes) for that IP.
  await app.register(rateLimit, { global: true, max: 300, timeWindow: '1 minute', allowList: isStaticGet });

  // Runs before routing, so it also guards routes that do not exist (yet).
  app.addHook('onRequest', async (req, reply) => {
    // Every mutation is guarded regardless of path: find-my-way decodes the path
    // before routing, so a path-prefix test could be bypassed by percent-encoding.
    if (!MUTATING.has(req.method)) return;
    if (BEARER_ROUTES.has(`${req.method} ${req.routeOptions.url ?? ''}`)) return;
    const contentType = req.headers['content-type'];
    const emptyDelete =
      req.method === 'DELETE' && !contentType &&
      (req.headers['content-length'] === undefined || req.headers['content-length'] === '0') &&
      req.headers['transfer-encoding'] === undefined;
    const originOk = req.headers.origin === allowedOrigin;
    const typeOk = emptyDelete || (contentType?.startsWith('application/json') ?? false);
    if (!originOk || !typeOk) {
      const body: ApiError = {
        error: 'invalid_origin',
        message: !originOk ? 'Origin not allowed' : 'Content-Type must be application/json',
      };
      return reply.code(403).send(body);
    }
  });

  // Defaults for every response (API and SPA); a route that sets its own (the invite page's stricter CSP) wins.
  // No CSP default-src for the SPA: only framing is restricted here.
  app.addHook('onSend', async (_req, reply) => {
    for (const [name, value] of SECURITY_HEADERS) if (!reply.hasHeader(name)) reply.header(name, value);
  });

  app.setErrorHandler((err: Error & { statusCode?: number; validation?: unknown }, req, reply) => {
    const send = (status: number, error: ApiErrorCode, message: string) =>
      reply.code(status).send({ error, message } satisfies ApiError);
    if (err instanceof HttpError) return send(err.status, err.code, err.message);
    if (err instanceof ZodError || err.validation) return send(400, 'invalid_body', 'Invalid request body');
    if (err.statusCode === 429) return send(429, 'rate_limited', 'Too many requests');
    if (err.statusCode === 400 || err.statusCode === 413 || err.statusCode === 415) {
      return send(err.statusCode, 'invalid_body', 'Invalid request body');
    }
    req.log.error({ err }, 'unhandled error');
    return send(500, 'internal', 'Internal server error');
  });

  app.get('/api/version', async () => ({ version: appVersion() }));

  app.get('/healthz', async () => {
    db.prepare('SELECT 1').get();
    return { ok: true };
  });

  registerSessionLoader(app, db, deps.now ?? Date.now);
  registerAuthRoutes(app, deps);
  registerMeRoutes(app, deps);
  registerWorldRoutes(app, deps);
  registerMemberRoutes(app, deps);
  registerMarkRoutes(app, deps);
  registerImportRoutes(app, deps);
  registerResourceNodeRoutes(app, deps);
  registerRouteRoutes(app, deps);
  registerSnapshotRoutes(app, deps);
  const saveParser = deps.saveParser ?? createParsePool({ dataset: deps.dataset.ds });
  app.addHook('onClose', async () => saveParser.close());
  registerSaveRoutes(app, { ...deps, saveParser });
  registerUploadTokenRoutes(app, deps);
  registerEventRoutes(app, deps);
  registerInviteRoutes(app, deps);
  await registerSpa(app, deps); // last: owns the not-found handler (SPA fallback)
  // One register*(app, deps) call per file in http/.

  return app;
}
