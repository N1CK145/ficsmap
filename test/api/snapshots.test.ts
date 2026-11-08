import { gunzipSync, gzipSync } from 'node:zlib';
import { randomBytes } from 'node:crypto';
import { SseHub } from '../../src/server/sse/hub.js';
import type { SseEvent } from '../../src/shared/sse.js';
import type { FactorySnapshot } from '../../src/shared/factory/snapshot.js';
import { MAX_SNAPSHOT_GZIP_BYTES, MAX_SNAPSHOT_JSON_BYTES, MAX_SNAPSHOTS_PER_WORLD } from '../../src/shared/factory/storage.js';
import { addMember, makeTestApp } from './helpers.js';

const ORIGIN = 'https://ficsmap.test';
const json = { origin: ORIGIN, 'content-type': 'application/json' };
const gz = { ...json, 'content-encoding': 'gzip' };

function snapshot(saveTime = 1_000, sessionName = 'Letz Fetz'): FactorySnapshot {
  return {
    v: 1,
    meta: { sessionName, saveTime, build: 400_000 },
    buildings: [
      { id: 'Build_ConstructorMk1_C_1', cls: 'Build_ConstructorMk1_C', x: 1, y: 2, z: 3, yaw: 90, prod: { clock: 1, productivity: 1 } },
      { id: 'Build_SmelterMk1_C_2', cls: 'Build_SmelterMk1_C', x: 4, y: 5, z: 6, yaw: 0, prod: { clock: 1.5, productivity: 0.5, powerShards: 1 } },
      { id: 'Build_SmelterMk1_C_3', cls: 'Build_SmelterMk1_C', x: 7, y: 8, z: 9, yaw: 0, prod: { clock: 1, productivity: 0, issues: ['starved'] } },
      { id: 'Build_MinerMk1_C_4', cls: 'Build_MinerMk1_C', x: 0, y: 0, z: 0, yaw: 0, prod: { clock: 1 } },
      { id: 'Build_PowerPole_C_5', cls: 'Build_PowerPole_C', x: 0, y: 0, z: 0, yaw: 0 },
    ],
    lightweight: [{ cls: 'Build_Foundation_8x4_01_C', xyzYaw: [0, 0, 0, 0, 800, 0, 0, 90] }],
    splines: [{ id: 'Build_ConveyorBeltMk1_C_6', cls: 'Build_ConveyorBeltMk1_C', pts: [0, 0, 0, 100, 0, 0] }],
    powerLines: [0, 0, 0, 1, 1, 1],
    pathNetworks: [],
    // cargo (added to format 1 later) must survive the schema
    stations: [{ id: 'Build_TruckStation_C_7', cls: 'Build_TruckStation_C', x: 0, y: 0, z: 0, yaw: 0, loading: true, traffic: [], cargo: [{ item: 'Desc_Cement_C', count: 35 }] }],
    vehicles: [{ id: 'BP_Tractor_C_8', cls: 'BP_Tractor_C', x: 0, y: 0, z: 0, yaw: 0, autopilot: true, route: [], cargo: [{ item: 'Desc_SteelPipe_C', count: 108 }], slots: 25 }],
    markers: [{ name: 'Base', x: 1, y: 2, z: 3, kind: 'MapMarker', iconId: 1, color: '#ff8800', scale: 1 }],
    crates: [],
    // links and circuits (added to format 1 later) must survive the schema
    links: [
      { from: 'Build_MinerMk1_C_4', to: 'Build_SmelterMk1_C_2', fromPort: 'Output0', toPort: 'Input0', kind: 'belt', via: ['Build_ConveyorBeltMk1_C_6'], slowest: 'Build_ConveyorBeltMk1_C', items: { Desc_OreIron_C: 4 } },
      { from: 'Build_SmelterMk1_C_2', to: 'Build_ConstructorMk1_C_1', kind: 'pipe', via: [], fluid: 'Desc_Water_C' },
    ],
    circuits: [{ id: 3, buildings: ['Build_ConstructorMk1_C_1', 'Build_SmelterMk1_C_2'], fuseTriggered: true }],
  };
}

