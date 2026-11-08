import { gzipSync } from 'node:zlib';
import type { FastifyInstance } from 'fastify';
import { createRoute } from '../../src/server/domain/routes.js';
import { createUploadToken } from '../../src/server/domain/uploadTokens.js';
import { SseHub } from '../../src/server/sse/hub.js';
import type { FactorySnapshot } from '../../src/shared/factory/snapshot.js';
import type { SseEvent } from '../../src/shared/sse.js';
import { addMember, makeTestApp } from './helpers.js';

const ORIGIN = 'https://ficsmap.test';
const json = { origin: ORIGIN, 'content-type': 'application/json' };

type Who = 'owner' | 'admin' | 'member' | 'stranger';
const WHO: Who[] = ['owner', 'admin', 'member', 'stranger'];

/** Distinct save times, so each upload is a new snapshot. */
let saveTimes = 0;
const snapshot = (saveTime: number): FactorySnapshot => ({
  v: 1,
  meta: { sessionName: 'S', saveTime, build: 400_000 },
  buildings: [], lightweight: [], splines: [], powerLines: [], pathNetworks: [], stations: [], vehicles: [], markers: [], crates: [],
});

/** A world owned by `owner`, with `admin` (an admin), `member`, `member2` (plain members) and a `stranger`. */
async function setup() {
  const hub = new SseHub();
  const events: [string, SseEvent][] = [];
  const orig = hub.broadcast.bind(hub);
  hub.broadcast = (id, e) => { events.push([id, e]); orig(id, e); };
  const t = await makeTestApp({ hub, now: () => 5_000 });
  const cookies = {} as Record<Who | 'member2' | 'admin2', string>;
  cookies.owner = await t.login('owner-1');
  const world = (await t.app.inject({ method: 'POST', url: '/api/worlds', headers: { ...json, cookie: cookies.owner }, payload: { name: 'W' } })).json();
  const ids = { owner: world.owner.id as number } as Record<Who | 'member2' | 'admin2', number>;
  for (const who of ['admin', 'admin2', 'member', 'member2', 'stranger'] as const) {
    ids[who] = t.createUser(who);
    if (who !== 'stranger') addMember(t.deps.db, world.id, ids[who]);
    cookies[who] = await t.login(who);
  }
  t.deps.db.prepare("UPDATE world_members SET role = 'admin' WHERE user_id IN (?, ?)").run(ids.admin, ids.admin2);
  const req = (cookie: string, method: string, path: string, payload?: unknown, headers: Record<string, string> = json) =>
    t.app.inject({
      method: method as 'GET', url: `/api/worlds/${world.id}${path}`,
      headers: method === 'GET' ? { cookie } : { ...(payload === undefined ? { origin: ORIGIN } : headers), cookie },
      ...(payload === undefined ? {} : { payload: payload as object }),
    });
  const setRole = (cookie: string, userId: number, role: string) => req(cookie, 'PUT', `/members/${userId}/role`, { role });
  const remove = (cookie: string, userId: number) => req(cookie, 'DELETE', `/members/${userId}`);
  return { ...t, world, cookies, ids, events, req, setRole, remove };
}

type Ctx = Awaited<ReturnType<typeof setup>>;

/**
 * Each request a role may or may not make; `allowed` is its success status. Set-up runs before each call, so a
 * resource the request needs (a token, a snapshot, another user's route) exists for every caller.
 */
