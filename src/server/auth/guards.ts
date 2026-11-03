import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import type { Db } from '../db/db.js';
import type { UserRow } from '../domain/users.js';
import { HttpError } from '../errors.js';
import { getWorld, roleOf, type WorldRow } from '../domain/worlds.js';
import { sessionUser } from './session.js';

declare module 'fastify' {
  interface FastifyRequest {
    user?: UserRow;
    world?: WorldRow;
    role?: 'owner' | 'member';
  }
}

/** Loads the session user into req.user (undefined when absent or expired). */
export function registerSessionLoader(app: FastifyInstance, db: Db, now: () => number): void {
  app.decorateRequest('user', undefined);
  app.addHook('onRequest', async req => {
    const sid = req.cookies.sid;
    req.user = sid ? sessionUser(db, sid, now()) ?? undefined : undefined;
  });
}

export const requireUser: preHandlerHookHandler = async req => {
  if (!req.user) throw new HttpError(401, 'unauthorized', 'Login required');
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Needs the db, so it is built per app. Non-members and unknown worlds both get 404. */
export function makeWorldGuards(db: Db): { requireMember: preHandlerHookHandler; requireOwner: preHandlerHookHandler } {
  const requireMember: preHandlerHookHandler = async req => {
    if (!req.user) throw new HttpError(401, 'unauthorized', 'Login required');
    const id = (req.params as { id?: string }).id;
    if (!id || !UUID_RE.test(id)) throw new HttpError(404, 'not_found', 'Not found');
    const role = roleOf(db, id, req.user.id);
    const world = role ? getWorld(db, id) : undefined;
    if (!role || !world) throw new HttpError(404, 'not_found', 'Not found');
    req.world = world;
    req.role = role;
  };
  const requireOwner: preHandlerHookHandler = async function (req, reply) {
    await requireMember.call(this, req, reply, () => undefined);
    if (req.role !== 'owner') throw new HttpError(403, 'forbidden', 'Owner only');
  };
  return { requireMember, requireOwner };
}
