import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AppDeps } from '../app.js';
import type { SnapshotSummary } from '../../shared/factory/snapshot.js';
import { MAX_SNAPSHOT_GZIP_BYTES } from '../../shared/factory/storage.js';
import { makeWorldGuards } from '../auth/guards.js';
import { HttpError } from '../errors.js';
import {
  decodeStored, decodeUpload, deleteSnapshot, encodeSnapshot, listSnapshots, parseSnapshot, snapshotData, storeSnapshot,
} from '../domain/snapshots.js';

const SNAPSHOT_ID = /^[1-9][0-9]{0,15}$/;
/** Stored snapshots never change (a re-import gets a new id), so a member's browser keeps them. */
const IMMUTABLE = 'private, max-age=31536000, immutable';

function snapshotId(params: unknown): number {
  const sid = (params as { sid?: string }).sid ?? '';
  if (!SNAPSHOT_ID.test(sid)) throw new HttpError(404, 'not_found', 'Not found');
  return Number(sid);
}

/**
 * Factory snapshots (one per save and world) for the factory map's timeline:
 * - `POST /api/worlds/:id/snapshots` (owner, like the save import): the snapshot JSON, gzip-compressed, with
 *   `Content-Type: application/json` and `Content-Encoding: gzip`; at most 4 MB compressed and 32 MB decompressed.
 *   Answers 201 with its `SnapshotSummary`.
 * - `GET /api/worlds/:id/snapshots` (members): the summaries, newest save first.
 * - `GET /api/worlds/:id/snapshots/:sid` (members): the snapshot, served as stored (gzip) and cached as immutable.
 * - `DELETE /api/worlds/:id/snapshots/:sid` (owner).
 * Changes broadcast `snapshots`.
 */
export function registerSnapshotRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db, hub } = deps;
  const now = deps.now ?? Date.now;
  const { requireMember, requireOwner } = makeWorldGuards(db);

  // An encapsulated scope: its JSON parser takes the gzip body as raw bytes, the rest of the API keeps the default.
  void app.register(async scope => {
    scope.addContentTypeParser('application/json', { parseAs: 'buffer', bodyLimit: MAX_SNAPSHOT_GZIP_BYTES }, async (req: FastifyRequest, body: Buffer) => {
      if (req.headers['content-encoding'] !== 'gzip') throw new HttpError(400, 'invalid_body', 'The snapshot must be sent gzip-compressed');
      return decodeUpload(body);
    });

    scope.post('/api/worlds/:id/snapshots', {
      // Checked before the body is read: only the owner gets the server to decompress and parse an upload.
      onRequest: requireOwner,
      bodyLimit: MAX_SNAPSHOT_GZIP_BYTES,
      config: {
        rateLimit: {
          // Adding older saves uploads one snapshot per save; a few dozen at once are normal.
          max: 120,
          timeWindow: '1 hour',
          keyGenerator: (req: { params: unknown; user?: { id: number }; ip: string }) =>
            `snapshot:${(req.params as { id: string }).id}:${req.user?.id ?? req.ip}`,
        },
      },
    }, async (req, reply): Promise<SnapshotSummary> => {
      const snapshot = parseSnapshot(req.body);
      const gz = await encodeSnapshot(snapshot);
      const { summary, rev } = storeSnapshot(db, req.world!.id, snapshot, gz, req.user!.id, now());
      hub!.broadcast(req.world!.id, { type: 'snapshots', rev });
      return reply.code(201).send(summary);
    });

    scope.get('/api/worlds/:id/snapshots', { preHandler: requireMember }, async (req): Promise<SnapshotSummary[]> =>
      listSnapshots(db, req.world!.id));

    scope.get('/api/worlds/:id/snapshots/:sid', { preHandler: requireMember }, async (req, reply) => {
      const data = snapshotData(db, req.world!.id, snapshotId(req.params));
      if (!data) throw new HttpError(404, 'not_found', 'Not found');
      reply.header('cache-control', IMMUTABLE).header('vary', 'accept-encoding').type('application/json; charset=utf-8');
      if (/\bgzip\b/i.test(req.headers['accept-encoding'] ?? '')) return reply.header('content-encoding', 'gzip').send(data);
      return reply.send(await decodeStored(data));
    });

    scope.delete('/api/worlds/:id/snapshots/:sid', { preHandler: requireOwner }, async (req, reply) => {
      const { rev } = deleteSnapshot(db, req.world!.id, snapshotId(req.params));
      hub!.broadcast(req.world!.id, { type: 'snapshots', rev });
      return reply.code(204).send();
    });
  });
}
