import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { DiscordClient } from '../auth/discord.js';
import type { Config } from '../config.js';
import { releaseUrl } from './appVersion.js';
import type { RollbackPlan } from './guard.js';

/*
 * Maintenance mode: an older version was started on data of a newer one. Nothing touches the
 * database; every page explains the situation, and an owner (OWNER_DISCORD_IDS) can confirm the
 * rollback after signing in with Discord. Sign-in here is stateless (signed cookies), so it needs
 * no database. The terminal path (`rollback` command) does the same without a browser.
 */

export interface MaintenanceState { stored: string; current: string; plan: RollbackPlan }
type Lang = 'en' | 'de';

const TX_MAX_AGE_S = 600;
const OWNER_MAX_AGE_S = 900;
const txSchema = z.object({ state: z.string().min(1), verifier: z.string().min(1) });
const ownerSchema = z.object({ id: z.string().min(1), exp: z.number() });

/** "20261103T120000Z" in a backup file name → a readable UTC date. */
function backupDate(backup: string): string {
  const m = /-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})\d{2}Z\.db$/.exec(backup);
  return m ? `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]} UTC` : backup;
}

/** The situation and what confirming does, as plain sentences (shared by the page and the terminal). */
export function describe(s: MaintenanceState, lang: Lang): { situation: string; effect: string; canConfirm: boolean; action: string } {
  const de = lang === 'de';
  const situation = de
    ? `Dieser Server wurde mit ficsmap v${s.current} gestartet, die Daten stammen aber zuletzt von v${s.stored}. Bis das bestätigt ist, bleibt ficsmap im Wartungsmodus und verändert die Daten nicht.`
    : `This server was started with ficsmap v${s.current}, but the data was last used by v${s.stored}. Until this is confirmed, ficsmap stays in maintenance mode and does not touch the data.`;
  switch (s.plan.kind) {
    case 'restore': {
      const at = backupDate(s.plan.backup);
      return {
        situation,
        effect: de
          ? `Der Rollback stellt das Backup vom ${at} wieder her (angelegt vor dem Update über v${s.current} hinaus). Alles, was seitdem geändert wurde, geht verloren. Die jetzigen Daten werden vorher als Backup-Datei aufbewahrt.`
          : `Rolling back restores the backup from ${at} (taken before the upgrade past v${s.current}). Everything changed since then is lost. The current data is kept as a backup file first.`,
        canConfirm: true,
        action: de ? `Auf v${s.current} zurücksetzen` : `Roll back to v${s.current}`,
      };
    }
    case 'continue':
      return {
        situation,
        effect: de
          ? `Es gibt kein passendes Backup, aber v${s.current} kann die Daten so verwenden, wie sie sind. Mit der Bestätigung läuft ficsmap mit den jetzigen Daten weiter.`
          : `There is no matching backup, but v${s.current} can use the data as it is. Confirming continues with the current data.`,
        canConfirm: true,
        action: de ? `Mit v${s.current} weiter` : `Continue with v${s.current}`,
      };
    case 'blocked':
      return {
        situation,
        effect: de
          ? `Es gibt kein passendes Backup, und die Daten sind zu neu für v${s.current} (Schema ${s.plan.schema}, unterstützt ${s.plan.supported}). Starte wieder v${s.stored} oder stelle ein Backup von Hand wieder her.`
          : `There is no matching backup, and the data is too new for v${s.current} (schema ${s.plan.schema}, supported ${s.plan.supported}). Start v${s.stored} again, or restore a backup by hand.`,
        canConfirm: false,
        action: '',
      };
  }
}

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function langOf(req: FastifyRequest): Lang {
  return /^de\b/i.test(req.headers['accept-language'] ?? '') ? 'de' : 'en';
}

