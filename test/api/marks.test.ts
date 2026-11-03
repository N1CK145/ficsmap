import { addMember, makeTestApp } from './helpers.js';

const json = { origin: 'https://ficsmap.test', 'content-type': 'application/json' };

async function setup() {
  const t = await makeTestApp();
  const owner = await t.login('owner-1');
  const world = (await t.app.inject({ method: 'POST', url: '/api/worlds', headers: { ...json, cookie: owner }, payload: { name: 'W' } })).json();
  const otherId = t.createUser('other');
  const other = await t.login('other');
  return { ...t, owner, world, other, otherId };
}

describe('marks api', () => {
  it('PUT, GET, bulk and restore round trip', async () => {
    const { app, owner, world } = await setup();
    const h = { ...json, cookie: owner };
    const put = await app.inject({ method: 'PUT', url: `/api/worlds/${world.id}/marks/BP_Crystal_C_1`, headers: h, payload: { collected: true } });
    expect(put.json()).toEqual({ rev: 1 });
    const get = (await app.inject({ url: `/api/worlds/${world.id}/marks`, headers: { cookie: owner } })).json();
    expect(get.rev).toBe(1);
    expect(get.marks).toHaveLength(1);
    expect(get.marks[0].slice(0, 2)).toEqual(['BP_Crystal_C_1', 0]);
    const bulk = (await app.inject({ method: 'POST', url: `/api/worlds/${world.id}/marks/bulk`, headers: h, payload: { actors: ['BP_Crystal_C_1', 'BP_Crystal_C_2'], collected: false } })).json();
    expect(bulk).toEqual({ rev: 2, previous: [['BP_Crystal_C_1', true, 0], ['BP_Crystal_C_2', false, 0]] });
    const restore = await app.inject({ method: 'POST', url: `/api/worlds/${world.id}/marks/restore`, headers: h, payload: { rows: bulk.previous } });
    expect(restore.json()).toEqual({ rev: 3 });
    expect((await app.inject({ url: `/api/worlds/${world.id}/marks`, headers: { cookie: owner } })).json().marks).toHaveLength(1);
  });
  it('non-member PUT gives 404', async () => {
    const { app, other, world } = await setup();
    const res = await app.inject({ method: 'PUT', url: `/api/worlds/${world.id}/marks/BP_DropPod1`, headers: { ...json, cookie: other }, payload: { collected: true } });
    expect(res.statusCode).toBe(404);
  });
  it('invalid body or actor gives 400 invalid_body', async () => {
    const { app, owner, world } = await setup();
    const h = { ...json, cookie: owner };
    const bad = await app.inject({ method: 'PUT', url: `/api/worlds/${world.id}/marks/BP_DropPod1`, headers: h, payload: { collected: 'yes' } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toBe('invalid_body');
    const dot = await app.inject({ method: 'PUT', url: `/api/worlds/${world.id}/marks/a.b`, headers: h, payload: { collected: true } });
    expect(dot.statusCode).toBe(400);
    expect(dot.json().error).toBe('invalid_body');
    const big = await app.inject({ method: 'POST', url: `/api/worlds/${world.id}/marks/bulk`, headers: h, payload: { actors: Array.from({ length: 10001 }, (_, i) => `A${i}`), collected: true } });
    expect(big.statusCode).toBe(400);
    expect(big.json().error).toBe('invalid_body');
    const badBulk = await app.inject({ method: 'POST', url: `/api/worlds/${world.id}/marks/bulk`, headers: h, payload: { actors: ['a.b'], collected: true } });
    expect(badBulk.json().error).toBe('invalid_body');
    const badRestore = await app.inject({ method: 'POST', url: `/api/worlds/${world.id}/marks/restore`, headers: h, payload: { rows: [['A', 'x', 0]] } });
    expect(badRestore.statusCode).toBe(400);
    expect(badRestore.json().error).toBe('invalid_body');
  });
  it('PUT of an actor unknown to the dataset gives 400 invalid_body and writes nothing', async () => {
    const { app, owner, world, deps } = await setup();
    const res = await app.inject({ method: 'PUT', url: `/api/worlds/${world.id}/marks/BP_Unknown_C_1`, headers: { ...json, cookie: owner }, payload: { collected: true } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalid_body');
    expect(deps.db.prepare('SELECT COUNT(*) AS n FROM marks').get()).toEqual({ n: 0 });
  });
  it('bulk and restore drop unknown actors and leave existing unknown rows untouched', async () => {
    const { app, owner, world, deps } = await setup();
    const h = { ...json, cookie: owner };
    deps.db.prepare("INSERT INTO marks(world_id, actor_name, mismatch, updated_by, updated_at) VALUES (?, 'BP_Gone_C_1', 1, NULL, 5)").run(world.id);
    const bulk = await app.inject({ method: 'POST', url: `/api/worlds/${world.id}/marks/bulk`, headers: h, payload: { actors: ['BP_Crystal_C_1', 'BP_Unknown_C_1'], collected: true } });
    expect(bulk.statusCode).toBe(200);
    expect(bulk.json().previous).toEqual([['BP_Crystal_C_1', false, 0]]);
    const off = await app.inject({ method: 'POST', url: `/api/worlds/${world.id}/marks/bulk`, headers: h, payload: { actors: ['BP_Gone_C_1'], collected: false } });
    expect(off.json().previous).toEqual([]);
    const restore = await app.inject({ method: 'POST', url: `/api/worlds/${world.id}/marks/restore`, headers: h, payload: { rows: [['BP_Gone_C_1', false, 0], ['BP_Unknown_C_1', true, 0], ['BP_Crystal_C_2', true, 1]] } });
    expect(restore.statusCode).toBe(200);
    const rows = deps.db.prepare('SELECT actor_name, mismatch, updated_by, updated_at FROM marks ORDER BY actor_name').all() as { actor_name: string }[];
    expect(rows.map(r => r.actor_name)).toEqual(['BP_Crystal_C_1', 'BP_Crystal_C_2', 'BP_Gone_C_1']);
    expect(rows[2]).toEqual({ actor_name: 'BP_Gone_C_1', mismatch: 1, updated_by: null, updated_at: 5 });
  });
  it('the 121st PUT in a minute gives 429 rate_limited', async () => {
    const { app, owner, world } = await setup();
    const send = () => app.inject({ method: 'PUT', url: `/api/worlds/${world.id}/marks/BP_DropPod1`, headers: { ...json, cookie: owner }, payload: { collected: true } });
    for (let i = 0; i < 120; i++) expect((await send()).statusCode).toBe(200);
    const res = await send();
    expect(res.statusCode).toBe(429);
    expect(res.json().error).toBe('rate_limited');
  });
  it('rate limit is per user', async () => {
    const { app, owner, other, otherId, world, deps } = await setup();
    addMember(deps.db, world.id, otherId);
    const send = (cookie: string) => app.inject({ method: 'PUT', url: `/api/worlds/${world.id}/marks/BP_DropPod1`, headers: { ...json, cookie }, payload: { collected: true } });
    for (let i = 0; i < 120; i++) await send(owner);
    expect((await send(owner)).statusCode).toBe(429);
    expect((await send(other)).statusCode).toBe(200);
  });
});
