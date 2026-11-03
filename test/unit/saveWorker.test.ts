import { existsSync, readFileSync } from 'node:fs';
import { indexDataset, type Dataset } from '../../src/shared/dataset.js';
import { handleParse, handleRequest, readSaveHeader, type SaveWorkerOut } from '../../src/web/save.worker.js';

const tiny = indexDataset({
  version: 't', build: 1, bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 }, mapId: 'm', podRequirementsKnown: true,
  biomes: [], items: [], aliases: {},
} satisfies Dataset);

describe('readSaveHeader', () => {
  it('returns null for bytes that are not a save header', () => {
    expect(readSaveHeader(new Uint8Array([1, 2, 3]).buffer)).toBeNull();
    expect(readSaveHeader(new Uint8Array(4096).buffer)).toBeNull();
    expect(readSaveHeader(new TextEncoder().encode('just some text, not a save at all '.repeat(40)).buffer as ArrayBuffer)).toBeNull();
  });
});

describe('handleParse', () => {
  it('reports not_a_save for a garbage buffer (Review Focus 5)', async () => {
    const out = await handleParse(new Uint8Array([1, 2, 3]).buffer, tiny);
    expect(out).toMatchObject({ type: 'error', code: 'not_a_save' });
  });
});

describe('handleRequest', () => {
  it('reports dataset_unavailable when the dataset cannot be loaded', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const posted: SaveWorkerOut[] = [];
    await handleRequest(
      { type: 'parse', buffer: new Uint8Array([1, 2, 3]).buffer, datasetUrl: 'http://x/d.json' },
      () => Promise.reject(new Error('offline')),
      m => posted.push(m),
    );
    expect(posted).toEqual([expect.objectContaining({ type: 'error', code: 'dataset_unavailable' })]);
    err.mockRestore();
  });

  it('parses with the loaded index and posts progress and the answer', async () => {
    const posted: SaveWorkerOut[] = [];
    await handleRequest({ type: 'parse', buffer: new Uint8Array([1, 2, 3]).buffer, datasetUrl: 'u' }, async () => tiny, m => posted.push(m));
    expect(posted.map(m => m.type)).toEqual(['progress', 'error']);
    expect(posted.at(-1)).toMatchObject({ code: 'not_a_save' });
  });
});

// Needs a save file and the built dataset (git-ignored, data/1.2.4.1); skipped without either.
const fixture = existsSync('data/1.2.4.1/collectibles.min.json') ? process.env.FICSMAP_SAVE_FIXTURE : undefined;
describe('real save', () => {
  const load = () => {
    const buf = readFileSync(fixture!);
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  };
  const real = () => indexDataset(JSON.parse(readFileSync('data/1.2.4.1/collectibles.min.json', 'utf8')) as Dataset);

  it.skipIf(!fixture)('parses with stage progress and finds 10 hard drives', async () => {
    const index = real();
    const progress: SaveWorkerOut[] = [];
    const out = await handleParse(load(), index, m => progress.push(m));
    expect(out.type).toBe('done');
    if (out.type !== 'done') return;
    expect(out.result.collected.filter(n => index.byName.get(n)?.type === 'hard_drive')).toHaveLength(10);
    expect(out.result.meta.build).toBe(index.ds.build);
    const stages = progress.map(p => (p.type === 'progress' ? p.stage : p.type));
    expect(stages[0]).toBe('reading');
    expect(stages).toContain('parsing');
    expect(stages.at(-1)).toBe('extracting');
    const percents = progress.map(p => (p.type === 'progress' ? p.percent : -1));
    expect(percents).toEqual([...percents].sort((a, b) => a - b));
  }, 30_000);

  it.skipIf(!fixture)('reports failed (not not_a_save) for a truncated save whose header still reads', async () => {
    const half = load().slice(0, 700_000);
    expect(readSaveHeader(half)).not.toBeNull();
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await handleParse(half, real())).toMatchObject({ type: 'error', code: 'failed' });
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  }, 30_000);
});
