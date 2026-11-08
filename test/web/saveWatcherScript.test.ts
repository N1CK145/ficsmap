import { execFileSync, spawn } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderBash, type WatchConfig } from '../../src/web/features/saveWatcher/generate.js';

/**
 * Runs the rendered bash save watcher against a tiny local upload endpoint: the upload interval, the state file
 * across restarts (every `--once` run is a new process), the modes, and that duplicates do not count as an upload.
 */

const W = '11111111-1111-4111-8111-111111111111';
const TOKEN = `fsm_7_${'a'.repeat(21)}-_${'B'.repeat(20)}`;

function hasTools(): boolean {
  try {
    execFileSync('bash', ['-c', 'command -v curl && command -v sha256sum'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

interface Upload { name: string; auth: string | undefined }

/** The fake server: records each upload; `answer` picks the reply per save name (default: 201 imported). */
async function fakeServer(answer: (name: string) => { code: number; body: object } = () => ({ code: 201, body: { status: 'imported', newlyChecked: 0, snapshot: true } })) {
  const uploads: Upload[] = [];
  const server: Server = createServer((req, res) => {
    req.on('data', () => {});
    req.on('end', () => {
      const name = decodeURIComponent(String(req.headers['x-save-name'] ?? ''));
      uploads.push({ name, auth: req.headers.authorization });
      const a = answer(name);
      res.writeHead(a.code, { 'content-type': 'application/json' }).end(JSON.stringify(a.body));
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  return { uploads, url: `http://127.0.0.1:${port}`, close: () => new Promise<void>(resolve => server.close(() => resolve())) };
}

function setupDirs(over: Partial<WatchConfig>, serverUrl: string) {
  const dir = mkdtempSync(join(tmpdir(), 'ficsmap-watch-'));
  const saves = join(dir, 'saves');
  const state = join(dir, 'state');
  mkdirSync(saves);
  const script = join(dir, 'ficsmap-watch.sh');
  writeFileSync(script, renderBash({
    serverUrl, worldId: W, token: TOKEN, saveDir: saves, sessionFilter: 'Letz Fetz', pollSeconds: 30, intervalMinutes: 1, mode: 'newest', ...over,
  }));
  chmodSync(script, 0o755);
  const stateFile = join(state, `uploaded-${W}.txt`);
  /** A finished save, written `ageSec` seconds ago (older than the 5 s stability wait, so taken at once). */
  const save = (name: string, ageSec: number) => {
    const f = join(saves, `Letz Fetz_${name}.sav`);
    writeFileSync(f, `save ${name} ${Math.random()}`);
    const t = Date.now() / 1000 - ageSec;
    utimesSync(f, t, t);
  };
  /** Sets the remembered last upload to `secAgo` seconds ago (as if that much time had passed). */
  const setLastUpload = (secAgo: number) => {
    const lines = readFileSync(stateFile, 'utf8').split('\n').filter(l => l !== '' && !l.startsWith('last-upload '));
    lines.push(`last-upload ${Math.floor(Date.now() / 1000) - secAgo}`);
    writeFileSync(stateFile, `${lines.join('\n')}\n`);
  };
  const lastUploads = () => readFileSync(stateFile, 'utf8').split('\n').filter(l => l.startsWith('last-upload '));
  const env = { ...process.env, HOME: dir, FICSMAP_STATE_DIR: state, PATH: process.env.PATH ?? '/usr/bin:/bin' };
  /** One `--once` run (a fresh process each time, like a restart). */
  const once = () => new Promise<{ code: number | null; out: string }>(resolve => {
    const p = spawn('bash', [script, '--once'], { env });
    let out = '';
    p.stdout.on('data', d => { out += String(d); });
    p.stderr.on('data', d => { out += String(d); });
    p.on('close', code => resolve({ code, out }));
  });
  return { dir, script, env, save, setLastUpload, lastUploads, once, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

describe.skipIf(!hasTools())('bash save watcher: upload interval', () => {
  let server: Awaited<ReturnType<typeof fakeServer>>;
  let t: ReturnType<typeof setupDirs> | undefined;
  afterEach(async () => {
    await server?.close();
    t?.cleanup();
    t = undefined;
  });

  it('newest mode: a save within the interval waits, also after a restart, and goes once the interval has passed', async () => {
    server = await fakeServer();
    t = setupDirs({}, server.url);
    t.save('a', 100);
    let r = await t.once();
    expect(r.code).toBe(0);
    expect(server.uploads.map(u => u.name)).toEqual(['Letz Fetz_a.sav']);
    expect(server.uploads[0]!.auth).toBe(`Bearer ${TOKEN}`);
    expect(t.lastUploads()).toHaveLength(1);

    // A new save right after: a new process (a restart) reads the last upload from the state file and waits.
    t.save('b', 50);
    t.save('c', 40);
    r = await t.once();
    expect(r.code).toBe(0);
    expect(r.out).toContain('Letz Fetz_c.sav waits for the upload interval (one upload per 1 min); next upload in about 1 min.');
    expect(server.uploads).toHaveLength(1);

    // The interval has passed: the newest waiting save goes, the one in between is skipped.
    t.setLastUpload(61);
    r = await t.once();
    expect(server.uploads.map(u => u.name)).toEqual(['Letz Fetz_a.sav', 'Letz Fetz_c.sav']);
    // The upload's time is appended; the last line counts.
    const last = Number(t.lastUploads().at(-1)!.split(' ')[1]);
    expect(Math.abs(last - Date.now() / 1000)).toBeLessThan(10);
    // Nothing is left to do: b is older than the newest and never uploaded in newest mode.
    t.setLastUpload(61);
    await t.once();
    expect(server.uploads).toHaveLength(2);
  }, 30_000);

  it('all mode: after the interval only the newest waiting save goes, the skipped ones are logged and not tried again', async () => {
    server = await fakeServer();
    t = setupDirs({ mode: 'all' }, server.url);
    t.save('a', 100);
    await t.once();
    t.save('b', 50);
    t.save('c', 40);
    t.save('d', 30);
    t.setLastUpload(61);
    const r = await t.once();
    expect(r.out).toContain('Skipped Letz Fetz_b.sav: a newer save came in within the upload interval.');
    expect(r.out).toContain('Skipped Letz Fetz_c.sav');
    expect(server.uploads.map(u => u.name)).toEqual(['Letz Fetz_a.sav', 'Letz Fetz_d.sav']);
    t.setLastUpload(61);
    await t.once();
    expect(server.uploads).toHaveLength(2);
  }, 30_000);

  it('a duplicate or refused save does not count as an upload', async () => {
    server = await fakeServer(name => name.endsWith('a.sav')
      ? { code: 200, body: { status: 'duplicate', snapshot: true } }
      : name.endsWith('b.sav')
        ? { code: 409, body: { error: 'session_mismatch', message: 'other session' } }
        : { code: 201, body: { status: 'imported', newlyChecked: 1, snapshot: true } });
    t = setupDirs({}, server.url);
    t.save('a', 100);
    await t.once();
    expect(t.lastUploads()).toEqual([]);
    t.save('b', 50);
    await t.once();
    expect(t.lastUploads()).toEqual([]);
    t.save('c', 40);
    const r = await t.once();
    expect(r.out).not.toContain('waits for the upload interval');
    expect(server.uploads.map(u => u.name)).toEqual(['Letz Fetz_a.sav', 'Letz Fetz_b.sav', 'Letz Fetz_c.sav']);
    expect(t.lastUploads()).toHaveLength(1);
  }, 30_000);

  it('a failed upload does not count either (no last-upload line)', async () => {
    server = await fakeServer(() => ({ code: 400, body: { error: 'invalid_body', message: 'not a save' } }));
    t = setupDirs({}, server.url);
    t.save('a', 100);
    await t.once();
    expect(server.uploads).toHaveLength(1);
    expect(t.lastUploads()).toEqual([]);
  }, 30_000);

  it('interval 0: no limit, all mode uploads every new save, oldest first', async () => {
    server = await fakeServer();
    t = setupDirs({ mode: 'all', intervalMinutes: 0 }, server.url);
    t.save('a', 100);
    await t.once();
    t.save('b', 50);
    t.save('c', 40);
    const r = await t.once();
    expect(r.out).toContain('no upload interval');
    expect(server.uploads.map(u => u.name)).toEqual(['Letz Fetz_a.sav', 'Letz Fetz_b.sav', 'Letz Fetz_c.sav']);
  }, 30_000);

  it('watching: a waiting save is uploaded when the interval is up, without waiting for the next poll', async () => {
    server = await fakeServer();
    t = setupDirs({}, server.url);
    t.save('a', 100);
    await t.once();
    t.save('b', 50);
    // The last upload was 57 s ago: b is due in 3 s, the poll interval is 30 s.
    t.setLastUpload(57);
    const p = spawn('bash', [t.script], { env: t.env });
    let out = '';
    p.stdout.on('data', d => { out += String(d); });
    try {
      const deadline = Date.now() + 15_000;
      while (server.uploads.length < 2 && Date.now() < deadline) await new Promise(r => setTimeout(r, 200));
      expect(out).toContain('Letz Fetz_b.sav waits for the upload interval');
      expect(server.uploads.map(u => u.name)).toEqual(['Letz Fetz_a.sav', 'Letz Fetz_b.sav']);
    } finally {
      p.kill('SIGTERM');
      await new Promise(r => p.on('close', r));
    }
  }, 30_000);
});
