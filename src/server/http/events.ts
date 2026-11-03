import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../app.js';
import { makeWorldGuards } from '../auth/guards.js';

const HEARTBEAT_MS = 25_000;

export function registerEventRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db, hub } = deps;
  const { requireMember } = makeWorldGuards(db);

  app.get('/api/worlds/:id/events', { preHandler: requireMember }, async (req, reply) => {
    const worldId = req.world!.id;
    reply.hijack();
    const res = reply.raw;
    let unsubscribe: (() => void) | undefined;
    let heartbeat: NodeJS.Timeout | undefined;
    let done = false;

    /** Idempotent: stops the heartbeat, leaves the hub and ends the response once. */
    const cleanup = (): void => {
      if (done) return;
      done = true;
      clearInterval(heartbeat);
      unsubscribe?.();
      if (!res.writableEnded && !res.destroyed) res.end();
    };
    const safeWrite = (chunk: string): void => {
      if (done || res.writableEnded || res.destroyed) return;
      res.write(chunk);
    };

    res.on('error', cleanup);
    req.raw.on('close', cleanup);
    if (req.raw.destroyed) {
      cleanup();
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
      Connection: 'keep-alive',
    });
    res.write(': ok\n\n');
    heartbeat = setInterval(() => safeWrite(': ping\n\n'), HEARTBEAT_MS);
    unsubscribe = hub!.add(worldId, req.user!.id, safeWrite, cleanup);
  });

  // preClose runs before the server waits for open connections; onClose would hang on live streams.
  app.addHook('preClose', async () => hub!.closeAll());
}
