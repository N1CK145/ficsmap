import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeTestApp, testConfig } from './helpers.js';

const IMMUTABLE = 'public, max-age=31536000, immutable';

async function appWithWeb() {
  const root = mkdtempSync(join(tmpdir(), 'spa-'));
  const webDir = join(root, 'web');
  const datasetDir = join(root, 'data');
  mkdirSync(join(webDir, 'assets'), { recursive: true });
  mkdirSync(join(datasetDir, 'v1'), { recursive: true });
  writeFileSync(join(webDir, 'index.html'), '<!doctype html><title>ficsmap</title>');
  writeFileSync(join(webDir, 'favicon.svg'), '<svg/>');
  writeFileSync(join(webDir, 'assets', 'app-abc.js'), 'console.log(1)');
  writeFileSync(join(datasetDir, 'v1', 'collectibles.min.json'), '{}');
  writeFileSync(join(datasetDir, 'v1', 'biomes.geojson'), '{}');
  mkdirSync(join(datasetDir, 'v1', 'tiles', '5', '0'), { recursive: true });
  writeFileSync(join(datasetDir, 'v1', 'tiles', '5', '0', '0.webp'), 'RIFF');
  return makeTestApp({ config: { ...testConfig, webDir, datasetDir } });
}

describe('static + SPA', () => {
  it('serves index.html with no-cache for client routes', async () => {
    const { app } = await appWithWeb();
    const res = await app.inject('/w/8f14e45f-ceea-4e67-a3c4-6c1b6f3b8a11');
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('<title>ficsmap</title>');
    expect(res.headers['cache-control']).toBe('no-cache');
    const root = await app.inject('/');
    expect(root.statusCode).toBe(200);
    expect(root.headers['cache-control']).toBe('no-cache');
  });
  it('serves dataset JSON as no-cache with an ETag (rebuilt in place), revalidating to 304', async () => {
    const { app } = await appWithWeb();
    const data = await app.inject('/data/v1/collectibles.min.json');
    expect(data.statusCode).toBe(200);
    expect(data.headers['cache-control']).toBe('no-cache');
    expect(data.headers.etag).toBeTruthy();
    const again = await app.inject({ url: '/data/v1/collectibles.min.json', headers: { 'if-none-match': data.headers.etag as string } });
    expect(again.statusCode).toBe(304);
  });
  it('serves the biome GeoJSON as no-cache too (recalibrated in place)', async () => {
    const { app } = await appWithWeb();
    const res = await app.inject('/data/v1/biomes.geojson');
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-cache');
  });
  it('serves tiles and hashed assets as immutable', async () => {
    const { app } = await appWithWeb();
    const tile = await app.inject('/data/v1/tiles/5/0/0.webp');
    expect(tile.statusCode).toBe(200);
    expect(tile.headers['cache-control']).toBe(IMMUTABLE);
    const asset = await app.inject('/assets/app-abc.js');
    expect(asset.statusCode).toBe(200);
    expect(asset.headers['cache-control']).toBe(IMMUTABLE);
  });
  it('serves other root files with no-cache', async () => {
    const { app } = await appWithWeb();
    const res = await app.inject('/favicon.svg');
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-cache');
  });
  it('keeps JSON 404 for api-ish and missing data/asset paths', async () => {
    const { app } = await appWithWeb();
    for (const url of ['/api/nope', '/auth/nope', '/invite', '/healthz/x', '/data/v1/missing.json']) {
      const res = await app.inject(url);
      expect(res.statusCode, url).toBe(404);
      expect(res.json().error, url).toBe('not_found');
    }
    const missingAsset = await app.inject('/assets/missing.js');
    expect(missingAsset.statusCode).toBe(404);
  });
  it('does not fall back for percent-encoded server prefixes or malformed paths', async () => {
    const { app } = await appWithWeb();
    for (const url of ['/%61pi/x', '/%64ata/x', '/%61uth/x', '/%68ealthz2', '/%zz']) {
      const res = await app.inject(url);
      // Fastify itself rejects a malformed URL with 400 before our handler runs.
      expect(res.statusCode, url).toBe(url === '/%zz' ? 400 : 404);
      expect(res.headers['content-type'], url).toContain('application/json');
      if (url !== '/%zz') expect(res.json().error, url).toBe('not_found');
    }
  });
  it('never serves files outside the dataset dir', async () => {
    const { app, deps } = await appWithWeb();
    writeFileSync(join(deps.config.datasetDir, '..', '.env'), 'SECRET=1');
    for (const url of ['/data/%2e%2e/.env', '/data/..%2f..%2f.env', '/data/../.env']) {
      const res = await app.inject(url);
      expect(res.body, url).not.toContain('SECRET');
    }
  });
  it('does not fall back for non-GET requests', async () => {
    const { app } = await appWithWeb();
    const res = await app.inject({ method: 'POST', url: '/w/x', headers: { origin: 'https://ficsmap.test', 'content-type': 'application/json' }, payload: '{}' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('not_found');
  });
  it('static GETs do not count against the per-IP limit; /api still limits at 300', async () => {
    const { app } = await appWithWeb();
    const statics = ['/data/v1/tiles/5/0/0.webp', '/data/v1/collectibles.min.json', '/assets/app-abc.js', '/', '/w/x', '/favicon.svg', '/index.html'];
    for (let i = 0; i < 400; i++) {
      const url = statics[i % statics.length]!;
      expect([url, (await app.inject(url)).statusCode]).toEqual([url, 200]);
    }
    for (let i = 0; i < 300; i++) expect((await app.inject('/api/me')).statusCode).toBe(401);
    const over = await app.inject('/api/me');
    expect(over.statusCode).toBe(429);
    expect(over.json().error).toBe('rate_limited');
  });
  it('answers 404 JSON "web app not built" when index.html is missing', async () => {
    const { app } = await makeTestApp({ config: { ...testConfig, webDir: join(tmpdir(), 'nonexistent-web-dir') } });
    const res = await app.inject('/w/abc');
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'not_found', message: 'web app not built' });
  });
});

describe('SPA security headers', () => {
  it('index.html and static files get the headers, but no default-src CSP', async () => {
    const { app } = await appWithWeb();
    for (const url of ['/', '/w/x', '/assets/app-abc.js', '/data/v1/collectibles.min.json']) {
      const res = await app.inject(url);
      expect(res.headers['x-content-type-options'], url).toBe('nosniff');
      expect(res.headers['referrer-policy'], url).toBe('same-origin');
      expect(res.headers['x-frame-options'], url).toBe('DENY');
      expect(res.headers['content-security-policy'], url).toBe("frame-ancestors 'none'");
    }
  });
});
