import { execFileSync } from 'node:child_process';
import { crc32 as nodeCrc32 } from 'node:zlib';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MeDto, WorldDto } from '../../src/shared/api.js';
import type { WorldCtx } from '../../src/web/app/feature.js';
import { initI18n } from '../../src/web/app/i18n/index.js';
import { ToastProvider, useToast } from '../../src/web/components/Toast.js';
import {
  configProblems, fill, psQuote, renderBash, renderCompose, renderPowerShell, runSteps, shQuote, watcherDownload, yamlQuote,
  type WatchConfig,
} from '../../src/web/features/saveWatcher/generate.js';
import { SAVE_PRESETS } from '../../src/web/features/saveWatcher/paths.js';
import { SaveWatcherSection } from '../../src/web/features/saveWatcher/SaveWatcherSection.js';
import { crc32 } from '../../src/web/features/saveWatcher/zip.js';
import { stubFetch } from './fetchStub.js';

const W = '11111111-1111-4111-8111-111111111111';
const TOKEN = `fsm_7_${'a'.repeat(21)}-_${'B'.repeat(20)}`;
const EVIL = `it's "$(rm -rf ~)" \`x\` $HOME ‘q’ ; echo pwned # @@TOKEN@@`;

const cfg = (over: Partial<WatchConfig> = {}): WatchConfig => ({
  serverUrl: 'https://ficsmap.example', worldId: W, token: TOKEN, saveDir: '/srv/saves', sessionFilter: 'Letz Fetz',
  pollSeconds: 30, intervalMinutes: 30, mode: 'newest', ...over,
});

/** What bash makes of the settings block of a rendered script (only the assignments run). */
function bashValues(script: string): Record<string, string> {
  const settings = script.slice(script.indexOf('# --- Settings'), script.indexOf('# --- End of settings'));
  const out = execFileSync('bash', ['-c', `${settings}\nprintf '%s\\0' "$SERVER_URL" "$WORLD_ID" "$UPLOAD_TOKEN" "$SAVE_DIR" "$SESSION_FILTER" "$POLL_SECONDS" "$UPLOAD_INTERVAL_MINUTES" "$UPLOAD_MODE" "$STATE_DIR"`], { encoding: 'utf8' });
  const [server, world, token, saveDir, session, poll, interval, mode, state] = out.split('\0');
  return { server: server!, world: world!, token: token!, saveDir: saveDir!, session: session!, poll: poll!, interval: interval!, mode: mode!, state: state! };
}

/** The entries of a stored zip: name → text. */
function unzip(data: Uint8Array): Map<string, { text: string; crcOk: boolean; mode: number }> {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const end = data.length - 22;
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const out = new Map<string, { text: string; crcOk: boolean; mode: number }>();
  for (let i = 0; i < count; i++) {
    const size = view.getUint32(at + 20, true);
    const nameLen = view.getUint16(at + 28, true);
    const crc = view.getUint32(at + 16, true);
    const mode = view.getUint32(at + 38, true) >>> 16;
    const offset = view.getUint32(at + 42, true);
    const name = new TextDecoder().decode(data.subarray(at + 46, at + 46 + nameLen));
    const localNameLen = view.getUint16(offset + 26, true);
    const body = data.subarray(offset + 30 + localNameLen, offset + 30 + localNameLen + size);
    out.set(name, { text: new TextDecoder().decode(body), crcOk: nodeCrc32(body) === crc, mode: mode & 0o777 });
    at += 46 + nameLen;
  }
  return out;
}

