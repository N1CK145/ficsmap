import { addMember, makeTestApp } from './helpers.js';

const ORIGIN = 'https://ficsmap.test';
const json = { origin: ORIGIN, 'content-type': 'application/json' };

async function setup() {
  let clock = 1_000;
  const t = await makeTestApp({ now: () => clock });
  const owner = await t.login('owner-1');
  const world = (await t.app.inject({ method: 'POST', url: '/api/worlds', headers: { ...json, cookie: owner }, payload: { name: 'W' } })).json();
  const ids = { owner: world.owner.id as number, anna: t.createUser('anna'), ben: t.createUser('ben'), stranger: t.createUser('stranger') };
  addMember(t.deps.db, world.id, ids.anna);
  addMember(t.deps.db, world.id, ids.ben);
  const cookies = { owner, anna: await t.login('anna'), ben: await t.login('ben'), stranger: await t.login('stranger') };
  const req = (cookie: string, method: string, path: string, payload?: unknown) => t.app.inject({
    method: method as 'GET', url: `/api/worlds/${world.id}${path}`,
    headers: method === 'GET' ? { cookie } : { ...(payload === undefined ? { origin: ORIGIN } : json), cookie },
    ...(payload === undefined ? {} : { payload: payload as object }),
  });
  const feed = async (cookie = owner) => (await req(cookie, 'GET', '/activity')).json() as {
    kind: string; by: { name: string } | null; target: { name: string } | null; detail: string | null; count: number;
  }[];
  const tick = (ms: number) => { clock += ms; };
  return { ...t, world, ids, cookies, req, feed, tick };
}

describe('world activity feed', () => {
  it('is for members only', async () => {
    const c = await setup();
    expect((await c.req(c.cookies.anna, 'GET', '/activity')).statusCode).toBe(200);
    expect((await c.req(c.cookies.stranger, 'GET', '/activity')).statusCode).toBe(404);
    expect((await c.app.inject(`/api/worlds/${c.world.id}/activity`)).statusCode).toBe(401);
  });

  it('records checks (added up per person), routes, renames, roles, removals, leaving and a hand-over', async () => {
    const c = await setup();
    await c.req(c.cookies.anna, 'PUT', '/marks/BP_Crystal_C_1', { collected: true });
    await c.req(c.cookies.anna, 'PUT', '/marks/BP_Crystal_C_1', { collected: false });
    c.tick(1);
    await c.req(c.cookies.ben, 'POST', '/routes', { name: 'R', startActor: 'S_1', stops: ['A_1'] });
    await c.req(c.cookies.owner, 'PATCH', '', { name: 'Neu' });
    await c.req(c.cookies.owner, 'PUT', `/members/${c.ids.anna}/role`, { role: 'admin' });
    await c.req(c.cookies.anna, 'DELETE', `/members/${c.ids.ben}`);
    await c.req(c.cookies.owner, 'PUT', '/owner', { userId: c.ids.anna });
    await c.req(c.cookies.owner, 'DELETE', `/members/${c.ids.owner}`);
    const rows = (await c.feed(c.cookies.anna)).map(e => [e.kind, e.by?.name ?? null, e.target?.name ?? null, e.detail, e.count]);
    expect(rows).toEqual([
      ['leave', 'user-owner-1', null, null, 1],
      ['owner', 'user-owner-1', 'user-anna', null, 1],
      ['remove', 'user-anna', 'user-ben', null, 1],
      ['role', 'user-owner-1', 'user-anna', 'admin', 1],
      ['rename', 'user-owner-1', null, 'Neu', 1],
      ['routes', 'user-ben', null, null, 1],
      ['marks', 'user-anna', null, null, 2],
    ]);
  });

  it('records joining through an invite link', async () => {
    const c = await setup();
    const link = (await c.req(c.cookies.owner, 'GET', '/invite-link')).json().url as string;
    await c.app.inject({ url: `/invite/${link.split('/invite/')[1]}`, headers: { cookie: c.cookies.stranger } });
    expect((await c.feed())[0]).toMatchObject({ kind: 'join', by: { name: 'user-stranger' } });
  });

  it('records an import with its count', async () => {
    const c = await setup();
    const body = { fileName: 'a.sav', sessionName: 'S', saveTime: 1, build: 1, collected: [] };
    await c.req(c.cookies.owner, 'POST', '/import', body);
    await c.req(c.cookies.owner, 'POST', '/import', { ...body, saveTime: 2 });
    expect(await c.feed()).toEqual([expect.objectContaining({ kind: 'import', count: 2 })]);
  });
});
