import type { FastifyInstance } from 'fastify';
import { SseHub } from '../../src/server/sse/hub.js';
import { addMember, makeTestApp } from './helpers.js';

const json = { origin: 'https://ficsmap.test', 'content-type': 'application/json' };

let closeApp: FastifyInstance | undefined;
afterEach(async () => { await closeApp?.close(); closeApp = undefined; });

function reader(res: Response) {
  const r = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = '';
  return {
    /** Reads until `needle` appears in the buffered text; fails after 3 s. */
    async until(needle: string): Promise<string> {
      const deadline = Date.now() + 3000;
      while (!buf.includes(needle)) {
        const left = deadline - Date.now();
        const chunk = await Promise.race([
          r.read(),
          new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`timeout waiting for ${needle}; got ${buf}`)), Math.max(left, 1))),
        ]);
        if (chunk.done) throw new Error(`stream ended; got ${buf}`);
        buf += dec.decode(chunk.value, { stream: true });
      }
      return buf;
    },
    /** Drains the stream; true when it ends within 3 s. */
    async ended(): Promise<boolean> {
      const deadline = Date.now() + 3000;
      for (;;) {
        const chunk = await Promise.race([
          r.read(),
          new Promise<null>(res => setTimeout(() => res(null), Math.max(deadline - Date.now(), 1))),
        ]);
        if (chunk === null) return false;
        if (chunk.done) return true;
      }
    },
  };
}