async function setup() {
  const hub = new SseHub();
  const events: [string, SseEvent][] = [];
  const orig = hub.broadcast.bind(hub);
  hub.broadcast = (id, e) => { events.push([id, e]); orig(id, e); };
  const t = await makeTestApp({ hub, now: () => 5_000 });
  const owner = await t.login('owner-1');
  const world = (await t.app.inject({ method: 'POST', url: '/api/worlds', headers: { ...json, cookie: owner }, payload: { name: 'W' } })).json();
  addMember(t.deps.db, world.id, t.createUser('other'));
  const member = await t.login('other');
  t.createUser('stranger');
  const stranger = await t.login('stranger');
  const base = `/api/worlds/${world.id}/snapshots`;
  const upload = (cookie: string, body: unknown, headers: Record<string, string> = gz) =>
    t.app.inject({
      method: 'POST', url: base, headers: { ...headers, cookie },
      payload: Buffer.isBuffer(body) ? body : gzipSync(JSON.stringify(body)),
    });
  const get = (cookie: string, path = '', headers: Record<string, string> = {}) =>
    t.app.inject({ url: base + path, headers: { ...headers, cookie } });
  const del = (cookie: string, sid: number | string) =>
    t.app.inject({ method: 'DELETE', url: `${base}/${sid}`, headers: { origin: ORIGIN, cookie } });
  return { ...t, owner, member, stranger, world, events, base, upload, get, del };
}

