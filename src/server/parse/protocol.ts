import type { ExtractResult } from '../../shared/extract.js';

/** Messages between the parse pool and its worker (`worker.ts`). */
export type ParseWorkerIn = { type: 'parse'; buffer: ArrayBuffer };
export type ParseErrorCode = 'not_a_save' | 'failed';
export type ParseWorkerOut =
  | { type: 'done'; result: ExtractResult; timing: { parseMs: number; totalMs: number } }
  | { type: 'error'; code: ParseErrorCode; message: string };
