import type { FastifyInstance, FastifyReply } from 'fastify';
import type { AppDeps } from '../app.js';
import { makeWorldGuards } from '../auth/guards.js';
import { acceptInvite, revokeInvites } from '../domain/invites.js';
import { getWorld, progress } from '../domain/worlds.js';
import { localeFromAcceptLanguage } from '../../shared/i18n.js';
import { renderInvitePage, type InvitePage } from './invitePage.js';

export function registerInviteRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db, config } = deps;
  const now = deps.now ?? Date.now;
  const { requireAdmin } = makeWorldGuards(db);

  app.get('/api/worlds/:id/invite-link', { preHandler: requireAdmin }, async (req, reply) => {
    const { token, expiresAt } = await deps.invites!.sign(req.world!.id, req.world!.invite_epoch);
    reply.header('Cache-Control', 'no-store');
    return { url: `${config.publicUrl.replace(/\/$/, '')}/invite/${token}`, expiresAt };
  });

  app.post('/api/worlds/:id/invite-links/revoke', { preHandler: requireAdmin }, async req => {
    revokeInvites(db, req.world!.id);
    return { ok: true };
  });

  const noindex = (reply: FastifyReply) => reply
    .header('Cache-Control', 'no-store')
    .header('X-Robots-Tag', 'noindex')
    .header('Referrer-Policy', 'no-referrer')
    .header('X-Content-Type-Options', 'nosniff')
    .header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; form-action 'none'");

  app.get('/invite/:token', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    noindex(reply);
    const locale = localeFromAcceptLanguage(req.headers['accept-language']);
    const html = (page: InvitePage) => reply.type('text/html; charset=utf-8').send(renderInvitePage(page, locale));
    const token = (req.params as { token: string }).token;

    const claims = await deps.invites!.verify(token);
    const world = claims ? getWorld(db, claims.worldId) : undefined;
    if (!claims || !world || world.invite_epoch !== claims.ep) {
      // Visitors learn nothing; a logged-in user is told the invite is no longer valid (spec §8).
      return html({ kind: req.user ? 'no_longer_valid' : 'invalid' });
    }

    if (!req.user) {
      const owner = db.prepare('SELECT display_name FROM users WHERE id = ?').get(world.owner_id) as
        { display_name: string } | undefined;
      const { done, total } = progress(db, world.id, deps.dataset);
      return html({
        kind: 'landing',
        owner: owner?.display_name ?? '',
        world: world.name,
        percent: total === 0 ? 0 : Math.round((done / total) * 100),
        expiresAt: claims.exp * 1000,
        token,
      });
    }

    const userId = req.user.id;
    const result = db.transaction(() => acceptInvite(db, userId, claims, now()))();
    if (result.kind === 'invalid') return html({ kind: 'no_longer_valid' });
    if (result.kind === 'joined') deps.hub!.broadcast(result.worldId, { type: 'members' });
    return reply.redirect(`/w/${result.worldId}?${result.kind === 'joined' ? 'joined' : 'already'}=1`, 302);
  });
}
