import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { configWarnings, loadConfig } from '../../src/server/config.js';

const base = {
  PUBLIC_URL: 'https://ficsmap.test',
  DISCORD_CLIENT_ID: 'a',
  DISCORD_CLIENT_SECRET: 'b',
  SESSION_SECRET: 's'.repeat(32),
  DATASET_VERSION: 'v1',
};

describe('loadConfig', () => {
  it('rejects a short SESSION_SECRET', () => {
    expect(() => loadConfig({ ...base, SESSION_SECRET: 'x'.repeat(10) })).toThrow();
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
    expect(() => loadConfig({ ...env, DATASET_DIR: 'test/fixtures' })).toThrow(/No dataset/);
  });
  const datasets = (...names: string[]): string => {
    const dir = mkdtempSync(join(tmpdir(), 'ficsmap-ds-'));
    for (const n of names) {
      mkdirSync(join(dir, n));
      writeFileSync(join(dir, n, 'collectibles.min.json'), '{}');
    }
    return dir;
  };
  it('picks the newest game version when DATASET_VERSION is unset or latest', () => {
    const { DATASET_VERSION: _omit, ...env } = base;
    const dir = datasets('1.2.4.1', '1.2.10.0', '1.2.5.0');
    expect(loadConfig({ ...env, DATASET_DIR: dir }).datasetVersion).toBe('1.2.10.0');
    expect(loadConfig({ ...env, DATASET_DIR: dir, DATASET_VERSION: 'latest' }).datasetVersion).toBe('1.2.10.0');
  });
  it('ignores folders not named like a version when choosing the latest', () => {
    const { DATASET_VERSION: _omit, ...env } = base;
    expect(loadConfig({ ...env, DATASET_DIR: datasets('1.2.4.1', 'test') }).datasetVersion).toBe('1.2.4.1');
  });
  it('fails when several datasets have no version names', () => {
    const { DATASET_VERSION: _omit, ...env } = base;
    expect(() => loadConfig({ ...env, DATASET_DIR: datasets('a', 'b'), DATASET_VERSION: 'latest' })).toThrow(/cannot choose/);
  });
  it('a named DATASET_VERSION wins', () => {
    expect(loadConfig({ ...base, DATASET_DIR: datasets('1.2.4.1', '1.2.5.0'), DATASET_VERSION: '1.2.4.1' }).datasetVersion).toBe('1.2.4.1');
  });
});
