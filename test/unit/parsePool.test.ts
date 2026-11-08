import { existsSync, readFileSync } from 'node:fs';
import { createParsePool, SaveParseError, type ParsedSave } from '../../src/server/parse/pool.js';
import { readSaveHeader } from '../../src/server/parse/header.js';
import type { Dataset } from '../../src/shared/dataset.js';

const FAKE = new URL('../fixtures/parse/fakeWorker.mjs', import.meta.url);
const dataset = { version: 'test-ds', items: [], aliases: {} } as unknown as Dataset;
const bytes = (...b: number[]) => new Uint8Array(b).buffer;

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'resolved';
  } catch (err) {
    return err instanceof SaveParseError ? err.code : String(err);
  }
}

describe('save parse pool', () => {
  it('parses in a worker that gets the dataset, one save at a time in arrival order', async () => {
    const pool = createParsePool({ dataset, workerUrl: FAKE });
    const order: number[] = [];
    const jobs = [bytes(0, 5, 1), bytes(0, 0, 2), bytes(0, 0, 3)].map(b => pool.parse(b).then(r => { order.push(r.result.meta.saveTime); return r; }));
    const results: ParsedSave[] = await Promise.all(jobs);
    expect(results[0]!.result.meta.sessionName).toBe('test-ds');
    expect(order).toEqual([1, 2, 3]); // the first one waits 50 ms, the others still come after it
    await pool.close();
  });

  it('refuses a save beyond the queue at once (busy)', async () => {
    const pool = createParsePool({ dataset, workerUrl: FAKE, maxQueue: 1 });
    const running = code(pool.parse(bytes(0, 10)));
    const queued = code(pool.parse(bytes(0, 0)));
    expect(await code(pool.parse(bytes(0, 0)))).toBe('busy');
    expect(await running).toBe('resolved');
    expect(await queued).toBe('resolved');
    await pool.close();
  });

  it('ends a worker that takes too long (timeout) and goes on with the next save', async () => {
    const pool = createParsePool({ dataset, workerUrl: FAKE, timeoutMs: 100 });
    const slow = code(pool.parse(bytes(1)));
    const next = code(pool.parse(bytes(0, 0)));
    expect(await slow).toBe('timeout');
    expect(await next).toBe('resolved');
    await pool.close();
  });

  it('reports the worker\'s errors, exceptions and exits as parse errors', async () => {
    const pool = createParsePool({ dataset, workerUrl: FAKE });
    expect(await code(pool.parse(bytes(2)))).toBe('not_a_save');
    expect(await code(pool.parse(bytes(3)))).toBe('failed');
    expect(await code(pool.parse(bytes(4)))).toBe('failed');
    expect(await code(pool.parse(bytes(0, 0)))).toBe('resolved');
    await pool.close();
  });

  it('close() rejects waiting saves and ends the running one', async () => {
    const pool = createParsePool({ dataset, workerUrl: FAKE });
    const running = code(pool.parse(bytes(1)));
    const waiting = code(pool.parse(bytes(0, 0)));
    await pool.close();
    expect(await running).toBe('failed');
    expect(await waiting).toBe('busy');
    expect(await code(pool.parse(bytes(0, 0)))).toBe('busy');
  });
});

describe('save parse worker (the real one)', () => {
  it('answers not_a_save for bytes without a save header', async () => {
    const pool = createParsePool({ dataset });
    expect(await code(pool.parse(new TextEncoder().encode('definitely not a save').buffer))).toBe('not_a_save');
    await pool.close();
  }, 30_000);

  const fixture = process.env.FICSMAP_SAVE_FIXTURE;
  it.skipIf(!fixture || !existsSync(fixture))('parses a real save like the browser: items, nodes and the factory', async () => {
    const buf = readFileSync(fixture!);
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    const header = readSaveHeader(ab)!;
    const pool = createParsePool({ dataset });
    const { result, timing } = await pool.parse(ab);
    expect(result.meta.sessionName).toBe(header.sessionName);
    expect(Math.trunc(result.meta.saveTime)).toBe(header.saveTime);
    expect(result.resourceNodes).toBeDefined();
    expect(result.factory?.buildings.length).toBeGreaterThan(0);
    expect(result.factory?.meta.saveTime).toBe(header.saveTime);
    expect(timing.totalMs).toBeGreaterThan(0);
    await pool.close();
  }, 120_000);
});

describe('readSaveHeader', () => {
  it('returns null for bytes that are no save', () => {
    expect(readSaveHeader(new Uint8Array(10).buffer)).toBeNull();
    expect(readSaveHeader(new TextEncoder().encode('hello world, this is text').buffer)).toBeNull();
  });
});
