import { isIP } from 'node:net';
import proxyAddr from '@fastify/proxy-addr';
import type { FastifyInstance } from 'fastify';
import type { Config } from './config.js';

/**
 * Makes `req.ip` (and so every rate limit keyed on it) the address from `config.clientIpHeader`, e.g.
 * `CF-Connecting-IP` behind Cloudflare, where `X-Forwarded-For` would end in a Cloudflare edge address. The header is
 * only believed when the direct peer is a trusted proxy (`TRUST_PROXY`, same syntax as Fastify's) and it holds a
 * valid IP; otherwise `req.ip` stays Fastify's forwarded address. Registered before the rate limit's route hooks run.
 */
export function registerClientIpHeader(app: FastifyInstance, config: Pick<Config, 'trustProxy' | 'clientIpHeader'>): void {
  const header = config.clientIpHeader;
  if (!header || !config.trustProxy) return;
  const trusted = proxyAddr.compile(config.trustProxy.split(',').map(s => s.trim()));
  app.addHook('onRequest', async req => {
    const peer = req.raw.socket?.remoteAddress;
    if (!peer || !trusted(peer, 0)) return;
    const raw = req.headers[header];
    const value = (Array.isArray(raw) ? raw[raw.length - 1] : raw)?.trim();
    if (!value || isIP(value) === 0) return;
    Object.defineProperty(req, 'ip', { value, configurable: true });
  });
}
