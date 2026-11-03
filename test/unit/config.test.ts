import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { configWarnings, loadConfig } from '../../src/server/config.js';

const base = {
  PUBLIC_URL: 'https://ficsmap.test',
  DISCORD_CLIENT_ID: 'a',
  DISCORD_CLIENT_SECRET: 'b',
  SESSION_SECRET: 's'.repeat(32),
  INVITE_JWT_SECRET: 'i'.repeat(32),
  DATASET_VERSION: 'v1',
};

describe('loadConfig', () => {
  it('rejects a short INVITE_JWT_SECRET', () => {
    expect(() => loadConfig({ ...base, INVITE_JWT_SECRET: 'x'.repeat(10) })).toThrow();
  });
  it('parses OWNER_DISCORD_IDS into a Set', () => {
    const c = loadConfig({ ...base, OWNER_DISCORD_IDS: '1, 2' });
    expect(c.ownerDiscordIds).toEqual(new Set(['1', '2']));
  });
  it('warns at startup when OWNER_DISCORD_IDS is empty (nobody could log in without an invite)', () => {
    expect(configWarnings(loadConfig(base))).toEqual([expect.stringContaining('OWNER_DISCORD_IDS is empty')]);
    expect(configWarnings(loadConfig({ ...base, OWNER_DISCORD_IDS: ' , ' }))).toHaveLength(1);
    expect(configWarnings(loadConfig({ ...base, OWNER_DISCORD_IDS: '1' }))).toEqual([]);
  });
  it('applies defaults', () => {
    const c = loadConfig(base);
    expect(c).toMatchObject({ port: 3000, trustProxy: false, cookieSecure: true, logLevel: 'info', webDir: './dist/web' });
  });
  it('COOKIE_SECURE=false disables secure cookies', () => {
    expect(loadConfig({ ...base, COOKIE_SECURE: 'false' }).cookieSecure).toBe(false);
  });
  it('detects the single dataset version', () => {
    const { DATASET_VERSION: _omit, ...env } = base;
    const dir = mkdtempSync(join(tmpdir(), 'ficsmap-ds-'));
    mkdirSync(join(dir, '9.9'));
    writeFileSync(join(dir, '9.9', 'collectibles.min.json'), '{}');
    mkdirSync(join(dir, 'empty'));
    expect(loadConfig({ ...env, DATASET_DIR: dir }).datasetVersion).toBe('9.9');
  });
  it('fails when no dataset version can be determined', () => {
    const { DATASET_VERSION: _omit, ...env } = base;
    expect(() => loadConfig({ ...env, DATASET_DIR: 'test/fixtures' })).toThrow(/DATASET_VERSION/);
  });
});
