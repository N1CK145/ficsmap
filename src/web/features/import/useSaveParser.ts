import { useCallback, useEffect, useRef, useState } from 'react';
import type { ExtractResult } from '../../../shared/extract.js';
import type { SaveWorkerErrorCode, SaveWorkerIn, SaveWorkerOut, SaveWorkerStage } from '../../save.worker.js';

export type SaveParseError = SaveWorkerErrorCode;
export interface SaveParserState {
  status: 'idle' | 'running' | 'done' | 'error';
  stage?: SaveWorkerStage;
  percent?: number;
  result?: ExtractResult;
  error?: SaveParseError;
}

export interface SaveParser {
  start(file: File): void;
  /** Stops a running parse (terminates the worker) and returns to idle; also resets a finished one. */
  cancel(): void;
  state: SaveParserState;
}

const IDLE: SaveParserState = { status: 'idle' };
/** Real saves are a few MB; anything this large is not one, and reading it could exhaust memory. */
export const MAX_SAVE_BYTES = 256 * 2 ** 20;

/** Absolute url of a dataset version's collectibles (the worker resolves urls against its own script). */
export function datasetUrlFor(version: string): string {
  return new URL(`/data/${encodeURIComponent(version)}/collectibles.min.json`, window.location.href).href;
}

/** A failed `parseSaveFile`: the worker's error code, or `cancelled` when the signal aborted it. */
export class SaveParseFailure extends Error {
  constructor(readonly code: SaveParseError | 'cancelled') {
    super(code);
    this.name = 'SaveParseFailure';
  }
}

/**
 * Parses one file with a fresh `save.worker.ts`, as a promise (for parsing several saves one after another).
 * Rejects with SaveParseFailure; aborting `signal` terminates the worker.
 */
export function parseSaveFile(
  file: File, datasetUrl: string, onProgress?: (stage: SaveWorkerStage, percent: number) => void, signal?: AbortSignal,
): Promise<ExtractResult> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new SaveParseFailure('cancelled'));
    if (file.size > MAX_SAVE_BYTES) return reject(new SaveParseFailure('not_a_save'));
    let w: Worker | null = null;
    const finish = (fn: () => void) => {
      w?.terminate();
      w = null;
      signal?.removeEventListener('abort', onAbort);
      fn();
    };
    const onAbort = () => finish(() => reject(new SaveParseFailure('cancelled')));
    signal?.addEventListener('abort', onAbort);
    onProgress?.('reading', 0);
    file.arrayBuffer().then(buffer => {
      if (signal?.aborted) return;
      const worker = new Worker(new URL('../../save.worker.ts', import.meta.url), { type: 'module' });
      w = worker;
      worker.onmessage = ({ data }: MessageEvent<SaveWorkerOut>) => {
        if (data.type === 'progress') onProgress?.(data.stage, data.percent);
        else if (data.type === 'done') finish(() => resolve(data.result));
        else finish(() => reject(new SaveParseFailure(data.code)));
      };
      worker.onerror = () => finish(() => reject(new SaveParseFailure('failed')));
      const msg: SaveWorkerIn = { type: 'parse', buffer, datasetUrl };
      worker.postMessage(msg, [buffer]);
    }, () => finish(() => reject(new SaveParseFailure('failed'))));
  });
}

/**
 * Runs `save.worker.ts` on a file (spec §7 step 2). The file goes over as a transferred buffer
 * together with the url of the dataset the worker matches against. Every parse gets a fresh worker:
 * worker messages carry no run id, so a new start, cancel and unmount terminate the previous one.
 */
export function useSaveParser(datasetUrl: string): SaveParser {
  const [state, setState] = useState<SaveParserState>(IDLE);
  const worker = useRef<Worker | null>(null);
  /** Counts parses, so answers of a cancelled one (or a file still being read) are dropped. */
  const run = useRef(0);

  const stop = useCallback(() => {
    run.current++;
    worker.current?.terminate();
    worker.current = null;
  }, []);

  useEffect(() => stop, [stop]);

  const start = useCallback((file: File) => {
    stop();
    const id = run.current;
    if (file.size > MAX_SAVE_BYTES) {
      setState({ status: 'error', error: 'not_a_save' });
      return;
    }
    setState({ status: 'running', stage: 'reading', percent: 0 });
    void file.arrayBuffer().then(buffer => {
      if (id !== run.current) return;
      const w = new Worker(new URL('../../save.worker.ts', import.meta.url), { type: 'module' });
      worker.current = w;
      w.onmessage = ({ data }: MessageEvent<SaveWorkerOut>) => {
        if (id !== run.current) return;
        if (data.type === 'progress') {
          setState({ status: 'running', stage: data.stage, percent: data.percent });
          return;
        }
        stop(); // the parse is over: free the worker (it holds the save and the dataset)
        if (data.type === 'done') setState({ status: 'done', result: data.result });
        else setState({ status: 'error', error: data.code });
      };
      w.onerror = () => {
        if (id !== run.current) return;
        stop();
        setState({ status: 'error', error: 'failed' });
      };
      const msg: SaveWorkerIn = { type: 'parse', buffer, datasetUrl };
      w.postMessage(msg, [buffer]);
    }, () => {
      if (id === run.current) setState({ status: 'error', error: 'failed' });
    });
  }, [datasetUrl, stop]);

  const cancel = useCallback(() => {
    stop();
    setState(IDLE);
  }, [stop]);

  return { start, cancel, state };
}