describe('sse', () => {
  it('relays marks to other members and closes streams when the world is deleted', async () => {
    const t = await makeTestApp();
    closeApp = t.app;
    const owner = await t.login('owner-1');
    const world = (await t.app.inject({ method: 'POST', url: '/api/worlds', headers: { ...json, cookie: owner }, payload: { name: 'W' } })).json();
    const otherId = t.createUser('other');
    addMember(t.deps.db, world.id, otherId);
    const other = await t.login('other');
    const base = await t.app.listen({ port: 0, host: '127.0.0.1' });
    const url = `${base}/api/worlds/${world.id}/events`;
    const a = await fetch(url, { headers: { cookie: owner } });
    const b = await fetch(url, { headers: { cookie: other } });
    expect(a.status).toBe(200);
    expect(a.headers.get('content-type')).toBe('text/event-stream');
    expect(a.headers.get('x-accel-buffering')).toBe('no');
    const ra = reader(a);
    const rb = reader(b);
    await ra.until(': ok');
    await rb.until(': ok');

    const put = await t.app.inject({ method: 'PUT', url: `/api/worlds/${world.id}/marks/BP_Crystal_C_1`, headers: { ...json, cookie: owner }, payload: { collected: true } });
    expect(put.json()).toEqual({ rev: 1 });
    const got = await rb.until('event: mark');
    expect(got).toContain('"actor":"BP_Crystal_C_1"');
    expect(got).toContain('"rev":1');
    expect(got).toContain('"collected":true');

    await t.app.inject({ method: 'DELETE', url: `/api/worlds/${world.id}`, headers: { cookie: owner, origin: json.origin } });
    await ra.until('event: deleted');
    expect(await ra.ended()).toBe(true);
    expect(await rb.ended()).toBe(true);
  });

  it('rejects non-members before opening a stream', async () => {
    const t = await makeTestApp();
    closeApp = t.app;
    const owner = await t.login('owner-1');
    const world = (await t.app.inject({ method: 'POST', url: '/api/worlds', headers: { ...json, cookie: owner }, payload: { name: 'W' } })).json();
    t.createUser('other');
    const other = await t.login('other');
    const res = await t.app.inject({ url: `/api/worlds/${world.id}/events`, headers: { cookie: other } });
    expect(res.statusCode).toBe(404);
  });

  it('removing a member closes their stream only', async () => {
    const t = await makeTestApp();
    closeApp = t.app;
    const owner = await t.login('owner-1');
    const world = (await t.app.inject({ method: 'POST', url: '/api/worlds', headers: { ...json, cookie: owner }, payload: { name: 'W' } })).json();
    const otherId = t.createUser('other');
    addMember(t.deps.db, world.id, otherId);
    const other = await t.login('other');
    const base = await t.app.listen({ port: 0, host: '127.0.0.1' });
    const url = `${base}/api/worlds/${world.id}/events`;
    const ra = reader(await fetch(url, { headers: { cookie: owner } }));
    const rb = reader(await fetch(url, { headers: { cookie: other } }));
    await ra.until(': ok'); await rb.until(': ok');
    await t.app.inject({ method: 'DELETE', url: `/api/worlds/${world.id}/members/${otherId}`, headers: { cookie: owner, origin: json.origin } });
    await ra.until('event: members');
    await rb.until('event: removed');
    expect(await rb.ended()).toBe(true);
  });

  it('logout closes all of the user\'s streams, in every world, and only theirs', async () => {
    const t = await makeTestApp({ hub: new SseHub() });
    closeApp = t.app;
    const owner = await t.login('owner-1');
    const mk = async (name: string) => (await t.app.inject({ method: 'POST', url: '/api/worlds', headers: { ...json, cookie: owner }, payload: { name } })).json();
    const w1 = await mk('W1'), w2 = await mk('W2');
    const otherId = t.createUser('other');
    addMember(t.deps.db, w1.id, otherId);
    const other = await t.login('other');
    const base = await t.app.listen({ port: 0, host: '127.0.0.1' });
    const r1 = reader(await fetch(`${base}/api/worlds/${w1.id}/events`, { headers: { cookie: owner } }));
    const r2 = reader(await fetch(`${base}/api/worlds/${w2.id}/events`, { headers: { cookie: owner } }));
    const ro = reader(await fetch(`${base}/api/worlds/${w1.id}/events`, { headers: { cookie: other } }));
    await r1.until(': ok'); await r2.until(': ok'); await ro.until(': ok');
    const out = await t.app.inject({ method: 'POST', url: '/auth/logout', payload: '{}', headers: { ...json, cookie: owner } });
    expect(out.statusCode).toBe(204);
    expect(await r1.ended()).toBe(true);
    expect(await r2.ended()).toBe(true);
    expect(t.deps.hub!.size(w1.id)).toBe(1);
    expect(t.deps.hub!.size(w2.id)).toBe(0);
  });

  it('client abort drops the subscription', async () => {
    const t = await makeTestApp({ hub: new SseHub() });
    closeApp = t.app;
    const owner = await t.login('owner-1');
    const world = (await t.app.inject({ method: 'POST', url: '/api/worlds', headers: { ...json, cookie: owner }, payload: { name: 'W' } })).json();
    const base = await t.app.listen({ port: 0, host: '127.0.0.1' });
    const ac = new AbortController();
    const res = await fetch(`${base}/api/worlds/${world.id}/events`, { headers: { cookie: owner }, signal: ac.signal });
    await reader(res).until(': ok');
    expect(t.deps.hub!.size(world.id)).toBe(1);
    ac.abort();
    for (let i = 0; i < 50 && t.deps.hub!.size(world.id) > 0; i++) await new Promise(r => setTimeout(r, 20));
    expect(t.deps.hub!.size(world.id)).toBe(0);
  });

  it('PATCH emits a world event and a removed member cannot reconnect', async () => {
    const t = await makeTestApp();
    closeApp = t.app;
    const owner = await t.login('owner-1');
    const world = (await t.app.inject({ method: 'POST', url: '/api/worlds', headers: { ...json, cookie: owner }, payload: { name: 'W' } })).json();
    const otherId = t.createUser('other');
    addMember(t.deps.db, world.id, otherId);
    const other = await t.login('other');
    const base = await t.app.listen({ port: 0, host: '127.0.0.1' });
    const ra = reader(await fetch(`${base}/api/worlds/${world.id}/events`, { headers: { cookie: owner } }));
    await ra.until(': ok');
    await t.app.inject({ method: 'PATCH', url: `/api/worlds/${world.id}`, headers: { ...json, cookie: owner }, payload: { name: 'Renamed' } });
    const got = await ra.until('event: world');
    expect(got).toContain('"name":"Renamed"');
    expect(got).toContain('"rev":1');
    await t.app.inject({ method: 'DELETE', url: `/api/worlds/${world.id}/members/${otherId}`, headers: { cookie: owner, origin: json.origin } });
    const again = await fetch(`${base}/api/worlds/${world.id}/events`, { headers: { cookie: other } });
    expect(again.status).toBe(404);
    await again.body?.cancel();
  });
});
