import { parentPort, workerData } from 'node:worker_threads';
import { Parser } from '@etothepii/satisfactory-file-parser';
import { indexDataset, type Dataset } from '../../shared/dataset.js';
import { extractCollected, type SaveLike } from '../../shared/extract.js';
import { extractFactory, type FactorySaveLike } from '../../shared/factory/extract.js';
import { extractResourceNodes, type SaveNodesLike } from '../../shared/resourceNodes.js';
import { readSaveHeader } from './header.js';
import type { ParseWorkerIn, ParseWorkerOut } from './protocol.js';

/**
 * Parses one save off the event loop: the same steps as the browser's save worker (`src/web/save.worker.ts`,
 * `handleParse`): the parser, then `extractCollected` with the dataset index, `extractResourceNodes` and
 * `extractFactory`. Only the extraction result goes back. The pool starts one worker per save and ends it afterwards,
 * so the parsed save's memory goes with it.
 */
const { dataset } = workerData as { dataset: Dataset };
const index = indexDataset(dataset);

function parse(buffer: ArrayBuffer): ParseWorkerOut {
  if (!readSaveHeader(buffer)) return { type: 'error', code: 'not_a_save', message: 'The file has no readable Satisfactory save header.' };
  try {
    const started = performance.now();
    const save = Parser.ParseSave('save', buffer);
    const parsedMs = performance.now() - started;
    const result = extractCollected(save as unknown as SaveLike, index);
    result.resourceNodes = extractResourceNodes(save as unknown as SaveNodesLike);
    try {
      result.factory = extractFactory(save as unknown as FactorySaveLike);
    } catch (err) {
      // As in the browser: without a factory snapshot the rest still counts.
      console.error('Factory extraction failed', err);
    }
    return { type: 'done', result, timing: { parseMs: Math.round(parsedMs), totalMs: Math.round(performance.now() - started) } };
  } catch (err) {
    console.error('Save parsing failed', err);
    return { type: 'error', code: 'failed', message: 'The save could not be parsed.' };
  }
}

parentPort!.once('message', (msg: ParseWorkerIn) => {
  parentPort!.postMessage(parse(msg.buffer));
});
