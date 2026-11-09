import { makeTestApp } from './helpers.js';

const json = { origin: 'https://ficsmap.test', 'content-type': 'application/json' };

describe('user preferences', () => {
  it('GET /api/me carries the preferences, empty for a new account', async () => {
    const { app, login } = await makeTestApp();
    const cookie = await login('owner-1');
    const res = await app.inject({ url: '/api/me', headers: { cookie } });
    expect(res.json().prefs).toEqual({});
  });

  it('PATCH /api/me/prefs saves the wheel speed on the account and returns all preferences', async () => {
    const { app, login } = await makeTestApp();
    const cookie = await login('owner-1');
    const res = await app.inject({ method: 'PATCH', url: '/api/me/prefs', payload: { wheelSpeed: 1.5 }, headers: { ...json, cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ wheelSpeed: 1.5 });
    // Another session of the same account (another device) sees it.
    const other = await login('owner-1');
    expect((await app.inject({ url: '/api/me', headers: { cookie: other } })).json().prefs).toEqual({ wheelSpeed: 1.5 });
  });

  it('an empty patch keeps what is stored', async () => {
    const { app, login } = await makeTestApp();
    const cookie = await login('owner-1');
    await app.inject({ method: 'PATCH', url: '/api/me/prefs', payload: { wheelSpeed: 0.25 }, headers: { ...json, cookie } });
    const res = await app.inject({ method: 'PATCH', url: '/api/me/prefs', payload: {}, headers: { ...json, cookie } });
    expect(res.json()).toEqual({ wheelSpeed: 0.25 });
  });

  it('accepts the ends of the range and steps of 0.05, stored without float noise', async () => {
    const { app, login, deps } = await makeTestApp();
    const cookie = await login('owner-1');
    for (const wheelSpeed of [0.25, 3, 1.15, 2.95]) {
      const res = await app.inject({ method: 'PATCH', url: '/api/me/prefs', payload: { wheelSpeed }, headers: { ...json, cookie } });
      expect(res.statusCode, String(wheelSpeed)).toBe(200);
      expect(res.json()).toEqual({ wheelSpeed });
    }
    expect((deps.db.prepare('SELECT prefs FROM users WHERE id = 1').get() as { prefs: string }).prefs).toBe('{"wheelSpeed":2.95}');
  });

  it.each([
    ['below the range', { wheelSpeed: 0.2 }],
    ['above the range', { wheelSpeed: 3.05 }],
    ['off the 0.05 grid', { wheelSpeed: 1.01 }],
    ['not a number', { wheelSpeed: '1.5' }],
    ['null', { wheelSpeed: null }],
    ['an unknown key', { wheelSpeed: 1, theme: 'light' }],
    ['not an object', [1]],
  ])('rejects %s with 400 and keeps the stored value', async (_name, payload) => {
    const { app, login } = await makeTestApp();
    const cookie = await login('owner-1');
    await app.inject({ method: 'PATCH', url: '/api/me/prefs', payload: { wheelSpeed: 2 }, headers: { ...json, cookie } });
    const res = await app.inject({ method: 'PATCH', url: '/api/me/prefs', payload: JSON.stringify(payload), headers: { ...json, cookie } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalid_body');
    expect((await app.inject({ url: '/api/me', headers: { cookie } })).json().prefs).toEqual({ wheelSpeed: 2 });
  });

  it('needs a session', async () => {
    const { app } = await makeTestApp();
    const res = await app.inject({ method: 'PATCH', url: '/api/me/prefs', payload: { wheelSpeed: 1 }, headers: json });
    expect(res.statusCode).toBe(401);
  });

  it('is a CSRF-checked mutation: a foreign origin is refused', async () => {
    const { app, login } = await makeTestApp();
    const cookie = await login('owner-1');
    const res = await app.inject({
      method: 'PATCH', url: '/api/me/prefs', payload: { wheelSpeed: 2 }, headers: { ...json, origin: 'https://evil.example', cookie },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('invalid_origin');
  });

  it('limits writes to 60 a minute per user', async () => {
    const { app, login } = await makeTestApp();
    const cookie = await login('owner-1');
    let last = 0;
    for (let i = 0; i < 61; i++) {
      last = (await app.inject({ method: 'PATCH', url: '/api/me/prefs', payload: { wheelSpeed: 1 }, headers: { ...json, cookie } })).statusCode;
    }
    expect(last).toBe(429);
  });

  it('ignores invalid stored values instead of failing', async () => {
    const { app, login, deps } = await makeTestApp();
    const cookie = await login('owner-1');
    deps.db.prepare(`UPDATE users SET prefs = '{"wheelSpeed":99,"x":1}' WHERE id = 1`).run();
    expect((await app.inject({ url: '/api/me', headers: { cookie } })).json().prefs).toEqual({});
    deps.db.prepare(`UPDATE users SET prefs = 'not json' WHERE id = 1`).run();
    expect((await app.inject({ url: '/api/me', headers: { cookie } })).json().prefs).toEqual({});
  });
});
