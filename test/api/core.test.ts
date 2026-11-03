import { makeTestApp } from './helpers.js';

const json = { origin: 'https://ficsmap.test', 'content-type': 'application/json' };

describe('core app', () => {
  it('GET /healthz returns ok', async () => {
    const { app } = await makeTestApp();
    const res = await app.inject('/healthz');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });
  it('rejects a foreign Origin before routing', async () => {
    const { app } = await makeTestApp();
    const res = await app.inject({
      method: 'POST', url: '/api/worlds', payload: '{}',
      headers: { ...json, origin: 'https://evil.example' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('invalid_origin');
  });
  it('rejects a missing Origin', async () => {
    const { app } = await makeTestApp();
    const res = await app.inject({ method: 'POST', url: '/api/worlds', payload: '{}', headers: { 'content-type': 'application/json' } });
    expect(res.statusCode).toBe(403);
  });
  it('rejects a text/plain body', async () => {
    const { app } = await makeTestApp();
    const res = await app.inject({
      method: 'POST', url: '/api/worlds', payload: 'x',
      headers: { origin: 'https://ficsmap.test', 'content-type': 'text/plain' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('invalid_origin');
  });
  it('guards POST /auth/logout', async () => {
    const { app } = await makeTestApp();
    const res = await app.inject({ method: 'POST', url: '/auth/logout', payload: '{}', headers: { ...json, origin: 'https://evil.example' } });
    expect(res.statusCode).toBe(403);
  });
  it('lets a bodyless DELETE without content-type pass the check', async () => {
    const { app } = await makeTestApp();
    const res = await app.inject({ method: 'DELETE', url: '/api/nope/x', headers: { origin: 'https://ficsmap.test' } });
    expect(res.statusCode).toBe(404);
  });
  it('requires content-type for POST even without body', async () => {
    const { app } = await makeTestApp();
    const res = await app.inject({ method: 'POST', url: '/api/worlds', headers: { origin: 'https://ficsmap.test' } });
    expect(res.statusCode).toBe(403);
  });
  it('passes a valid mutation through to a 404 in error shape', async () => {
    const { app } = await makeTestApp();
    const res = await app.inject({ method: 'POST', url: '/api/nope', payload: '{}', headers: json });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'not_found', message: 'Not found' });
  });
  it('does not guard GET or non-api paths', async () => {
    const { app } = await makeTestApp();
    expect((await app.inject('/api/nope')).statusCode).toBe(404);
  });
  it('maps HttpError, ZodError and unknown errors', async () => {
    const { app } = await makeTestApp();
    const { HttpError } = await import('../../src/server/errors.js');
    const { z } = await import('zod');
    app.get('/t/http', async () => { throw new HttpError(403, 'forbidden', 'nope'); });
    app.get('/t/zod', async () => { z.object({ a: z.string() }).parse({}); });
    app.get('/t/boom', async () => { throw new Error('secret detail'); });
    const h = await app.inject('/t/http');
    expect([h.statusCode, h.json()]).toEqual([403, { error: 'forbidden', message: 'nope' }]);
    expect((await app.inject('/t/zod')).json().error).toBe('invalid_body');
    const b = await app.inject('/t/boom');
    expect(b.statusCode).toBe(500);
    expect(b.json()).toEqual({ error: 'internal', message: 'Internal server error' });
  });
  it('guards mutations regardless of path, including percent-encoded ones', async () => {
    const { app } = await makeTestApp();
    app.post('/api/x', async () => ({ ok: true }));
    app.post('/other', async () => ({ ok: true }));
    const evil = { origin: 'https://evil.example', 'content-type': 'text/plain' };
    for (const url of ['/%61pi/x', '/auth/%6Cogout', '/other', '/api/x']) {
      const res = await app.inject({ method: 'POST', url, payload: 'x', headers: evil });
      expect([url, res.statusCode]).toEqual([url, 403]);
    }
    const ok = await app.inject({ method: 'POST', url: '/%61pi/x', payload: '{}', headers: json });
    expect(ok.statusCode).toBe(200);
  });
});

describe('security headers', () => {
  const expectBase = (h: Record<string, unknown>, label: string) => {
    expect(h['x-content-type-options'], label).toBe('nosniff');
    expect(h['x-frame-options'], label).toBe('DENY');
  };
  it('sets nosniff, same-origin referrer, DENY framing and frame-ancestors on API responses', async () => {
    const { app } = await makeTestApp();
    for (const url of ['/api/me', '/healthz', '/api/nope']) {
      const res = await app.inject(url);
      expectBase(res.headers, url);
      expect(res.headers['referrer-policy'], url).toBe('same-origin');
      expect(res.headers['content-security-policy'], url).toBe("frame-ancestors 'none'");
    }
  });
  it('keeps the stricter CSP and referrer policy of the invite page', async () => {
    const { app } = await makeTestApp();
    const res = await app.inject('/invite/garbage');
    expectBase(res.headers, 'invite');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['content-security-policy']).toBe(
      "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; form-action 'none'");
  });
});
