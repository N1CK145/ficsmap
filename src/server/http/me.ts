import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { LOGIN_PROVIDERS, type LoginProvider, type MeDto } from '../../shared/api.js';
import { DATE_FORMATS, isWheelSpeed, roundWheelSpeed, THEMES, WHEEL_SPEED, type UserPrefs } from '../../shared/prefs.js';
import type { AppDeps } from '../app.js';
import { requireUser } from '../auth/guards.js';
import { getPrefs, isServerOwner, listIdentities, unlinkIdentity, updatePrefs } from '../domain/users.js';
import { HttpError } from '../errors.js';

/** A partial update of the preferences; unknown keys are rejected. */
const PrefsPatch = z.object({
  wheelSpeed: z.number().min(WHEEL_SPEED.min).max(WHEEL_SPEED.max)
    .refine(isWheelSpeed, `Steps of ${WHEEL_SPEED.step}`).transform(roundWheelSpeed),
  dateFormat: z.enum(DATE_FORMATS),
  theme: z.enum(THEMES),
}).partial().strict();

export function registerMeRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db } = deps;

  app.get('/api/me', { preHandler: requireUser }, async (req): Promise<MeDto> => {
    const u = req.user!;
    return {
      id: u.id,
      displayName: u.display_name,
      avatarUrl: u.avatar_url,
      email: u.email,
      datasetVersion: deps.config.datasetVersion,
      prefs: getPrefs(db, u.id),
      serverOwner: isServerOwner(db, deps.config, u.id),
      identities: listIdentities(db, u.id),
    };
  });

  // Removes one of the user's sign-ins (linked from the profile); 404 without it, 409 for the last one.
  app.delete('/api/me/identities/:provider', { preHandler: requireUser }, async (req, reply) => {
    const provider = (req.params as { provider: string }).provider;
    if (!(LOGIN_PROVIDERS as readonly string[]).includes(provider)) throw new HttpError(404, 'not_found', 'Not found');
    const result = unlinkIdentity(db, req.user!.id, provider as LoginProvider);
    if (result === 'none') throw new HttpError(404, 'not_found', 'Not found');
    if (result === 'last') throw new HttpError(409, 'last_identity', 'The only sign-in cannot be removed');
    return reply.code(204).send();
  });

  // The client saves a setting a moment after the last change, so this sees a few calls a minute at most.
  app.patch('/api/me/prefs', {
    preHandler: requireUser,
    config: {
      rateLimit: {
        max: 60,
        timeWindow: '1 minute',
        keyGenerator: (req: { user?: { id: number }; ip: string }) => (req.user ? `u${req.user.id}` : req.ip),
      },
    },
  }, async (req): Promise<UserPrefs> => {
    const patch = PrefsPatch.parse(req.body);
    return updatePrefs(db, req.user!.id, patch);
  });
}
