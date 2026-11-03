import { Parser, SatisfactorySaveHeader, SaveReader } from '@etothepii/satisfactory-file-parser';
import { indexDataset, type Dataset, type DatasetIndex } from '../shared/dataset.js';
import { extractCollected, type ExtractResult, type SaveLike } from '../shared/extract.js';

/**
 * Save parsing off the main thread (spec §7 steps 2–3): the parser and the extraction run here, and
 * only the extraction result goes back. `handleParse` is the testable core; the message glue at the
 * bottom only runs inside a worker.
 */

export type SaveWorkerIn = { type: 'parse'; buffer: ArrayBuffer; datasetUrl: string };
export type SaveWorkerStage = 'reading' | 'parsing' | 'extracting';
export type SaveWorkerErrorCode = 'not_a_save' | 'failed' | 'dataset_unavailable';
export type SaveWorkerOut =
  | { type: 'progress'; stage: SaveWorkerStage; percent: number }
  | { type: 'done'; result: ExtractResult }
  | { type: 'error'; code: SaveWorkerErrorCode; message: string };

type ParseIndex = Pick<DatasetIndex, 'resolve' | 'has'>;

const PARSE_FROM = 10;
const PARSE_TO = 90;
const EXTRACT_AT = 95;

/**
 * The save header if these bytes start with a readable one (a session name and a build), else null.
 * Reading the header is cheap; a file that fails here is not a save at all.
 */
export function readSaveHeader(buffer: ArrayBuffer): { sessionName: string; buildVersion: number } | null {
  try {
    const h = SatisfactorySaveHeader.Parse(new SaveReader(buffer));
    if (typeof h.sessionName !== 'string' || !Number.isFinite(h.buildVersion)) return null;
    return { sessionName: h.sessionName, buildVersion: h.buildVersion };
  } catch {
    return null;
  }
}

/**
 * Parses a save and extracts its collected items. Stages: reading 0 → parsing 10–90 (the parser's
 * own progress over the save body) → extracting 95. Percent never goes down. A file whose header
 * cannot be read is `not_a_save`; any later failure (a truncated or damaged save) is `failed`.
 */
export async function handleParse(
  buffer: ArrayBuffer, index: ParseIndex, onProgress: (m: SaveWorkerOut) => void = () => {},
): Promise<SaveWorkerOut> {
  let last = -1;
  const report = (stage: SaveWorkerStage, percent: number) => {
    const p = Math.max(last, Math.round(percent));
    if (p === last && stage === 'parsing') return;
    last = p;
    onProgress({ type: 'progress', stage, percent: p });
  };
  report('reading', 0);
  if (!readSaveHeader(buffer)) {
    return { type: 'error', code: 'not_a_save', message: 'The file has no readable Satisfactory save header.' };
  }
  try {
    report('parsing', PARSE_FROM);
    const save = Parser.ParseSave('save', buffer, {
      onProgressCallback: progress => report('parsing', PARSE_FROM + Math.min(1, Math.max(0, progress)) * (PARSE_TO - PARSE_FROM)),
    });
    report('extracting', EXTRACT_AT);
    return { type: 'done', result: extractCollected(save as unknown as SaveLike, index) };
  } catch (err) {
    console.error('Save parsing failed', err);
    return { type: 'error', code: 'failed', message: 'The save could not be parsed.' };
  }
}

/** One parse request: load the dataset index (dataset_unavailable if that fails), then handleParse. */
export async function handleRequest(
  msg: SaveWorkerIn, loadIndex: (url: string) => Promise<DatasetIndex>, post: (m: SaveWorkerOut) => void,
): Promise<void> {
  let index: DatasetIndex;
  try {
    index = await loadIndex(msg.datasetUrl);
  } catch (err) {
    console.error('Loading the dataset failed', err);
    post({ type: 'error', code: 'dataset_unavailable', message: 'The map data could not be loaded.' });
    return;
  }
  post(await handleParse(msg.buffer, index, post));
}

// --- Worker glue ---------------------------------------------------------------------------------

interface WorkerScope {
  onmessage: ((e: MessageEvent<SaveWorkerIn>) => void) | null;
  postMessage(m: SaveWorkerOut): void;
}

/** One index per dataset url, kept while the worker lives (one parse, since each parse gets a fresh worker). */
const indexes = new Map<string, Promise<DatasetIndex>>();

function loadIndex(url: string): Promise<DatasetIndex> {
  let p = indexes.get(url);
  if (!p) {
    p = fetch(url, { credentials: 'same-origin' }).then(async res => {
      if (!res.ok) throw new Error(`Dataset request failed: HTTP ${res.status}`);
      return indexDataset((await res.json()) as Dataset);
    });
    p.catch(() => indexes.delete(url));
    indexes.set(url, p);
  }
  return p;
}

if ('WorkerGlobalScope' in globalThis) {
  const scope = globalThis as unknown as WorkerScope;
  scope.onmessage = ({ data }) => {
    if (data.type === 'parse') void handleRequest(data, loadIndex, m => scope.postMessage(m));
  };
}
