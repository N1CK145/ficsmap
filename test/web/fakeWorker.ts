import type { SaveWorkerIn, SaveWorkerOut } from '../../src/web/save.worker.js';

/** Stands in for the module worker: records posts, lets the test answer. */
export class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((e: MessageEvent<SaveWorkerOut>) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  posted: { msg: SaveWorkerIn; transfer: Transferable[] }[] = [];
  terminate = vi.fn();
  constructor(readonly url: string | URL, readonly options?: WorkerOptions) {
    FakeWorker.instances.push(this);
  }
  postMessage(msg: SaveWorkerIn, transfer: Transferable[] = []) {
    this.posted.push({ msg, transfer });
  }
  emit(msg: SaveWorkerOut) {
    this.onmessage?.({ data: msg } as MessageEvent<SaveWorkerOut>);
  }
}
