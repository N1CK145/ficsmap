import { SseHub } from '../../src/server/sse/hub.js';
import type { SseEvent } from '../../src/shared/sse.js';
import { MAX_SAVE_UPLOAD_BYTES, MAX_UPLOAD_TOKENS_PER_WORLD, SAVE_UPLOADS_PER_HOUR, UPLOAD_TOKEN_RE } from '../../src/shared/saveUpload.js';
import { saveFileName } from '../../src/server/http/saves.js';
import { addMember, makeTestApp } from './helpers.js';
import { fakeParser, fakeSaveBytes } from './fakeSave.js';

const ORIGIN = 'https://ficsmap.test';
const json = { origin: ORIGIN, 'content-type': 'application/json' };
const T1 = Date.UTC(2026, 10, 1, 12);
const T2 = Date.UTC(2026, 10, 2, 12);
const T3 = Date.UTC(2026, 10, 3, 12);

async function setup(collected?: string[]) {
  const hub = new SseHub();
  const events: [string, SseEvent][] = [];
  const orig = hub.broadcast.bind(hub);
  hub.broadcast = (id, e) => { events.push([id, e]); orig(id, e); };
  const parser = fakeParser(collected);
  const t = await makeTestApp({ hub, now: () => 9_000, saveParser: parser });
  const items = t.deps.dataset.items.map(i => i.name);
  const owner = await t.login('owner-1');
  const mkWorld = async (name: string) =>
    (await t.app.inject({ method: 'POST', url: '/api/worlds', headers: { ...json, cookie: owner }, payload: { name } })).json() as { id: string };
  const world = await mkWorld('W');
  addMember(t.deps.db, world.id, t.createUser('other'));
  const member = await t.login('other');
  t.createUser('stranger');
  const stranger = await t.login('stranger');
  const tokens = `/api/worlds/${world.id}/upload-tokens`;
  const createToken = async (cookie = owner, payload: object = { label: 'PC' }, worldId = world.id) =>
    t.app.inject({ method: 'POST', url: `/api/worlds/${worldId}/upload-tokens`, headers: { ...json, cookie }, payload });
  const upload = (token: string | undefined, body: Buffer, headers: Record<string, string> = {}, worldId = world.id) =>
    t.app.inject({
      method: 'POST', url: `/api/worlds/${worldId}/saves`,
      headers: { 'content-type': 'application/octet-stream', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
      payload: body,
    });
  const secret = async (payload: object = { label: 'PC' }) => (await createToken(owner, payload)).json().secret as string;
  return { ...t, owner, member, stranger, world, events, parser, items, tokens, createToken, upload, secret, mkWorld };
}

describe('upload tokens api', () => {
  it('the owner creates a token (secret once), lists it without secret and revokes it', async () => {
    const { app, owner, tokens, createToken, deps } = await setup();
    const res = await createToken(owner, { label: '  Gaming PC  ', anySession: true });
    expect(res.statusCode).toBe(201);
    expect(res.headers['cache-control']).toBe('no-store');
    const created = res.json();
    expect(created.secret).toMatch(UPLOAD_TOKEN_RE);
    expect(created.token).toEqual({ id: expect.any(Number), label: 'Gaming PC', anySession: true, createdAt: 9_000, createdBy: 'user-owner-1', lastUsedAt: null });
    // Only the hash is stored.
    const row = deps.db.prepare('SELECT * FROM upload_tokens').get() as Record<string, unknown>;
    expect(JSON.stringify(row)).not.toContain(created.secret.split('_').pop());

    const list = await app.inject({ url: tokens, headers: { cookie: owner } });
    expect(list.json()).toEqual([created.token]);
    expect(list.body).not.toContain(created.secret);

    expect((await app.inject({ method: 'DELETE', url: `${tokens}/${created.token.id}`, headers: { origin: ORIGIN, cookie: owner } })).statusCode).toBe(204);
    expect((await app.inject({ url: tokens, headers: { cookie: owner } })).json()).toEqual([]);
    expect((await app.inject({ method: 'DELETE', url: `${tokens}/${created.token.id}`, headers: { origin: ORIGIN, cookie: owner } })).statusCode).toBe(404);
  });

  it('members get 403, strangers 404, signed-out users 401; a bad label is 400', async () => {
    const { app, member, stranger, tokens, createToken, owner } = await setup();
    expect((await createToken(member)).statusCode).toBe(403);
    expect((await createToken(stranger)).statusCode).toBe(404);
    expect((await app.inject({ url: tokens, headers: { cookie: member } })).statusCode).toBe(403);
    expect((await app.inject({ url: tokens })).statusCode).toBe(401);
    expect((await createToken(owner, { label: '   ' })).statusCode).toBe(400);
    expect((await createToken(owner, { label: 'x'.repeat(81) })).statusCode).toBe(400);
  });

  it(`allows ${MAX_UPLOAD_TOKENS_PER_WORLD} active tokens per world (409 limit_reached), a revoked one frees a place`, async () => {
    const { app, owner, tokens, createToken } = await setup();
    let last = 0;
    for (let i = 0; i < MAX_UPLOAD_TOKENS_PER_WORLD; i++) last = (await createToken()).json().token.id;
    const over = await createToken();
    expect(over.statusCode).toBe(409);
    expect(over.json().error).toBe('limit_reached');
    await app.inject({ method: 'DELETE', url: `${tokens}/${last}`, headers: { origin: ORIGIN, cookie: owner } });
    expect((await createToken()).statusCode).toBe(201);
  });

  it('a token is gone with its world', async () => {
    const { app, owner, world, createToken, deps } = await setup();
    await createToken();
    await app.inject({ method: 'DELETE', url: `/api/worlds/${world.id}`, headers: { origin: ORIGIN, cookie: owner } });
    expect(deps.db.prepare('SELECT count(*) AS n FROM upload_tokens').get()).toEqual({ n: 0 });
  });
});

describe('save upload api', () => {
  it('the first save is imported like a browser import, with its snapshot, events and last use', async () => {
    const { app, owner, world, events, upload, secret, deps } = await setup();
    const t = await secret();
    const res = await upload(t, fakeSaveBytes('Letz Fetz', T2), { 'x-save-name': encodeURIComponent('Letz Fetz_021126 Öl.sav') });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ status: 'imported', sessionName: 'Letz Fetz', saveTime: T2, newlyChecked: 0, conflicts: 0, snapshot: true });
    const w = (await app.inject({ url: `/api/worlds/${world.id}`, headers: { cookie: owner } })).json();
    expect(w.lastImport).toMatchObject({ sessionName: 'Letz Fetz', fileName: 'Letz Fetz_021126 Öl.sav' });
    expect(events.map(e => e[1].type)).toEqual(expect.arrayContaining(['import', 'snapshots']));
    const snaps = (await app.inject({ url: `/api/worlds/${world.id}/snapshots`, headers: { cookie: owner } })).json();
    expect(snaps).toMatchObject([{ sessionName: 'Letz Fetz', saveTime: T2, importedBy: 'user-owner-1' }]);
    expect((deps.db.prepare('SELECT last_used_at FROM upload_tokens').get() as { last_used_at: number }).last_used_at).toBe(9_000);
  });

  it('checks the collected items of the save and attributes them to the token creator', async () => {
    const t = await setup();
    t.parser.parse = fakeParser([t.items[0]!, t.items[1]!]).parse;
    const secret = await t.secret();
    const res = await t.upload(secret, fakeSaveBytes('S', T1));
    expect(res.json()).toMatchObject({ status: 'imported', newlyChecked: 2 });
    const marks = (await t.app.inject({ url: `/api/worlds/${t.world.id}/marks`, headers: { cookie: t.owner } })).json();
    expect(marks.marks.map((m: unknown[]) => m[0]).sort()).toEqual([t.items[0], t.items[1]].sort());
    expect(marks.marks[0][2]).toBe(t.deps.db.prepare("SELECT id FROM users WHERE display_name = 'user-owner-1'").pluck().get());
  });

  it('a newer save is imported, an older one only stored as a snapshot, the same one again is a duplicate without a parse', async () => {
    const { upload, secret, parser, app, owner, world } = await setup();
    const tok = await secret();
    expect((await upload(tok, fakeSaveBytes('S', T2))).json().status).toBe('imported');
    const older = await upload(tok, fakeSaveBytes('S', T1));
    expect(older.statusCode).toBe(201);
    expect(older.json()).toEqual({ status: 'snapshot', sessionName: 'S', saveTime: T1, snapshot: true });
    const w = (await app.inject({ url: `/api/worlds/${world.id}`, headers: { cookie: owner } })).json();
    expect(w.lastImport.at).toBe(9_000);
    const newer = await upload(tok, fakeSaveBytes('S', T3));
    expect(newer.json().status).toBe('imported');
    const calls = parser.calls;
    for (const t of [T1, T2, T3]) {
      const dup = await upload(tok, fakeSaveBytes('S', t));
      expect(dup.statusCode).toBe(200);
      expect(dup.json()).toEqual({ status: 'duplicate', sessionName: 'S', saveTime: t, snapshot: true });
    }
    expect(parser.calls).toBe(calls);
    const snaps = (await app.inject({ url: `/api/worlds/${world.id}/snapshots`, headers: { cookie: owner } })).json();
    expect(snaps.map((s: { saveTime: number }) => s.saveTime)).toEqual([T3, T2, T1]);
  });

  it('an older save thinned at once by the retention rule says so (note thinned, snapshot false)', async () => {
    const { upload, secret } = await setup();
    const tok = await secret();
    expect((await upload(tok, fakeSaveBytes('S', T3))).json().status).toBe('imported');
    // 10 days before T3, two saves in one clock hour: the newer is kept, the older is thinned when it arrives.
    const old = T3 - 10 * 86_400_000 + 30 * 60_000; // 12:30
    expect((await upload(tok, fakeSaveBytes('S', old))).json()).toMatchObject({ status: 'snapshot', snapshot: true });
    const res = await upload(tok, fakeSaveBytes('S', old - 60_000));
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ status: 'snapshot', sessionName: 'S', saveTime: old - 60_000, snapshot: false, note: 'thinned' });
  });

  it('refuses a save of another session (409 session_mismatch) unless the token accepts any session', async () => {
    const { upload, secret } = await setup();
    const tok = await secret();
    await upload(tok, fakeSaveBytes('Letz Fetz', T1));
    const other = await upload(tok, fakeSaveBytes('Other', T2));
    expect(other.statusCode).toBe(409);
    expect(other.json().error).toBe('session_mismatch');
    const any = await secret({ label: 'any', anySession: true });
    expect((await upload(any, fakeSaveBytes('Other', T2))).json().status).toBe('imported');
  });

  it('expects the session of the newest snapshot when the world has no import yet', async () => {
    const { upload, secret, deps, world } = await setup();
    deps.db.prepare(`INSERT INTO factory_snapshots(world_id, session_name, save_time, imported_at, data, summary, bytes)
      VALUES (?, 'Old', 1, 0, x'00', '{}', 1)`).run(world.id);
    const tok = await secret();
    expect((await upload(tok, fakeSaveBytes('New', T1))).statusCode).toBe(409);
    expect((await upload(tok, fakeSaveBytes('Old', T1))).json().status).toBe('imported');
  });

  it('needs a valid, active token of this world; cookies do not count and no Origin is needed', async () => {
    const { upload, secret, owner, createToken, mkWorld, app, tokens } = await setup();
    const body = fakeSaveBytes('S', T1);
    expect((await upload(undefined, body)).statusCode).toBe(401);
    expect((await upload(undefined, body, { cookie: owner, origin: ORIGIN })).statusCode).toBe(401);
    expect((await upload('fsm_1_' + 'a'.repeat(43), body)).statusCode).toBe(401);
    expect((await upload('nonsense', body)).headers['www-authenticate']).toBe('Bearer');
    const tok = await secret();
    // Right id, wrong secret.
    expect((await upload(tok.slice(0, -1) + (tok.endsWith('A') ? 'B' : 'A'), body)).statusCode).toBe(401);
    // Another world's token.
    const w2 = await mkWorld('W2');
    const other = (await createToken(owner, { label: 'x' }, w2.id)).json().secret;
    expect((await upload(other, body)).statusCode).toBe(401);
    expect((await upload(other, body, {}, w2.id)).statusCode).toBe(201);
    // Revoked.
    const id = (await app.inject({ url: tokens, headers: { cookie: owner } })).json()[0].id;
    await app.inject({ method: 'DELETE', url: `${tokens}/${id}`, headers: { origin: ORIGIN, cookie: owner } });
    expect((await upload(tok, body)).statusCode).toBe(401);
    // Unknown world id.
    expect((await upload(tok, body, {}, '00000000-0000-4000-8000-000000000000')).statusCode).toBe(401);
  });

  it('takes only a .sav body: empty or not a save is 400, another content type 415, more than 64 MB 413', async () => {
    const { upload, secret, parser } = await setup();
    const tok = await secret();
    expect((await upload(tok, Buffer.alloc(0))).statusCode).toBe(400);
    const junk = await upload(tok, Buffer.from('not a save at all'));
    expect(junk.statusCode).toBe(400);
    expect(junk.json().error).toBe('invalid_body');
    expect((await upload(tok, fakeSaveBytes('S', T1), { 'content-type': 'text/plain' })).statusCode).toBe(415);
    expect((await upload(tok, Buffer.alloc(MAX_SAVE_UPLOAD_BYTES + 1))).statusCode).toBe(413);
    expect(parser.calls).toBe(0);
  });

  it('a parse failure is 400; a full queue or a timeout is 503 busy with Retry-After', async () => {
    const { upload, secret, parser } = await setup();
    const tok = await secret();
    parser.fail = 'failed';
    expect((await upload(tok, fakeSaveBytes('S', T1))).statusCode).toBe(400);
    parser.fail = 'busy';
    const busy = await upload(tok, fakeSaveBytes('S', T1));
    expect(busy.statusCode).toBe(503);
    expect(busy.json().error).toBe('busy');
    expect(busy.headers['retry-after']).toBe('60');
    parser.fail = 'timeout';
    expect((await upload(tok, fakeSaveBytes('S', T1))).statusCode).toBe(503);
    expect((await upload(tok, fakeSaveBytes('S', T1))).statusCode).toBe(201);
  });

  it(`allows ${SAVE_UPLOADS_PER_HOUR} uploads per token and hour (429), counted per token`, async () => {
    const { upload, secret } = await setup();
    const tok = await secret();
    const other = await secret({ label: 'other' });
    await upload(tok, fakeSaveBytes('S', T1));
    for (let i = 1; i < SAVE_UPLOADS_PER_HOUR; i++) expect((await upload(tok, fakeSaveBytes('S', T1))).statusCode).toBe(200);
    const limited = await upload(tok, fakeSaveBytes('S', T1));
    expect(limited.statusCode).toBe(429);
    expect(limited.json().error).toBe('rate_limited');
    expect((await upload(other, fakeSaveBytes('S', T1))).statusCode).toBe(200);
  });
});

describe('csrf exemption', () => {
  it('covers only the bearer upload route: other writes still need the Origin and JSON', async () => {
    const { app, world, secret } = await setup();
    const tok = await secret();
    const res = await app.inject({
      method: 'POST', url: `/api/worlds/${world.id}/import`,
      headers: { 'content-type': 'application/octet-stream', authorization: `Bearer ${tok}` }, payload: Buffer.from('x'),
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('invalid_origin');
  });
});

describe('saveFileName', () => {
  it('decodes percent-encoding, drops paths and control characters, falls back to the session', () => {
    expect(saveFileName(encodeURIComponent('Fabrik München_autosave_0.sav'), 'x')).toBe('Fabrik München_autosave_0.sav');
    expect(saveFileName('C:%5CUsers%5Cme%5Ca.sav', 'x')).toBe('a.sav');
    expect(saveFileName('../../etc/passwd', 'x')).toBe('passwd');
    expect(saveFileName('a%0Ab.sav', 'x')).toBe('ab.sav');
    expect(saveFileName(undefined, 'Letz Fetz')).toBe('Letz Fetz.sav');
    expect(saveFileName('%E0%A4%A', 'S')).toBe('%E0%A4%A');
  });
});