const ROUTES: { name: string; min: 'member' | 'admin' | 'owner'; allowed: number; call(c: Ctx, cookie: string): Promise<{ statusCode: number }> }[] = [
  { name: 'GET world', min: 'member', allowed: 200, call: (c, k) => c.req(k, 'GET', '') },
  { name: 'PATCH world (rename)', min: 'admin', allowed: 200, call: (c, k) => c.req(k, 'PATCH', '', { name: 'Renamed' }) },
  { name: 'GET invite-link', min: 'admin', allowed: 200, call: (c, k) => c.req(k, 'GET', '/invite-link') },
  { name: 'POST invite-links/revoke', min: 'admin', allowed: 200, call: (c, k) => c.req(k, 'POST', '/invite-links/revoke', {}) },
  {
    name: 'POST import', min: 'admin', allowed: 200,
    call: (c, k) => c.req(k, 'POST', '/import', { fileName: 'a.sav', sessionName: 'S', saveTime: 1, build: 1, collected: [] }),
  },
  { name: 'GET upload-tokens', min: 'admin', allowed: 200, call: (c, k) => c.req(k, 'GET', '/upload-tokens') },
  { name: 'POST upload-tokens', min: 'admin', allowed: 201, call: (c, k) => c.req(k, 'POST', '/upload-tokens', { label: 'PC' }) },
  {
    name: 'DELETE upload-tokens/:tid', min: 'admin', allowed: 204,
    call: (c, k) => {
      const { token } = createUploadToken(c.deps.db, c.world.id, { label: 'x', anySession: false }, c.ids.owner, 0);
      return c.req(k, 'DELETE', `/upload-tokens/${token.id}`);
    },
  },
  {
    name: 'POST snapshots', min: 'admin', allowed: 201,
    call: (c, k) => c.app.inject({
      method: 'POST', url: `/api/worlds/${c.world.id}/snapshots`,
      headers: { ...json, 'content-encoding': 'gzip', cookie: k },
      payload: gzipSync(JSON.stringify(snapshot(++saveTimes))),
    }),
  },
  {
    name: 'DELETE snapshots/:sid', min: 'admin', allowed: 204,
    call: async (c, k) => {
      const up = await c.app.inject({
        method: 'POST', url: `/api/worlds/${c.world.id}/snapshots`,
        headers: { ...json, 'content-encoding': 'gzip', cookie: c.cookies.owner },
        payload: gzipSync(JSON.stringify(snapshot(++saveTimes))),
      });
      return c.req(k, 'DELETE', `/snapshots/${up.json().id}`);
    },
  },
  {
    name: "PUT another user's route", min: 'admin', allowed: 200,
    call: (c, k) => {
      const { route } = createRoute(c.deps.db, c.world.id, { name: 'R', startActor: 'S_1', stops: ['A_1'] }, c.ids.member2, 0);
      return c.req(k, 'PUT', `/routes/${route.id}`, { name: 'R2', startActor: 'S_1', stops: ['A_1'] });
    },
  },
  { name: 'PUT member role (grant)', min: 'owner', allowed: 204, call: (c, k) => c.setRole(k, c.ids.member2, 'admin') },
  { name: 'DELETE world', min: 'owner', allowed: 204, call: (c, k) => c.req(k, 'DELETE', '') },
];

const RANK = { member: 0, admin: 1, owner: 2 } as const;

describe('world admins: permission matrix', () => {
  for (const route of ROUTES) {
    it(`${route.name}: ${route.min} and up`, async () => {
      for (const who of WHO) {
        const c = await setup();
        const res = await route.call(c, c.cookies[who]);
        const expected = who === 'stranger' ? 404 : RANK[who] >= RANK[route.min] ? route.allowed : 403;
        expect([who, res.statusCode]).toEqual([who, expected]);
      }
    });
  }
});

