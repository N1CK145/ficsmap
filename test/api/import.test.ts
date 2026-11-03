import { SseHub } from '../../src/server/sse/hub.js';
import type { SseEvent } from '../../src/shared/sse.js';
import { addMember, makeTestApp } from './helpers.js';

const json = { origin: 'https://ficsmap.test', 'content-type': 'application/json' };
const body = (collected: string[]) => ({ fileName: 'a.sav', sessionName: 'Sess', saveTime: 1000, build: 2000, collected });

async function setup() {
  const hub = new SseHub();
  const events: [string, SseEvent][] = [];
  const orig = hub.broadcast.bind(hub);
  hub.broadcast = (id, e) => { events.push([id, e]); orig(id, e); };
  const t = await makeTestApp({ hub });
  const owner = await t.login('owner-1');
  const world = (await t.app.inject({ method: 'POST', url: '/api/worlds', headers: { ...json, cookie: owner }, payload: { name: 'W' } })).json();
  const otherId = t.createUser('other');
  addMember(t.deps.db, world.id, otherId);
  const member = await t.login('other');
  const post = (cookie: string, payload: unknown, id = world.id) =>
    t.app.inject({ method: 'POST', url: `/api/worlds/${id}/import`, headers: { ...json, cookie }, payload: payload as object });
  return { ...t, owner, member, world, events, post };
}

describe('import api', () => {
  it('owner imports, gets the result, SSE import event, and lastImport shows', async () => {
    const { app, owner, world, events, post } = await setup();
    const res = await post(owner, body(['BP_Crystal_C_1', 'BP_Crystal_C_1', 'Unknown_X']));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ rev: 1, newlyChecked: 1, conflicts: 0, ignored: 1, collectedTotal: 1 });
    expect(events).toContainEqual([world.id, { type: 'import', rev: 1 }]);
    const w = (await app.inject({ url: `/api/worlds/${world.id}`, headers: { cookie: owner } })).json();
    expect(w.lastImport).toMatchObject({ sessionName: 'Sess', fileName: 'a.sav' });
  });

  it('a member gets 403', async () => {
    const { member, post } = await setup();
    expect((await post(member, body([]))).statusCode).toBe(403);
  });

  it('10,001 names give 400', async () => {
    const { owner, post } = await setup();
    const res = await post(owner, body(Array.from({ length: 10_001 }, (_, i) => `N${i}`)));
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalid_body');
  });

  it('a bad name gives 400', async () => {
    const { owner, post } = await setup();
    const res = await post(owner, body(['bad name!']));
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalid_body');
  });

  it('a body over 512 KB is rejected with 413 and code invalid_body (the error handler keeps the 413 status)', async () => {
    const { owner, post } = await setup();
    const res = await post(owner, body(['A'.repeat(128)].concat(Array(5000).fill('B'.repeat(128)))));
    expect(res.statusCode).toBe(413);
    expect(res.json().error).toBe('invalid_body');
  });

  it('the 7th import in an hour gives 429, keyed per world', async () => {
    const { owner, world, app, post } = await setup();
    for (let i = 0; i < 6; i++) expect((await post(owner, body([]))).statusCode).toBe(200);
    const seventh = await post(owner, body([]));
    expect(seventh.statusCode).toBe(429);
    expect(seventh.json().error).toBe('rate_limited');
    const other = (await app.inject({ method: 'POST', url: '/api/worlds', headers: { ...json, cookie: owner }, payload: { name: 'W2' } })).json();
    expect(other.id).not.toBe(world.id);
    expect((await post(owner, body([]), other.id)).statusCode).toBe(200);
  });

  it('rejected requests from a member do not use up the owner quota', async () => {
    const { owner, member, post } = await setup();
    for (let i = 0; i < 6; i++) expect((await post(member, body([]))).statusCode).toBe(403);
    expect((await post(owner, body([]))).statusCode).toBe(200);
  });
});
