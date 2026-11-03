import { addMember, makeTestApp } from './helpers.js';
import { SseHub } from '../../src/server/sse/hub.js';
import { MAX_ROUTE_STOPS } from '../../src/shared/route.js';

const json = { origin: 'https://ficsmap.test', 'content-type': 'application/json' };
const body = { name: 'Loop', startActor: 'S_1', stops: ['A_1', 'B_2'] };

async function setup() {
  const t = await makeTestApp({ hub: new SseHub() });
  const owner = await t.login('owner-1');
  const mk = async (name: string) => (await t.app.inject({ method: 'POST', url: '/api/worlds', headers: { ...json, cookie: owner }, payload: { name } })).json();
  const world = await mk('W');
  const otherId = t.createUser('other');
  addMember(t.deps.db, world.id, otherId);
  const other = await t.login('other');
  const send = (method: 'POST' | 'PUT' | 'DELETE' | 'GET', url: string, cookie: string, payload?: unknown) =>
    t.app.inject({ method, url, headers: method === 'GET' ? { cookie } : method === 'DELETE' ? { cookie, origin: json.origin } : { ...json, cookie }, payload: payload as object });
  return { ...t, owner, world, other, otherId, send, mk };
}

describe('routes api', () => {
  it('POST 201, GET list, PUT 200, DELETE 204', async () => {
    const { owner, world, send } = await setup();
    const base = `/api/worlds/${world.id}/routes`;
    const post = await send('POST', base, owner, { ...body, name: '  Loop  ' });
    expect(post.statusCode).toBe(201);
    const dto = post.json();
    expect(dto).toMatchObject({ name: 'Loop', startActor: 'S_1', stops: ['A_1', 'B_2'], createdByName: 'user-owner-1' });
    expect((await send('GET', base, owner)).json()).toEqual([dto]);
    const put = await send('PUT', `${base}/${dto.id}`, owner, { ...body, stops: ['B_2'] });
    expect(put.statusCode).toBe(200);
    expect(put.json().stops).toEqual(['B_2']);
    const del = await send('DELETE', `${base}/${dto.id}`, owner);
    expect(del.statusCode).toBe(204);
    expect((await send('GET', base, owner)).json()).toEqual([]);
  });

  it('invalid bodies give 400 invalid_body', async () => {
    const { owner, world, send } = await setup();
    const url = `/api/worlds/${world.id}/routes`;
    const stops31 = Array.from({ length: MAX_ROUTE_STOPS + 1 }, (_, i) => `A_${i}`);
    for (const bad of [
      { ...body, stops: stops31 },
      { ...body, stops: ['A', 'A'] },
      { ...body, stops: ['S_1'] },
      { ...body, stops: [] },
      { ...body, stops: ['a.b'] },
      { ...body, name: '  ' },
    ]) {
      const res = await send('POST', url, owner, bad);
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('invalid_body');
    }
  });

  it('a non-creator member gets 403 on PUT and DELETE, the owner gets 200', async () => {
    const { owner, other, world, send } = await setup();
    const base = `/api/worlds/${world.id}/routes`;
    const dto = (await send('POST', base, other, body)).json();
    // creator may edit
    expect((await send('PUT', `${base}/${dto.id}`, other, body)).statusCode).toBe(200);
    // owner's route, member tries
    const ownerRoute = (await send('POST', base, owner, body)).json();
    const put = await send('PUT', `${base}/${ownerRoute.id}`, other, body);
    expect(put.statusCode).toBe(403);
    expect(put.json().error).toBe('forbidden');
    expect((await send('DELETE', `${base}/${ownerRoute.id}`, other)).statusCode).toBe(403);
    // owner may edit the member's route
    expect((await send('PUT', `${base}/${dto.id}`, owner, body)).statusCode).toBe(200);
    expect((await send('DELETE', `${base}/${dto.id}`, owner)).statusCode).toBe(204);
  });

  it('with a deleted creator only the owner may edit', async () => {
    const { owner, other, otherId, world, send, deps } = await setup();
    const base = `/api/worlds/${world.id}/routes`;
    const third = deps.db.prepare("INSERT INTO users(display_name, email, email_verified, created_at, last_login_at) VALUES ('t', 't@x.test', 1, 0, 0)").run().lastInsertRowid;
    addMember(deps.db, world.id, Number(third));
    const dto = (await send('POST', base, other, body)).json();
    deps.db.prepare('DELETE FROM world_members WHERE user_id = ?').run(otherId);
    deps.db.prepare('DELETE FROM users WHERE id = ?').run(otherId);
    const list = (await send('GET', base, owner)).json();
    expect(list[0]).toMatchObject({ createdBy: null, createdByName: null });
    expect((await send('PUT', `${base}/${dto.id}`, owner, body)).statusCode).toBe(200);
  });

  it('bad route id gives 404, a route of another world gives 404, non-member gives 404', async () => {
    const { owner, other, world, send, mk } = await setup();
    const w2 = await mk('W2');
    const foreign = (await send('POST', `/api/worlds/${w2.id}/routes`, owner, body)).json();
    const base = `/api/worlds/${world.id}/routes`;
    expect((await send('PUT', `${base}/${foreign.id}`, owner, body)).statusCode).toBe(404);
    expect((await send('DELETE', `${base}/${foreign.id}`, owner)).statusCode).toBe(404);
    expect((await send('PUT', `${base}/not-a-uuid`, owner, body)).statusCode).toBe(404);
    expect((await send('DELETE', `${base}/00000000-0000-4000-8000-000000000000`, owner)).statusCode).toBe(404);
    // `other` is not a member of w2
    expect((await send('GET', `/api/worlds/${w2.id}/routes`, other)).statusCode).toBe(404);
    // the foreign route is untouched
    expect((await send('GET', `/api/worlds/${w2.id}/routes`, owner)).json()).toHaveLength(1);
  });

  it('writes bump the rev and broadcast routes after commit', async () => {
    const { owner, world, send, deps } = await setup();
    const chunks: string[] = [];
    deps.hub!.add(world.id, 1, c => chunks.push(c), () => undefined);
    const base = `/api/worlds/${world.id}/routes`;
    const dto = (await send('POST', base, owner, body)).json();
    await send('PUT', `${base}/${dto.id}`, owner, body);
    await send('DELETE', `${base}/${dto.id}`, owner);
    expect(chunks).toEqual([1, 2, 3].map(rev => `event: routes\ndata: {"type":"routes","rev":${rev}}\n\n`));
  });

  it('deleting the world cascades its routes', async () => {
    const { owner, world, send, deps } = await setup();
    await send('POST', `/api/worlds/${world.id}/routes`, owner, body);
    expect((await send('DELETE', `/api/worlds/${world.id}`, owner)).statusCode).toBeLessThan(300);
    expect(deps.db.prepare('SELECT COUNT(*) AS n FROM routes').get()).toEqual({ n: 0 });
  });

  it('the 31st write in a minute gives 429 rate_limited', async () => {
    const { owner, world, send } = await setup();
    const url = `/api/worlds/${world.id}/routes`;
    for (let i = 0; i < 30; i++) expect((await send('POST', url, owner, body)).statusCode).toBe(201);
    const res = await send('POST', url, owner, body);
    expect(res.statusCode).toBe(429);
    expect(res.json().error).toBe('rate_limited');
  });
});