describe('world admins: roles', () => {
  it('the world and the member list carry each role', async () => {
    const c = await setup();
    const dto = (who: Who) => c.req(c.cookies[who], 'GET', '').then(r => r.json());
    expect((await dto('owner')).role).toBe('owner');
    expect((await dto('admin')).role).toBe('admin');
    const member = await dto('member');
    expect(member.role).toBe('member');
    const roles = Object.fromEntries(member.members.map((m: { userId: number; role: string }) => [m.userId, m.role]));
    expect(roles).toEqual({ [c.ids.owner]: 'owner', [c.ids.admin]: 'admin', [c.ids.admin2]: 'admin', [c.ids.member]: 'member', [c.ids.member2]: 'member' });
    const list = (await c.app.inject({ url: '/api/worlds', headers: { cookie: c.cookies.admin } })).json();
    expect(list[0].role).toBe('admin');
  });

  it('the owner grants and takes back admin rights; each change broadcasts members', async () => {
    const c = await setup();
    expect((await c.setRole(c.cookies.owner, c.ids.member, 'admin')).statusCode).toBe(204);
    expect(c.events).toContainEqual([c.world.id, { type: 'members' }]);
    expect((await c.req(c.cookies.member, 'GET', '/upload-tokens')).statusCode).toBe(200);
    expect((await c.setRole(c.cookies.owner, c.ids.member, 'member')).statusCode).toBe(204);
    expect((await c.req(c.cookies.member, 'GET', '/upload-tokens')).statusCode).toBe(403);
  });

  it('no one changes the owner role, admins cannot grant or demote others, bad bodies and unknown users fail', async () => {
    const c = await setup();
    expect((await c.setRole(c.cookies.owner, c.ids.owner, 'member')).statusCode).toBe(403);
    expect((await c.setRole(c.cookies.admin, c.ids.owner, 'member')).statusCode).toBe(403);
    expect((await c.setRole(c.cookies.admin, c.ids.member, 'admin')).statusCode).toBe(403);
    expect((await c.setRole(c.cookies.admin, c.ids.admin2, 'member')).statusCode).toBe(403);
    expect((await c.setRole(c.cookies.member, c.ids.member, 'admin')).statusCode).toBe(403);
    expect((await c.setRole(c.cookies.owner, c.ids.member, 'owner')).statusCode).toBe(400);
    expect((await c.setRole(c.cookies.owner, c.ids.stranger, 'admin')).statusCode).toBe(404);
    expect((await c.setRole(c.cookies.owner, 0, 'admin')).statusCode).toBe(404);
    expect((await c.setRole(c.cookies.stranger, c.ids.member, 'admin')).statusCode).toBe(404);
  });

  it('an admin steps down on their own', async () => {
    const c = await setup();
    expect((await c.setRole(c.cookies.admin, c.ids.admin, 'member')).statusCode).toBe(204);
    expect((await c.req(c.cookies.admin, 'GET', '')).json().role).toBe('member');
    // A member cannot step back up.
    expect((await c.setRole(c.cookies.admin, c.ids.admin, 'admin')).statusCode).toBe(403);
  });

  it('member removal: admins remove plain members only, the owner anyone but themselves, everyone may leave', async () => {
    const c = await setup();
    expect((await c.remove(c.cookies.admin, c.ids.owner)).statusCode).toBe(403);
    expect((await c.remove(c.cookies.admin, c.ids.admin2)).statusCode).toBe(403);
    expect((await c.remove(c.cookies.member, c.ids.member2)).statusCode).toBe(403);
    expect((await c.remove(c.cookies.admin, c.ids.member)).statusCode).toBe(204);
    expect((await c.remove(c.cookies.owner, c.ids.owner)).statusCode).toBe(403);
    expect((await c.remove(c.cookies.owner, c.ids.admin2)).statusCode).toBe(204);
    expect((await c.remove(c.cookies.admin, c.ids.admin)).statusCode).toBe(204);
    expect((await c.req(c.cookies.admin, 'GET', '')).statusCode).toBe(404);
  });

  it("an admin's upload keys and imports run under their name; losing the role revokes their keys", async () => {
    const c = await setup();
    const created = await c.req(c.cookies.admin, 'POST', '/upload-tokens', { label: 'Admin PC' });
    expect(created.json().token.createdBy).toBe('user-admin');
    await c.req(c.cookies.owner, 'POST', '/upload-tokens', { label: 'Owner PC' });
    const snap = await c.app.inject({
      method: 'POST', url: `/api/worlds/${c.world.id}/snapshots`,
      headers: { ...json, 'content-encoding': 'gzip', cookie: c.cookies.admin },
      payload: gzipSync(JSON.stringify(snapshot(1))),
    });
    expect(snap.json().importedBy).toBe('user-admin');

    const labels = async () => (await c.req(c.cookies.owner, 'GET', '/upload-tokens')).json().map((t: { label: string }) => t.label);
    expect(await labels()).toEqual(['Owner PC', 'Admin PC']);
    await c.setRole(c.cookies.owner, c.ids.admin, 'member');
    expect(await labels()).toEqual(['Owner PC']);

    await c.req(c.cookies.admin2, 'POST', '/upload-tokens', { label: 'Admin2 PC' });
    await c.remove(c.cookies.owner, c.ids.admin2);
    expect(await labels()).toEqual(['Owner PC']);
  });
});

describe('world admins: live role changes', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { await app?.close(); app = undefined; });

  it("a role change reaches the affected user's open stream as `members`", async () => {
    const c = await setup();
    app = c.app;
    const base = await c.app.listen({ port: 0, host: '127.0.0.1' });
    const res = await fetch(`${base}/api/worlds/${c.world.id}/events`, { headers: { cookie: c.cookies.member } });
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let buf = '';
    const until = async (needle: string) => {
      const deadline = Date.now() + 3000;
      while (!buf.includes(needle)) {
        if (Date.now() > deadline) throw new Error(`timeout waiting for ${needle}; got ${buf}`);
        const chunk = await reader.read();
        if (chunk.done) throw new Error(`stream ended; got ${buf}`);
        buf += dec.decode(chunk.value, { stream: true });
      }
    };
    await until(': ok');
    await c.setRole(c.cookies.owner, c.ids.member, 'admin');
    await until('event: members');
    expect((await c.req(c.cookies.member, 'GET', '')).json().role).toBe('admin');
    await reader.cancel();
  });
});
