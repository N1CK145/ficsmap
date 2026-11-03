import { createReadStream, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';
import type { ApiError } from '../../shared/api.js';
import type { AppDeps } from '../app.js';

const IMMUTABLE = 'public, max-age=31536000, immutable';
const SERVER_PREFIXES = ['/api', '/auth', '/invite', '/data', '/healthz'];

/** Decoded path of a request URL (the router decodes before matching), or null if malformed. */
function pathOf(url: string): string | null {
  const i = url.search(/[?#]/);
  try {
    return decodeURIComponent(i < 0 ? url : url.slice(0, i));
  } catch {
    return null;
  }
}

function isServerPath(path: string): boolean {
  return SERVER_PREFIXES.some(p => path.startsWith(p));
}

/** Static files (dataset, web build) plus the SPA fallback, which doubles as the not-found handler. */
export async function registerSpa(app: FastifyInstance, { config }: AppDeps): Promise<void> {
  const webDir = resolve(config.webDir);
  const datasetDir = resolve(config.datasetDir);
  const indexFile = join(webDir, 'index.html');

  if (existsSync(datasetDir)) {
    await app.register(fastifyStatic, {
      root: datasetDir,
      prefix: '/data/',
      // JSON is rebuilt in place (e.g. biome recalibration), so it revalidates by ETag; tiles and icons never change.
      setHeaders: (res, path) => res.header('Cache-Control', /\.(geo)?json$/.test(path) ? 'no-cache' : IMMUTABLE),
    });
  }
  if (existsSync(webDir)) {
    await app.register(fastifyStatic, {
      root: webDir,
      prefix: '/',
      wildcard: false,
      index: false,
      decorateReply: !existsSync(datasetDir), // the dataset plugin (registered first) decorates when it exists
      setHeaders: (res, path) => res.header('Cache-Control',
        path.startsWith(join(webDir, 'assets') + '/') ? IMMUTABLE : 'no-cache'),
    });
  }

  const notFound = (message: string): ApiError => ({ error: 'not_found', message });

  app.setNotFoundHandler((req, reply) => {
    const path = pathOf(req.url);
    if ((req.method !== 'GET' && req.method !== 'HEAD') || path === null || isServerPath(path) || path.startsWith('/assets/')) {
      return reply.code(404).send(notFound('Not found'));
    }
    if (!existsSync(indexFile)) return reply.code(404).send(notFound('web app not built'));
    return reply.type('text/html; charset=utf-8').header('Cache-Control', 'no-cache')
      .send(createReadStream(indexFile));
  });
}