function page(lang: Lang, title: string, body: string, refresh = false): string {
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
${refresh ? '<meta http-equiv="refresh" content="10;url=/">' : ''}<title>${esc(title)}</title>
<style>body{margin:0;background:#15171A;color:#E8E6E3;font:16px/1.5 ui-sans-serif,system-ui,sans-serif;display:grid;place-items:center;min-height:100vh}
main{max-width:36rem;margin:1rem;padding:1.5rem;background:#1E2125;border:1px solid #2E3238;border-radius:4px}
h1{font-size:1.4rem;margin:0 0 1rem}p{margin:0 0 1rem}.muted{color:#9BA1A8;font-size:.9rem}a{color:#F28C28}
button,.btn{display:inline-block;background:#F28C28;color:#15171A;border:0;border-radius:4px;padding:.6rem 1rem;font:inherit;font-weight:600;cursor:pointer;text-decoration:none}
code{background:#15171A;padding:.1rem .3rem;border-radius:4px}</style></head><body><main>${body}</main></body></html>`;
}

export interface MaintenanceDeps {
  config: Config;
  discord: DiscordClient;
  state: MaintenanceState;
  /** Carries out the confirmed rollback; the caller restarts afterwards. */
  confirm(): Promise<void>;
  /** Called once a confirmed rollback was answered, to restart into the old version. */
  restart(): void;
  now?: () => number;
}

export async function buildMaintenanceApp(deps: MaintenanceDeps): Promise<FastifyInstance> {
  const { config, state } = deps;
  const now = deps.now ?? Date.now;
  const app = Fastify({ trustProxy: config.trustProxy, logger: config.logLevel === 'silent' ? false : { level: config.logLevel } });
  await app.register(cookie, { secret: config.sessionSecret });
  await app.register(rateLimit, { global: true, max: 60, timeWindow: '1 minute' });
  // The confirm form posts urlencoded; the body itself is not used.
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, _body, done) => done(null, {}));
  app.addHook('onSend', async (_req, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff').header('X-Frame-Options', 'DENY').header('Cache-Control', 'no-store')
      .header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'");
  });

  const cookieBase = { httpOnly: true, secure: config.cookieSecure, sameSite: 'lax' as const, path: '/' };
  const allowedOrigin = new URL(config.publicUrl).origin;
  let done = false;

  const signed = <T>(raw: string | undefined, schema: z.ZodType<T>): T | undefined => {
    const u = raw ? app.unsignCookie(raw) : undefined;
    if (!u?.valid || u.value === null) return undefined;
    try { return schema.parse(JSON.parse(u.value)); } catch { return undefined; }
  };
  const owner = (req: FastifyRequest): string | undefined => {
    const o = signed(req.cookies.maint_owner, ownerSchema);
    return o && o.exp > now() && config.ownerDiscordIds.has(o.id) ? o.id : undefined;
  };
  const html = (reply: FastifyReply, code: number, body: string) => reply.code(code).type('text/html; charset=utf-8').send(body);

  app.get('/healthz', async (_req, reply) => reply.code(503).send({ ok: false, maintenance: true }));
  app.get('/api/version', async () => ({ version: state.current, maintenance: true }));

  app.get('/maintenance/login', async (_req, reply) => {
    const tx = { state: randomBytes(24).toString('base64url'), verifier: randomBytes(32).toString('base64url') };
    const challenge = createHash('sha256').update(tx.verifier).digest('base64url');
    reply.setCookie('maint_tx', JSON.stringify(tx), { ...cookieBase, maxAge: TX_MAX_AGE_S, signed: true });
    return reply.redirect(deps.discord.authorizeUrl(tx.state, challenge), 302);
  });

  // The Discord app's only redirect URI is /auth/discord/callback, so maintenance mode answers it too.
  app.get('/auth/discord/callback', async (req, reply) => {
    const q = req.query as { code?: unknown; state?: unknown };
    const tx = signed(req.cookies.maint_tx, txSchema);
    reply.clearCookie('maint_tx', cookieBase);
    const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
    if (!tx || typeof q.code !== 'string' || typeof q.state !== 'string' || !same(q.state, tx.state)) return reply.redirect('/?login=failed', 302);
    try {
      const profile = await deps.discord.exchangeCode(q.code, tx.verifier);
      if (!config.ownerDiscordIds.has(profile.id)) return reply.redirect('/?login=not-owner', 302);
      reply.setCookie('maint_owner', JSON.stringify({ id: profile.id, exp: now() + OWNER_MAX_AGE_S * 1000 }),
        { ...cookieBase, maxAge: OWNER_MAX_AGE_S, signed: true });
      return reply.redirect('/', 302);
    } catch (err) {
      req.log.error({ err }, 'discord code exchange failed (maintenance)');
      return reply.redirect('/?login=failed', 302);
    }
  });

  app.post('/maintenance/rollback', async (req, reply) => {
    const lang = langOf(req);
    const d = describe(state, lang);
    if (req.headers.origin !== allowedOrigin) return html(reply, 403, page(lang, 'Forbidden', '<h1>Forbidden</h1><p>Origin not allowed.</p>'));
    if (!owner(req)) return reply.redirect('/', 303);
    if (!d.canConfirm) return reply.redirect('/', 303);
    if (!done) {
      try {
        await deps.confirm();
        done = true;
      } catch (err) {
        req.log.error({ err }, 'rollback failed');
        return html(reply, 500, page(lang, 'ficsmap', `<h1>${lang === 'de' ? 'Rollback fehlgeschlagen' : 'Rollback failed'}</h1><p>${esc(String(err))}</p>`));
      }
      reply.raw.once('finish', () => deps.restart());
    }
    const msg = lang === 'de'
      ? `<h1>Erledigt</h1><p>ficsmap startet jetzt mit v${esc(state.current)} neu. Diese Seite lädt in ein paar Sekunden neu.</p>`
      : `<h1>Done</h1><p>ficsmap is restarting with v${esc(state.current)}. This page reloads in a few seconds.</p>`;
    return html(reply, 200, page(lang, 'ficsmap', msg, true));
  });

  app.get('/*', async (req, reply) => {
    const lang = langOf(req);
    const de = lang === 'de';
    const d = describe(state, lang);
    const isOwner = owner(req) !== undefined;
    const login = (req.query as { login?: unknown }).login;
    const note = login === 'not-owner'
      ? `<p class="muted">${de ? 'Dieses Discord-Konto ist kein Owner dieses Servers.' : 'This Discord account is not an owner of this server.'}</p>`
      : login === 'failed' ? `<p class="muted">${de ? 'Die Anmeldung hat nicht geklappt.' : 'Signing in did not work.'}</p>` : '';
    const confirm = !d.canConfirm ? '' : isOwner
      ? `<form method="post" action="/maintenance/rollback"><button type="submit">${esc(d.action)}</button></form>`
      : `<p><a class="btn" href="/maintenance/login">${de ? 'Als Owner mit Discord anmelden' : 'Sign in with Discord as an owner'}</a></p>`;
    const terminal = `<p class="muted">${de ? 'Oder im Terminal' : 'Or in a terminal'}: <code>docker compose run --rm ficsmap rollback</code></p>`;
    const body = `<h1>${de ? 'ficsmap ist im Wartungsmodus' : 'ficsmap is in maintenance mode'}</h1>
<p>${esc(d.situation)}</p><p>${esc(d.effect)}</p>${note}${confirm}${d.canConfirm ? terminal : ''}
<p class="muted"><a href="${releaseUrl(state.current)}">ficsmap v${esc(state.current)}</a></p>`;
    return html(reply, 503, page(lang, 'ficsmap – maintenance', body));
  });

  return app;
}
