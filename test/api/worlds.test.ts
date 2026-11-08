import { addMember, makeTestApp } from './helpers.js';

const json = { origin: 'https://ficsmap.test', 'content-type': 'application/json' };

async function setup() {
  const t = await makeTestApp();
  const owner = await t.login('owner-1');
  const create = await t.app.inject({ method: 'POST', url: '/api/worlds', headers: { ...json, cookie: owner }, payload: { name: '  My World ' } });
  const world = create.json();
  const otherId = t.createUser('other');
  const other = await t.login('other');
  return { ...t, owner, world, otherId, other, create };
}

describe('worlds api', () => {
  it('create returns 201 WorldDto; list shows owner role and 0/N progress', async () => {
    const { app, owner, world, create, deps } = await setup();
    expect(create.statusCode).toBe(201);
    expect(world).toMatchObject({ name: 'My World', role: 'owner', rev: 0, datasetVersion: deps.dataset.ds.version, lastImport: null });
    expect(world.members).toHaveLength(1);
    const list = (await app.inject({ url: '/api/worlds', headers: { cookie: owner } })).json();
    expect(list).toEqual([{ id: world.id, name: 'My World', role: 'owner', memberCount: 1, progress: { done: 0, total: deps.dataset.items.length }, lastImportAt: null }]);
  });
  it('requires a session', async () => {
    const { app } = await setup();
    expect((await app.inject({ url: '/api/worlds' })).statusCode).toBe(401);
  });
  it('non-members get 404 on GET, PATCH, DELETE', async () => {
    const { app, other, world } = await setup();
    for (const method of ['GET', 'PATCH', 'DELETE'] as const) {
      const res = await app.inject({ method, url: `/api/worlds/${world.id}`, headers: method === 'GET' ? { cookie: other } : method === 'DELETE' ? { cookie: other, origin: json.origin } : { ...json, cookie: other }, ...(method === 'PATCH' ? { payload: { name: 'x' } } : {}) });
      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe('not_found');
    }
  });
  it('a non-uuid id gives 404', async () => {
    const { app, owner } = await setup();
    expect((await app.inject({ url: '/api/worlds/not-a-uuid', headers: { cookie: owner } })).statusCode).toBe(404);
  });
  it('a member can GET but gets 403 on PATCH and DELETE', async () => {
    const { app, deps, world, otherId, other } = await setup();
    addMember(deps.db, world.id, otherId);
    const get = await app.inject({ url: `/api/worlds/${world.id}`, headers: { cookie: other } });
    expect(get.statusCode).toBe(200);
    expect(get.json().role).toBe('member');
    expect(get.json().members).toHaveLength(2);
    const patch = await app.inject({ method: 'PATCH', url: `/api/worlds/${world.id}`, headers: { ...json, cookie: other }, payload: { name: 'x' } });
    expect(patch.statusCode).toBe(403);
    const del = await app.inject({ method: 'DELETE', url: `/api/worlds/${world.id}`, headers: { cookie: other, origin: json.origin } });
    expect(del.statusCode).toBe(403);
  });
  it('owner can rename (rev bumps) and delete', async () => {
    const { app, owner, world, deps } = await setup();
    const patch = await app.inject({ method: 'PATCH', url: `/api/worlds/${world.id}`, headers: { ...json, cookie: owner }, payload: { name: 'Renamed' } });
    expect(patch.statusCode).toBe(200);
    expect(patch.json()).toMatchObject({ name: 'Renamed', rev: 1 });
    const del = await app.inject({ method: 'DELETE', url: `/api/worlds/${world.id}`, headers: { cookie: owner, origin: json.origin } });
    expect(del.statusCode).toBe(204);
    expect(deps.db.prepare('SELECT COUNT(*) AS n FROM worlds').get()).toEqual({ n: 0 });
  });
  it('a member can leave; the owner cannot remove themself; owner can remove a member', async () => {
    const { app, deps, owner, world, otherId, other } = await setup();
    addMember(deps.db, world.id, otherId);
    const ownerId = world.owner.id;
    const rm = (cookie: string, id: number) => app.inject({ method: 'DELETE', url: `/api/worlds/${world.id}/members/${id}`, headers: { cookie, origin: json.origin } });
    expect((await rm(owner, ownerId)).statusCode).toBe(403);
    expect((await rm(other, ownerId)).statusCode).toBe(403);
    expect((await rm(other, otherId)).statusCode).toBe(204);
    expect((await app.inject({ url: `/api/worlds/${world.id}`, headers: { cookie: other } })).statusCode).toBe(404);
    expect((await rm(owner, otherId)).statusCode).toBe(404);
    addMember(deps.db, world.id, otherId);
    expect((await rm(owner, otherId)).statusCode).toBe(204);
    expect((await rm(owner, 0)).statusCode).toBe(404);
    expect((await rm(owner, 1.5 as number)).statusCode).toBe(404);
  });
  it('a member cannot remove another member', async () => {
    const { app, deps, world, otherId, other } = await setup();
    const third = deps.db.prepare("INSERT INTO users(display_name, created_at, last_login_at) VALUES ('t',0,0)").run().lastInsertRowid as number;
    addMember(deps.db, world.id, otherId); addMember(deps.db, world.id, Number(third));
    const res = await app.inject({ method: 'DELETE', url: `/api/worlds/${world.id}/members/${third}`, headers: { cookie: other, origin: json.origin } });
    expect(res.statusCode).toBe(403);
  });
  it('rejects invalid names with 400 invalid_body', async () => {
    const { app, owner, world } = await setup();
    for (const name of ['x'.repeat(81), '   ', '']) {
      const res = await app.inject({ method: 'POST', url: '/api/worlds', headers: { ...json, cookie: owner }, payload: { name } });
      expect([res.statusCode, res.json().error]).toEqual([400, 'invalid_body']);
    }
    const res = await app.inject({ method: 'PATCH', url: `/api/worlds/${world.id}`, headers: { ...json, cookie: owner }, payload: { name: 'x'.repeat(81) } });
    expect(res.statusCode).toBe(400);
  });
  it('lists most recently created first and maps lastImport', async () => {
    const { app, deps, owner, world } = await setup();
    deps.now = undefined;
    deps.db.prepare('UPDATE worlds SET created_at = 1, last_import_at = 9, last_import_meta = ? WHERE id = ?')
      .run(JSON.stringify({ fileName: 'a.sav', sessionName: 'S', saveTime: 't', build: 1 }), world.id);
    await app.inject({ method: 'POST', url: '/api/worlds', headers: { ...json, cookie: owner }, payload: { name: 'Newer' } });
    const list = (await app.inject({ url: '/api/worlds', headers: { cookie: owner } })).json();
    expect(list.map((w: { name: string }) => w.name)).toEqual(['Newer', 'My World']);
    const dto = (await app.inject({ url: `/api/worlds/${world.id}`, headers: { cookie: owner } })).json();
    expect(dto.lastImport).toEqual({ at: 9, sessionName: 'S', fileName: 'a.sav' });
  });
});