describe('save watcher script generator', () => {
  it('quotes values for bash, PowerShell and Compose', () => {
    expect(shQuote("a'b")).toBe(`'a'\\''b'`);
    expect(psQuote("a'b‘c’")).toBe(`'a''b‘‘c’’'`);
    expect(yamlQuote("it's $HOME")).toBe(`'it''s $$HOME'`);
  });

  it('bash reads every value back exactly, however hostile', () => {
    const v = bashValues(renderBash(cfg({ saveDir: EVIL, sessionFilter: EVIL })));
    expect(v).toEqual({ server: 'https://ficsmap.example', world: W, token: TOKEN, saveDir: EVIL, session: EVIL, poll: '30', interval: '30', mode: 'newest', state: '' });
    expect(bashValues(renderBash(cfg(), { docker: true }))).toMatchObject({ saveDir: '/saves', state: '/state' });
    expect(bashValues(renderBash(cfg({ intervalMinutes: 0 })))).toMatchObject({ interval: '0' });
    expect(bashValues(renderBash(cfg({ intervalMinutes: 1440 })))).toMatchObject({ interval: '1440' });
  });

  it('renders bash scripts that parse (bash -n), for bash and for Docker', () => {
    for (const script of [renderBash(cfg({ saveDir: EVIL, sessionFilter: EVIL })), renderBash(cfg({ intervalMinutes: 0 }), { docker: true })]) {
      expect(() => execFileSync('bash', ['-n'], { input: script, encoding: 'utf8' })).not.toThrow();
    }
  });

  it('renders every placeholder, and only known ones', () => {
    for (const text of [renderBash(cfg()), renderPowerShell(cfg()), renderCompose(cfg())]) expect(text).not.toMatch(/@@[A-Z_]+@@/);
    // A placeholder typed into a value stays text (one pass, values are not filled again).
    expect(renderCompose(cfg({ saveDir: '@@TOKEN@@' }))).toContain(`source: '@@TOKEN@@'`);
    expect(() => fill('x @@NOPE@@', {})).toThrow('No value for @@NOPE@@');
  });

  it('the PowerShell script holds the values as verbatim strings, with Windows line ends', () => {
    const ps = renderPowerShell(cfg({ saveDir: SAVE_PRESETS.windows, sessionFilter: "O'Brien" }));
    expect(ps).toContain(`$SaveDir = '%LOCALAPPDATA%\\FactoryGame\\Saved\\SaveGames'`);
    expect(ps).toContain(`$SessionFilter = 'O''Brien'`);
    expect(ps).toContain(`$UploadToken = '${TOKEN}'`);
    expect(ps).toContain('$UploadIntervalMinutes = 30\r\n');
    expect(renderPowerShell(cfg({ intervalMinutes: 0 }))).toContain('$UploadIntervalMinutes = 0\r\n');
    expect(ps).not.toMatch(/[^\r]\n/);
    expect(ps).not.toMatch(/Invoke-Expression|iex /i);
  });

  it('refuses settings it cannot render safely', () => {
    expect(configProblems(cfg())).toEqual([]);
    expect(configProblems(cfg({ token: 'nope', saveDir: 'a\nb', sessionFilter: 'x\u0000', pollSeconds: 2, serverUrl: 'https://x.test/#>', intervalMinutes: -1 })))
      .toEqual(['serverUrl', 'token', 'saveDir', 'sessionFilter', 'pollSeconds', 'intervalMinutes']);
    for (const bad of [1441, 1.5, Number.NaN]) expect(configProblems(cfg({ intervalMinutes: bad }))).toEqual(['intervalMinutes']);
    for (const ok of [0, 1, 1440]) expect(configProblems(cfg({ intervalMinutes: ok }))).toEqual([]);
    expect(() => renderBash(cfg({ saveDir: '' }))).toThrow(/saveDir/);
  });

  it('downloads contain the token: a script per platform, a zip with Dockerfile, script and Compose file for Docker', () => {
    const dec = (d: Uint8Array) => new TextDecoder().decode(d);
    const sh = watcherDownload('bash', cfg());
    expect(sh.fileName).toBe('ficsmap-watch.sh');
    expect(dec(sh.data)).toContain(`UPLOAD_TOKEN='${TOKEN}'`);
    expect(dec(sh.data)).not.toContain('\r');
    const ps = watcherDownload('powershell', cfg());
    expect(ps.fileName).toBe('ficsmap-watch.ps1');
    expect([...ps.data.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(dec(ps.data)).toContain(TOKEN);
    const zip = watcherDownload('docker', cfg({ saveDir: '~/my saves' }));
    expect(zip.fileName).toBe('ficsmap-watch.zip');
    const files = unzip(zip.data);
    expect([...files.keys()]).toEqual(['ficsmap-watch/Dockerfile', 'ficsmap-watch/ficsmap-watch.sh', 'ficsmap-watch/docker-compose.yml']);
    expect([...files.values()].every(f => f.crcOk)).toBe(true);
    expect(files.get('ficsmap-watch/ficsmap-watch.sh')).toMatchObject({ mode: 0o755 });
    expect(files.get('ficsmap-watch/ficsmap-watch.sh')!.text).toContain(`UPLOAD_TOKEN='${TOKEN}'`);
    expect(files.get('ficsmap-watch/ficsmap-watch.sh')!.text).toContain(`SAVE_DIR='/saves'`);
    expect(files.get('ficsmap-watch/docker-compose.yml')!.text).toContain(`source: '~/my saves'`);
    expect(files.get('ficsmap-watch/Dockerfile')!.text).toMatch(/^FROM alpine:/m);
  });

  it('crc32 matches zlib', () => {
    const data = new TextEncoder().encode('ficsmap save watcher ✓');
    expect(crc32(data)).toBe(nodeCrc32(data));
  });

  it('shows how to run it, with the save folder quoted for the shell', () => {
    expect(runSteps('bash', cfg())[0]!.code).toBe('chmod +x ficsmap-watch.sh && ./ficsmap-watch.sh');
    expect(runSteps('powershell', cfg()).map(s => s.id)).toEqual(['run', 'autostart']);
    expect(runSteps('powershell', cfg())[1]!.code).toContain('-ExecutionTimeLimit ([TimeSpan]::Zero)');
    const docker = runSteps('docker', cfg({ saveDir: "~/it's here" }));
    expect(docker[1]!.code).toContain(`-v "$HOME"'/it'\\''s here:/saves:ro'`);
    expect(runSteps('docker', cfg({ saveDir: '/srv/sat saves' }))[1]!.code).toContain(`-v '/srv/sat saves:/saves:ro'`);
  });
});

const world: WorldDto = {
  id: W, name: 'Alpha', role: 'owner', rev: 1, datasetVersion: 'v1', owner: { id: 1, displayName: 'Nick' }, members: [],
  lastImport: { at: 0, sessionName: 'Letz Fetz', fileName: 'x.sav' },
};

function Section() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const ctx = { worldId: W, world, me: { id: 1 } as MeDto, toast, navigate: vi.fn(), queryClient } as unknown as WorldCtx;
  return <SaveWatcherSection ctx={ctx} />;
}

function renderSection() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><ToastProvider><Section /></ToastProvider></QueryClientProvider>);
}

