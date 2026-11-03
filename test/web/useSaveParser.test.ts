import { act, renderHook, waitFor } from '@testing-library/react';
import { useSaveParser } from '../../src/web/features/import/useSaveParser.js';
import { FakeWorker } from './fakeWorker.js';

const DATASET_URL = 'http://localhost/data/test/collectibles.min.json';
const file = () => new File([new Uint8Array([1, 2, 3, 4])], 'Alpha_021126-222410.sav');

async function started() {
  const hook = renderHook(() => useSaveParser(DATASET_URL));
  act(() => { hook.result.current.start(file()); });
  await waitFor(() => expect(FakeWorker.instances[0]?.posted).toHaveLength(1));
  return { hook, worker: FakeWorker.instances[0]! };
}

describe('useSaveParser', () => {
  beforeEach(() => {
    FakeWorker.instances = [];
    vi.stubGlobal('Worker', FakeWorker);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('sends the file as a transferred buffer with the dataset url to a module worker', async () => {
    const { hook, worker } = await started();
    expect(worker.options).toEqual({ type: 'module' });
    const { msg, transfer } = worker.posted[0]!;
    expect(msg.type).toBe('parse');
    expect(msg.datasetUrl).toBe(DATASET_URL);
    expect(msg.buffer.byteLength).toBe(4);
    expect(transfer).toEqual([msg.buffer]);
    expect(hook.result.current.state.status).toBe('running');
  });

  it('updates stage and percent from progress messages', async () => {
    const { hook, worker } = await started();
    act(() => worker.emit({ type: 'progress', stage: 'parsing', percent: 42 }));
    expect(hook.result.current.state).toMatchObject({ status: 'running', stage: 'parsing', percent: 42 });
  });

  it('stores the result when the worker is done', async () => {
    const { hook, worker } = await started();
    const result = { meta: { sessionName: 'Alpha', saveTime: 1, build: 2 }, collected: ['A'], openedNotLooted: [], recognised: 1 };
    act(() => worker.emit({ type: 'done', result }));
    expect(hook.result.current.state).toEqual({ status: 'done', result });
    expect(worker.terminate).toHaveBeenCalled(); // a finished worker is not kept alive
  });

  it('cancel terminates the worker and returns to idle', async () => {
    const { hook, worker } = await started();
    act(() => hook.result.current.cancel());
    expect(worker.terminate).toHaveBeenCalled();
    expect(hook.result.current.state.status).toBe('idle');
    // A message the dead worker still delivered changes nothing.
    act(() => worker.emit({ type: 'progress', stage: 'parsing', percent: 50 }));
    expect(hook.result.current.state.status).toBe('idle');
  });

  it('a not_a_save error sets the error state (Review Focus 5)', async () => {
    const { hook, worker } = await started();
    act(() => worker.emit({ type: 'error', code: 'not_a_save', message: 'nope' }));
    expect(hook.result.current.state).toEqual({ status: 'error', error: 'not_a_save' });
    expect(worker.terminate).toHaveBeenCalled();
  });

  it('a crashed worker counts as failed', async () => {
    const { hook, worker } = await started();
    act(() => worker.onerror?.({ message: 'boom' } as ErrorEvent));
    expect(hook.result.current.state).toEqual({ status: 'error', error: 'failed' });
  });

  it('a second start terminates the first worker and ignores its late answers', async () => {
    const { hook, worker: first } = await started();
    act(() => { hook.result.current.start(file()); });
    await waitFor(() => expect(FakeWorker.instances[1]?.posted).toHaveLength(1));
    expect(first.terminate).toHaveBeenCalled();
    const result = { meta: { sessionName: 'Old', saveTime: 1, build: 2 }, collected: ['A'], openedNotLooted: [], recognised: 1 };
    act(() => first.emit({ type: 'done', result }));
    expect(hook.result.current.state.status).toBe('running');
    act(() => FakeWorker.instances[1]!.emit({ type: 'progress', stage: 'parsing', percent: 30 }));
    expect(hook.result.current.state).toMatchObject({ status: 'running', percent: 30 });
  });

  it('rejects a file over 256 MB as not a save without reading it', () => {
    const big = file();
    Object.defineProperty(big, 'size', { value: 256 * 2 ** 20 + 1 });
    const read = vi.spyOn(big, 'arrayBuffer');
    const hook = renderHook(() => useSaveParser(DATASET_URL));
    act(() => { hook.result.current.start(big); });
    expect(hook.result.current.state).toEqual({ status: 'error', error: 'not_a_save' });
    expect(read).not.toHaveBeenCalled();
    expect(FakeWorker.instances).toHaveLength(0);
  });

  it('terminates the worker on unmount', async () => {
    const { hook, worker } = await started();
    hook.unmount();
    expect(worker.terminate).toHaveBeenCalled();
  });
});