describe('factory snapshots api', () => {
  it('the owner uploads a gzip snapshot and gets its summary; members are told and see it in the list', async () => {
    const { owner, member, world, events, upload, get } = await setup();
    const res = await upload(owner, snapshot());
    expect(res.statusCode).toBe(201);
    const summary = res.json();
    expect(summary).toMatchObject({
      saveTime: 1_000, sessionName: 'Letz Fetz', importedAt: 5_000, importedBy: 'user-owner-1',
      buildings: 5, machines: 4, idle: 1,
    });
    expect(summary.avgProductivity).toBeCloseTo(0.5);
    expect(summary.bytes).toBeGreaterThan(0);
    expect(events).toContainEqual([world.id, { type: 'snapshots', rev: 1 }]);
    const list = await get(member);
    expect(list.statusCode).toBe(200);
    expect(list.json()).toEqual([summary]);
  });

  it('serves a snapshot as stored gzip with immutable caching, and as plain JSON to clients without gzip', async () => {
    const { owner, member, upload, get } = await setup();
    const extra = { ...snapshot(), unknownKey: 'dropped', meta: { ...snapshot().meta, alsoUnknown: 1 } };
    const { id } = (await upload(owner, extra)).json();
    const res = await get(member, `/${id}`, { 'accept-encoding': 'gzip, deflate, br' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-encoding']).toBe('gzip');
    expect(res.headers['content-type']).toMatch(/^application\/json/);
    expect(res.headers['cache-control']).toBe('private, max-age=31536000, immutable');
    const stored = JSON.parse(gunzipSync(res.rawPayload).toString('utf8'));
    // Unknown keys are not stored: the server keeps exactly the snapshot format.
    expect(stored).toEqual(snapshot());
    const plain = await get(member, `/${id}`);
    expect(plain.headers['content-encoding']).toBeUndefined();
    expect(plain.json()).toEqual(snapshot());
  });

  it('a re-import of the same save replaces it under a new id; other saves are listed newest first', async () => {
    const { owner, upload, get } = await setup();
    const first = (await upload(owner, snapshot(1_000))).json();
    const again = (await upload(owner, snapshot(1_000))).json();
    expect(again.id).not.toBe(first.id);
    expect((await get(owner, `/${first.id}`)).statusCode).toBe(404);
    const newer = (await upload(owner, snapshot(2_000))).json();
    const otherSession = (await upload(owner, snapshot(1_500, 'Other'))).json();
    expect((await get(owner)).json().map((s: { id: number }) => s.id)).toEqual([newer.id, otherSession.id, again.id]);
  });

  it('only the owner uploads and deletes; members read; strangers get 404 and signed-out users 401', async () => {
    const { owner, member, stranger, upload, get, del, app, base } = await setup();
    const { id } = (await upload(owner, snapshot())).json();
    expect((await upload(member, snapshot(2_000))).statusCode).toBe(403);
    expect((await del(member, id)).statusCode).toBe(403);
    expect((await get(member, `/${id}`)).statusCode).toBe(200);
    for (const path of ['', `/${id}`]) expect((await get(stranger, path)).statusCode).toBe(404);
    expect((await upload(stranger, snapshot(3_000))).statusCode).toBe(404);
    expect((await app.inject({ url: base })).statusCode).toBe(401);
    expect((await get(owner)).json()).toHaveLength(1);
  });

  it('the owner deletes a snapshot: 204, an event, then 404', async () => {
    const { owner, world, events, upload, get, del } = await setup();
    const { id } = (await upload(owner, snapshot())).json();
    const res = await del(owner, id);
    expect(res.statusCode).toBe(204);
    expect(events).toContainEqual([world.id, { type: 'snapshots', rev: 2 }]);
    expect((await get(owner)).json()).toEqual([]);
    expect((await del(owner, id)).statusCode).toBe(404);
    expect((await del(owner, 'abc')).statusCode).toBe(404);
    expect((await get(owner, '/0')).statusCode).toBe(404);
  });

  it('a snapshot of another world is not found through this world', async () => {
    const { owner, upload, app, get } = await setup();
    const other = (await app.inject({ method: 'POST', url: '/api/worlds', headers: { ...json, cookie: owner }, payload: { name: 'W2' } })).json();
    const res = await app.inject({
      method: 'POST', url: `/api/worlds/${other.id}/snapshots`, headers: { ...gz, cookie: owner }, payload: gzipSync(JSON.stringify(snapshot())),
    });
    expect(res.statusCode).toBe(201);
    expect((await get(owner, `/${res.json().id}`)).statusCode).toBe(404);
    expect((await upload(owner, snapshot())).statusCode).toBe(201);
  });

  it('rejects a body that is not gzip, not JSON or not a snapshot', async () => {
    const { owner, upload } = await setup();
    const plain = await upload(owner, Buffer.from(JSON.stringify(snapshot())), json);
    expect(plain.statusCode).toBe(400);
    expect(plain.json()).toMatchObject({ error: 'invalid_body', message: 'The snapshot must be sent gzip-compressed' });
    expect((await upload(owner, Buffer.from('not gzip at all'))).statusCode).toBe(400);
    expect((await upload(owner, gzipSync('{nope'))).statusCode).toBe(400);
    expect((await upload(owner, { ...snapshot(), buildings: [{ id: 'x' }] })).statusCode).toBe(400);
    expect((await upload(owner, { ...snapshot(), v: 0 })).statusCode).toBe(400);
    const bad = snapshot();
    bad.markers[0]!.color = 'red';
    expect((await upload(owner, bad)).json().error).toBe('invalid_body');
  });

  it('refuses a snapshot of a newer format version with its own message', async () => {
    const { owner, upload } = await setup();
    const res = await upload(owner, { ...snapshot(), v: 2 });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/version 2 is newer/);
  });

  it('limits the compressed body to 4 MB and the decompressed one to 32 MB (413)', async () => {
    const { owner, upload, get } = await setup();
    const big = await upload(owner, randomBytes(MAX_SNAPSHOT_GZIP_BYTES + 1));
    expect(big.statusCode).toBe(413);
    expect(big.json().error).toBe('invalid_body');
    const bomb = gzipSync(Buffer.alloc(MAX_SNAPSHOT_JSON_BYTES + 1, 0x20));
    expect(bomb.length).toBeLessThan(MAX_SNAPSHOT_GZIP_BYTES);
    const res = await upload(owner, bomb);
    expect(res.statusCode).toBe(413);
    expect((await get(owner)).json()).toEqual([]);
  });

  it('a non-owner is refused before the body is read', async () => {
    const { member, upload } = await setup();
    expect((await upload(member, randomBytes(64))).statusCode).toBe(403);
  });

  it(`refuses more than ${MAX_SNAPSHOTS_PER_WORLD} snapshots per world (409 limit_reached), but still replaces one`, async () => {
    const { owner, world, deps, upload } = await setup();
    const ins = deps.db.prepare(
      `INSERT INTO factory_snapshots(world_id, session_name, save_time, imported_at, imported_by, data, summary, bytes)
       VALUES (?, 'Letz Fetz', ?, 0, NULL, x'00', '{"buildings":0,"machines":0,"avgProductivity":null,"idle":0}', 1)`,
    );
    for (let i = 0; i < MAX_SNAPSHOTS_PER_WORLD; i++) ins.run(world.id, 10_000 + i);
    const res = await upload(owner, snapshot(1));
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('limit_reached');
    expect((await upload(owner, snapshot(10_000))).statusCode).toBe(201);
  });

  describe('thinning (retention)', () => {
    const DAY = 86_400_000;
    const T = Date.UTC(2026, 10, 8, 12, 30);
    const saveTimes = async (get: (cookie: string) => Promise<{ json(): unknown }>, cookie: string) =>
      ((await get(cookie)).json() as { saveTime: number }[]).map(s => s.saveTime);

    it('a newer save thins the older ones of the same hour in the same request, with one snapshots event', async () => {
      const { owner, world, events, upload, get } = await setup();
      const old = T - 5 * DAY; // 12:30, five days before T
      for (const t of [old - 20 * 60_000, old - 10 * 60_000, old]) expect((await upload(owner, snapshot(t))).statusCode).toBe(201);
      // All three are the newest's last two days: kept.
      expect(await saveTimes(get, owner)).toEqual([old, old - 10 * 60_000, old - 20 * 60_000]);
      events.length = 0;
      expect((await upload(owner, snapshot(T))).statusCode).toBe(201);
      // Now five days old: only the newest of the 12:00 hour stays.
      expect(await saveTimes(get, owner)).toEqual([T, old]);
      expect(events).toEqual([[world.id, { type: 'snapshots', rev: 4 }]]);
    });

    it('an old save whose hour has a newer one is thinned at once; another session is not thinned against it', async () => {
      const { owner, upload, get } = await setup();
      await upload(owner, snapshot(T));
      await upload(owner, snapshot(T - 5 * DAY));
      const res = await upload(owner, snapshot(T - 5 * DAY - 10 * 60_000));
      expect(res.statusCode).toBe(201);
      expect(await saveTimes(get, owner)).toEqual([T, T - 5 * DAY]);
      expect((await upload(owner, snapshot(T - 5 * DAY - 10 * 60_000, 'Other'))).statusCode).toBe(201);
      expect(await saveTimes(get, owner)).toEqual([T, T - 5 * DAY, T - 5 * DAY - 10 * 60_000]);
    });

    it('keeps the snapshot of the last import', async () => {
      const { owner, world, deps, upload, get } = await setup();
      const imported = T - 5 * DAY - 10 * 60_000;
      deps.db.prepare('UPDATE worlds SET last_import_meta = ? WHERE id = ?')
        .run(JSON.stringify({ fileName: 'x.sav', sessionName: 'Letz Fetz', saveTime: imported, build: 1 }), world.id);
      for (const t of [T, T - 5 * DAY, imported, imported - 5 * 60_000]) await upload(owner, snapshot(t));
      expect(await saveTimes(get, owner)).toEqual([T, T - 5 * DAY, imported]);
    });
  });

  it('the 121st upload in an hour gives 429', async () => {
    const { owner, upload } = await setup();
    const body = gzipSync(JSON.stringify(snapshot()));
    for (let i = 0; i < 120; i++) expect((await upload(owner, body)).statusCode).toBe(201);
    expect((await upload(owner, body)).statusCode).toBe(429);
  });

  it('deleting the world deletes its snapshots', async () => {
    const { owner, world, deps, upload, app } = await setup();
    await upload(owner, snapshot());
    const res = await app.inject({ method: 'DELETE', url: `/api/worlds/${world.id}`, headers: { cookie: owner, origin: ORIGIN } });
    expect(res.statusCode).toBe(204);
    expect(deps.db.prepare('SELECT count(*) AS n FROM factory_snapshots').get()).toEqual({ n: 0 });
  });
});