describe('SaveWatcherSection', () => {
  const blobs: Blob[] = [];
  beforeAll(() => { initI18n(['en']); });
  beforeEach(() => {
    blobs.length = 0;
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: (b: Blob) => { blobs.push(b); return 'blob:x'; }, revokeObjectURL: () => {} }));
    // jsdom cannot follow the download link.
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('creates a key, shows it once, fills it into the script and downloads the script with it', async () => {
    const token = { id: 7, label: 'Gaming PC', anySession: true, createdAt: 0, createdBy: 'Nick', lastUsedAt: null };
    let list: unknown[] = [];
    const { calls } = stubFetch({
      [`GET /api/worlds/${W}/upload-tokens`]: () => ({ body: list }),
      [`POST /api/worlds/${W}/upload-tokens`]: () => { list = [token]; return { status: 201, body: { token, secret: TOKEN } }; },
    });
    renderSection();
    expect(await screen.findByText('No key yet.')).toBeInTheDocument();
    const download = screen.getByRole('button', { name: 'Download ficsmap-watch.ps1' });
    expect(download).toBeDisabled();
    expect(screen.getByText('Create or paste an upload key first.')).toBeInTheDocument();

    await userEvent.type(screen.getByRole('textbox', { name: 'Name of the new key' }), 'Gaming PC');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Accept saves of any session' }));
    await userEvent.click(screen.getByRole('button', { name: 'Create key' }));
    await waitFor(() => expect(calls).toContainEqual({ method: 'POST', path: `/api/worlds/${W}/upload-tokens`, body: { label: 'Gaming PC', anySession: true } }));
    expect(await screen.findByRole('textbox', { name: 'New upload key' })).toHaveValue(TOKEN);
    expect(screen.getByRole('textbox', { name: 'Upload key', description: 'The new key is filled in.' })).toHaveValue(TOKEN);
    const row = await screen.findByRole('listitem', { name: 'Gaming PC' });
    expect(within(row).getByText('any session')).toBeInTheDocument();

    // The session of the world's last import is the default filter.
    expect(screen.getByRole('textbox', { name: 'Session name' })).toHaveValue('Letz Fetz');
    // The upload interval: 30 minutes by default, 0 to 1440.
    const interval = screen.getByLabelText('At most one upload every');
    expect(interval).toHaveValue(30);
    await userEvent.clear(interval);
    await userEvent.type(interval, '1441');
    expect(download).toBeDisabled();
    expect(screen.getByText('At most one upload every 0 to 1440 minutes.')).toBeInTheDocument();
    await userEvent.clear(interval);
    await userEvent.type(interval, '45');
    await userEvent.click(download);
    expect(blobs).toHaveLength(1);
    const text = await blobs[0]!.text();
    expect(text).toContain(`$UploadToken = '${TOKEN}'`);
    expect(text).toContain(`$ServerUrl = '${window.location.origin}'`);
    expect(text).toContain(`$SessionFilter = 'Letz Fetz'`);
    expect(text).toContain('$UploadIntervalMinutes = 45');
  });

  it('switching the platform swaps the default folder, the file and the run instructions', async () => {
    stubFetch({ [`GET /api/worlds/${W}/upload-tokens`]: { body: [] } });
    renderSection();
    const folder = screen.getByRole('textbox', { name: 'Save folder' });
    expect(folder).toHaveValue(SAVE_PRESETS.windows);
    await userEvent.click(screen.getByRole('radio', { name: 'Linux (bash)' }));
    expect(folder).toHaveValue(SAVE_PRESETS.proton);
    expect(screen.getByText('chmod +x ficsmap-watch.sh && ./ficsmap-watch.sh')).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Known folders:' }), 'linuxServer');
    expect(folder).toHaveValue(SAVE_PRESETS.linuxServer);
    await userEvent.click(screen.getByRole('radio', { name: 'Docker' }));
    expect(screen.getByRole('textbox', { name: 'Save folder on the Docker host' })).toHaveValue(SAVE_PRESETS.linuxServer);
    expect(screen.getByText(/docker compose up -d --build/)).toBeInTheDocument();
    // A folder typed by hand stays when the platform changes.
    const own = screen.getByRole('textbox', { name: 'Save folder on the Docker host' });
    await userEvent.clear(own);
    await userEvent.type(own, '/srv/saves');
    await userEvent.click(screen.getByRole('radio', { name: 'Windows (PowerShell)' }));
    expect(screen.getByRole('textbox', { name: 'Save folder' })).toHaveValue('/srv/saves');

    await userEvent.type(screen.getByRole('textbox', { name: 'Upload key' }), TOKEN);
    await userEvent.click(screen.getByRole('radio', { name: 'Docker' }));
    await userEvent.click(screen.getByRole('button', { name: 'Download ficsmap-watch.zip' }));
    expect(blobs[0]!.type).toBe('application/zip');
  });

  it('revokes a key after confirming', async () => {
    const token = { id: 3, label: 'Server', anySession: false, createdAt: 0, createdBy: 'Nick', lastUsedAt: Date.UTC(2026, 10, 8) };
    const { calls } = stubFetch({
      [`GET /api/worlds/${W}/upload-tokens`]: { body: [token] },
      [`DELETE /api/worlds/${W}/upload-tokens/3`]: { status: 204 },
    });
    renderSection();
    const row = await screen.findByRole('listitem', { name: 'Server' });
    expect(within(row).getByText(/last used/)).toBeInTheDocument();
    await userEvent.click(within(row).getByRole('button', { name: 'Revoke Server' }));
    await userEvent.click(screen.getByRole('button', { name: 'Revoke key' }));
    await waitFor(() => expect(calls).toContainEqual({ method: 'DELETE', path: `/api/worlds/${W}/upload-tokens/3`, body: undefined }));
  });
});
