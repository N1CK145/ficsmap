import { makeTestApp, testConfig } from './helpers.js';

const PROXY = '10.0.0.1';

/** Sends /auth/login (10 per minute and IP) n times from `remoteAddress` with the given headers; returns the last status. */
async function hit(app: Awaited<ReturnType<typeof makeTestApp>>['app'], n: number, remoteAddress: string, headers: Record<string, string> = {}) {
  let last = 0;
  for (let i = 0; i < n; i++) last = (await app.inject({ url: '/auth/login', remoteAddress, headers })).statusCode;
  return last;
}

describe('client IP header (CLIENT_IP_HEADER, e.g. CF-Connecting-IP)', () => {
  const config = { ...testConfig, trustProxy: PROXY, clientIpHeader: 'cf-connecting-ip' };

  it('rate-limits per header IP when the request comes from the trusted proxy', async () => {
    const { app } = await makeTestApp({ config });
    expect(await hit(app, 10, PROXY, { 'cf-connecting-ip': '203.0.113.1' })).toBe(302);
    expect(await hit(app, 1, PROXY, { 'cf-connecting-ip': '203.0.113.1' })).toBe(429);
    // Another client behind the same proxy has its own budget.
    expect(await hit(app, 1, PROXY, { 'cf-connecting-ip': '203.0.113.2' })).toBe(302);
  });

  it('ignores the header from a peer that is not a trusted proxy (cannot dodge the limit by spoofing it)', async () => {
    const { app } = await makeTestApp({ config });
    for (let i = 0; i < 10; i++) await hit(app, 1, '198.51.100.7', { 'cf-connecting-ip': `203.0.113.${i}` });
    expect(await hit(app, 1, '198.51.100.7', { 'cf-connecting-ip': '203.0.113.99' })).toBe(429);
  });

  it('falls back to the forwarded address when the header is missing or not an IP', async () => {
    const { app } = await makeTestApp({ config });
    const xff = { 'x-forwarded-for': '192.0.2.5' };
    expect(await hit(app, 5, PROXY, xff)).toBe(302);
    expect(await hit(app, 5, PROXY, { ...xff, 'cf-connecting-ip': 'not-an-ip' })).toBe(302);
    expect(await hit(app, 1, PROXY, xff)).toBe(429);
  });

  it('is off by default: the header changes nothing', async () => {
    const { app } = await makeTestApp({ config: { ...testConfig, trustProxy: PROXY } });
    for (let i = 0; i < 10; i++) await hit(app, 1, PROXY, { 'cf-connecting-ip': `203.0.113.${i}` });
    expect(await hit(app, 1, PROXY, { 'cf-connecting-ip': '203.0.113.99' })).toBe(429);
  });
});
