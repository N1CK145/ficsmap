import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { MeDto } from '../../shared/api.js';
import { isWheelSpeed, roundWheelSpeed, WHEEL_SPEED, type UserPrefs } from '../../shared/prefs.js';
import type { AppDeps } from '../app.js';
import { requireUser } from '../auth/guards.js';
import { getPrefs, updatePrefs } from '../domain/users.js';

/** A partial update of the preferences; unknown keys are rejected. */
const PrefsPatch = z.object({
  wheelSpeed: z.number().min(WHEEL_SPEED.min).max(WHEEL_SPEED.max)
    .refine(isWheelSpeed, `Steps of ${WHEEL_SPEED.step}`).transform(roundWheelSpeed),
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
    };
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
