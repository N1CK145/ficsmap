// A stand-in for src/server/parse/worker.ts in the parse pool tests. The first byte of the save picks the behaviour:
// 0 done (after the delay in byte 1, in 10 ms steps), 1 never answers, 2 reports not_a_save, 3 throws, 4 exits.
import { parentPort, workerData } from 'node:worker_threads';

parentPort.once('message', ({ buffer }) => {
  const bytes = new Uint8Array(buffer);
  const done = () => parentPort.postMessage({
    type: 'done',
    result: { meta: { sessionName: workerData.dataset.version, saveTime: bytes[2] ?? 0, build: 1 }, collected: [], openedNotLooted: [], recognised: 0 },
    timing: { parseMs: 0, totalMs: 0 },
  });
  switch (bytes[0]) {
    case 0: setTimeout(done, (bytes[1] ?? 0) * 10); break;
    case 1: setInterval(() => {}, 1000); break;
    case 2: parentPort.postMessage({ type: 'error', code: 'not_a_save', message: 'nope' }); break;
    case 3: throw new Error('boom');
    case 4: process.exit(1);
  }
});
