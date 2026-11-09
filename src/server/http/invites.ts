import type { FastifyInstance, FastifyReply } from 'fastify';
import type { AppDeps } from '../app.js';
import { makeWorldGuards, requireUser } from '../auth/guards.js';
import { acceptInvite, createInvite, findInvite, revokeInvites } from '../domain/invites.js';
import { isServerOwner } from '../domain/users.js';
import { getWorld, progress } from '../domain/worlds.js';
import { HttpError } from '../errors.js';
import { localeFromAcceptLanguage } from '../../shared/i18n.js';
import { renderInvitePage, type InvitePage } from './invitePage.js';

export function registerInviteRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db, config } = deps;
  const now = deps.now ?? Date.now;
  const { requireAdmin } = makeWorldGuards(db);
  const inviteUrl = (token: string) => `${config.publicUrl.replace(/\/$/, '')}/invite/${token}`;
  const displayName = (userId: number) =>
    (db.prepare('SELECT display_name FROM users WHERE id = ?').get(userId) as { display_name: string } | undefined)?.display_name ?? '';

  app.get('/api/worlds/:id/invite-link', { preHandler: requireAdmin }, async (req, reply) => {
    const { token, expiresAt } = createInvite(db, { worldId: req.world!.id, createdBy: req.user!.id, now: now() });
    reply.header('Cache-Control', 'no-store');
    return { url: inviteUrl(token), expiresAt };
  });

  // A general invite (no world): only server owners (OWNER_DISCORD_IDS) may hand them out.
  app.get('/api/invite-link', { preHandler: requireUser }, async (req, reply) => {
    if (!isServerOwner(db, config.ownerDiscordIds, req.user!.id)) {
      throw new HttpError(403, 'forbidden', 'Only server owners can create general invites');
    }
    const { token, expiresAt } = createInvite(db, { worldId: null, createdBy: req.user!.id, now: now() });
    reply.header('Cache-Control', 'no-store');
    return { url: inviteUrl(token), expiresAt };
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

    const invite = findInvite(db, token, now(), config.ownerDiscordIds);
    // Visitors learn nothing; a logged-in user is told the invite is no longer valid (spec §8).
    if (!invite) return html({ kind: req.user ? 'no_longer_valid' : 'invalid' });

    if (invite.worldId === null) {
      // Signed in already: there is nothing to create, and the link stays unused for someone else.
      if (req.user) return reply.redirect('/', 302);
      return html({ kind: 'signup', owner: displayName(invite.createdBy), expiresAt: invite.expiresAt, token });
    }

    if (!req.user) {
      const world = getWorld(db, invite.worldId)!; // the invite row goes with its world
      const { done, total } = progress(db, world.id, deps.dataset);
      return html({
        kind: 'landing',
        owner: displayName(world.owner_id),
        world: world.name,
        percent: total === 0 ? 0 : Math.round((done / total) * 100),
        expiresAt: invite.expiresAt,
        token,
      });
    }

    const userId = req.user.id;
    // Looked up again inside the transaction, so two tabs cannot both use the link.
    const result = db.transaction(() => {
      const current = findInvite(db, token, now(), config.ownerDiscordIds);
      return current ? acceptInvite(db, userId, current, now()) : { kind: 'invalid' as const };
    })();
    if (result.kind === 'invalid') return html({ kind: 'no_longer_valid' });
    if (result.kind === 'joined') deps.hub!.broadcast(result.worldId, { type: 'members' });
    return reply.redirect(`/w/${result.worldId}?${result.kind === 'joined' ? 'joined' : 'already'}=1`, 302);
  });
}
