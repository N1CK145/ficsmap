import { Worker, type ResourceLimits } from 'node:worker_threads';
import type { Dataset } from '../../shared/dataset.js';
import type { ExtractResult } from '../../shared/extract.js';
import type { ParseWorkerIn, ParseWorkerOut } from './protocol.js';

/** What a server-side parse returns: the same result the browser's save worker sends to the import. */
export interface ParsedSave {
  result: ExtractResult;
  timing: { parseMs: number; totalMs: number };
}

/** `busy`: the queue is full; `timeout`: the parse took longer than allowed (the worker was ended). */
export type SaveParseErrorCode = 'not_a_save' | 'failed' | 'busy' | 'timeout';

export class SaveParseError extends Error {
  constructor(readonly code: SaveParseErrorCode, message: string) {
    super(message);
    this.name = 'SaveParseError';
  }
}

export interface SaveParser {
  /** Parses a save; the buffer is transferred to the worker (unusable afterwards). Rejects with SaveParseError. */
  parse(buffer: ArrayBuffer): Promise<ParsedSave>;
  close(): Promise<void>;
}

export interface ParsePoolOptions {
  dataset: Dataset;
  /** Default 120 s. */
  timeoutMs?: number;
  /** Saves waiting behind the running one; one more is refused as `busy`. Default 4. */
  maxQueue?: number;
  /** Heap limits of each worker (a large save needs a few hundred MB while it is parsed). */
  resourceLimits?: ResourceLimits;
  /** The worker module (tests); default `worker.js` next to this file (`worker.ts` under tsx or vitest). */
  workerUrl?: URL;
}

export const PARSE_TIMEOUT_MS = 120_000;
export const PARSE_MAX_QUEUE = 4;
/** Measured: the Letz Fetz save of 2026-11-08 (2.5 MB compressed, 3,193 buildings) peaks at about 520 MB RSS; room for larger saves. */
export const PARSE_HEAP_MB = 3072;

interface Job {
  buffer: ArrayBuffer;
  resolve(p: ParsedSave): void;
  reject(e: SaveParseError): void;
}

/** The worker module next to this file, and the flags to load it: TypeScript sources (dev, tests) need tsx's loader. */
function defaultWorker(): { url: URL; execArgv: string[] | undefined } {
  const here = import.meta.url;
  if (!here.endsWith('.ts')) return { url: new URL('./worker.js', here), execArgv: undefined };
  const hasTsx = process.execArgv.some(a => a.includes('tsx'));
  return { url: new URL('./worker.ts', here), execArgv: hasTsx ? process.execArgv : [...process.execArgv, '--import', 'tsx'] };
}

/**
 * Parses uploaded saves in `worker_threads` workers, one at a time per process, so a parse never blocks the event loop
 * and two large saves never sit in memory at once. Each save gets a fresh worker that is ended afterwards (and on a
 * timeout). A small queue holds saves arriving meanwhile; beyond it the caller gets `busy` at once.
 */
export function createParsePool(opts: ParsePoolOptions): SaveParser {
  const timeoutMs = opts.timeoutMs ?? PARSE_TIMEOUT_MS;
  const maxQueue = opts.maxQueue ?? PARSE_MAX_QUEUE;
  const resourceLimits = opts.resourceLimits ?? { maxOldGenerationSizeMb: PARSE_HEAP_MB };
  const worker = opts.workerUrl ? { url: opts.workerUrl, execArgv: undefined } : defaultWorker();
  const queue: Job[] = [];
  let running: Worker | null = null;
  let closed = false;

  function run(job: Job): void {
    let settled = false;
    const w = new Worker(worker.url, {
      workerData: { dataset: opts.dataset },
      resourceLimits,
      ...(worker.execArgv ? { execArgv: worker.execArgv } : {}),
    });
    running = w;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
      void w.terminate().finally(() => {
        if (running === w) running = null;
        next();
      });
    };
    const timer = setTimeout(() => finish(() => job.reject(new SaveParseError('timeout', 'Parsing the save took too long'))), timeoutMs);
    w.once('message', (m: ParseWorkerOut) => finish(() => {
      if (m.type === 'done') job.resolve({ result: m.result, timing: m.timing });
      else job.reject(new SaveParseError(m.code, m.message));
    }));
    // An exception in the worker, or running out of its heap (ERR_WORKER_OUT_OF_MEMORY).
    w.once('error', err => finish(() => job.reject(new SaveParseError('failed', `The save could not be parsed (${err.message})`))));
    w.once('exit', () => finish(() => job.reject(new SaveParseError('failed', 'The parser stopped unexpectedly'))));
    w.postMessage({ type: 'parse', buffer: job.buffer } satisfies ParseWorkerIn, [job.buffer]);
  }

  function next(): void {
    if (running || closed) return;
    const job = queue.shift();
    if (job) run(job);
  }

  return {
    parse(buffer) {
      if (closed) return Promise.reject(new SaveParseError('busy', 'The server is shutting down'));
      if (running && queue.length >= maxQueue) return Promise.reject(new SaveParseError('busy', 'Too many saves are waiting to be parsed'));
      return new Promise<ParsedSave>((resolve, reject) => {
        queue.push({ buffer, resolve, reject });
        next();
      });
    },
    async close() {
      closed = true;
      for (const job of queue.splice(0)) job.reject(new SaveParseError('busy', 'The server is shutting down'));
      await running?.terminate();
    },
  };
}
