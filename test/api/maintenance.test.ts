import { runRollbackCli } from '../../src/server/version/cli.js';
import type { RollbackPlan } from '../../src/server/version/guard.js';
import { buildMaintenanceApp, type MaintenanceState } from '../../src/server/version/maintenance.js';
import { fakeDiscord, testConfig } from './helpers.js';

const restore: RollbackPlan = { kind: 'restore', backup: '/data/backups/pre-v0.2.0-from-v0.1.0-20261101T080000Z.db' };
const ORIGIN = 'https://ficsmap.test';

async function setup(plan: RollbackPlan = restore) {
  const state: MaintenanceState = { stored: '0.2.0', current: '0.1.0', plan };
  const confirm = vi.fn(async () => {});
  const restart = vi.fn();
  const app = await buildMaintenanceApp({ config: testConfig, discord: fakeDiscord, state, confirm, restart });
  /** The real sign-in: /maintenance/login, then the Discord callback with the given Discord id as code. */
  const signIn = async (discordId: string) => {
    const login = await app.inject('/maintenance/login');
    const tx = login.cookies.find(c => c.name === 'maint_tx')!;
    const state = new URL(login.headers.location as string).searchParams.get('state')!;
    const cb = await app.inject({ url: `/auth/discord/callback?code=${discordId}&state=${encodeURIComponent(state)}`, cookies: { maint_tx: tx.value } });
    return { cb, owner: cb.cookies.find(c => c.name === 'maint_owner')?.value };
  };
  return { app, confirm, restart, signIn };
}

describe('maintenance mode', () => {
  it('shows every page as a maintenance notice with what a rollback does, and reports unhealthy', async () => {
    const { app } = await setup();
    const res = await app.inject('/w/some-world');
    expect(res.statusCode).toBe(503);
    expect(res.body).toContain('started with ficsmap v0.1.0, but the data was last used by v0.2.0');
    expect(res.body).toContain('restores the backup from 2026-11-01 08:00 UTC');
    expect(res.body).toContain('Sign in with Discord as an owner');
    expect(res.body).toContain('docker compose run --rm ficsmap rollback');
    expect((await app.inject('/healthz')).statusCode).toBe(503);
  });

  it('speaks German to a German browser', async () => {
    const { app } = await setup();
    const res = await app.inject({ url: '/', headers: { 'accept-language': 'de-DE,de;q=0.9' } });
    expect(res.body).toContain('ficsmap ist im Wartungsmodus');
  });

  it('lets an owner confirm after signing in, then restarts', async () => {
    const { app, confirm, restart, signIn } = await setup();
    const { owner } = await signIn('owner-1');
    expect(owner).toBeDefined();
    expect((await app.inject({ url: '/', cookies: { maint_owner: owner! } })).body).toContain('Roll back to v0.1.0');

    const res = await app.inject({
      method: 'POST', url: '/maintenance/rollback', cookies: { maint_owner: owner! },
      headers: { origin: ORIGIN, 'content-type': 'application/x-www-form-urlencoded' }, payload: '',
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('restarting with v0.1.0');
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(restart).toHaveBeenCalledTimes(1);
  });

  it('does not let a non-owner, a foreign origin or a blocked plan confirm', async () => {
    const { app, confirm, signIn } = await setup();
    const { cb, owner } = await signIn('someone-else');
    expect(owner).toBeUndefined();
    expect(cb.headers.location).toBe('/?login=not-owner');

    const ownerCookie = (await signIn('owner-1')).owner!;
    const foreign = await app.inject({
      method: 'POST', url: '/maintenance/rollback', cookies: { maint_owner: ownerCookie },
      headers: { origin: 'https://evil.test', 'content-type': 'application/x-www-form-urlencoded' }, payload: '',
    });
    expect(foreign.statusCode).toBe(403);
    const anonymous = await app.inject({
      method: 'POST', url: '/maintenance/rollback', headers: { origin: ORIGIN, 'content-type': 'application/x-www-form-urlencoded' }, payload: '',
    });
    expect(anonymous.statusCode).toBe(303);
    expect(confirm).not.toHaveBeenCalled();

    const blocked = await setup({ kind: 'blocked', schema: 3, supported: 2 });
    const page = await blocked.app.inject('/');
    expect(page.body).toContain('too new for v0.1.0');
    expect(page.body).not.toContain('Sign in with Discord');
  });
});

describe('rollback command', () => {
  const run = (o: Partial<Parameters<typeof runRollbackCli>[0]> = {}) => {
    const lines: string[] = [];
    const perform = vi.fn(async () => {});
    const result = runRollbackCli({
      stored: '0.2.0', current: '0.1.0', plan: () => restore, perform, args: [], out: l => lines.push(l), ...o,
    });
    return { result, lines, perform };
  };

  it('warns and rolls back after a yes', async () => {
    const { result, lines, perform } = run({ ask: async () => 'y' });
    expect(await result).toBe(0);
    expect(lines[0]).toContain('WARNING');
    expect(lines.join('\n')).toContain('Everything changed since then is lost');
    expect(perform).toHaveBeenCalledWith(restore);
  });

  it('changes nothing on no, without a terminal, or when there is nothing to roll back', async () => {
    const no = run({ ask: async () => '' });
    expect(await no.result).toBe(1);
    expect(no.perform).not.toHaveBeenCalled();

    const noTty = run();
    expect(await noTty.result).toBe(1);
    expect(noTty.lines.join('\n')).toContain('pass --yes');

    const same = run({ stored: '0.1.0' });
    expect(await same.result).toBe(0);
    expect(same.lines[0]).toContain('Nothing to roll back');
    expect(same.perform).not.toHaveBeenCalled();
  });

  it('--yes skips the question', async () => {
    const { result, perform } = run({ args: ['--yes'] });
    expect(await result).toBe(0);
    expect(perform).toHaveBeenCalled();
  });
});
