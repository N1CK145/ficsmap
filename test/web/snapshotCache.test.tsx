import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { queryKeys } from '../../src/web/app/queryKeys.js';
import { deltaBase, evictSnapshots, fetchSnapshot, SNAPSHOT_KEEP_MS, snapshotQuery } from '../../src/web/features/factory/api.js';
import { diffSnapshots } from '../../src/shared/factory/delta.js';
import { stubFetch } from './fetchStub.js';
import { prefetchIndices } from '../../src/web/features/factory/map/mapData.js';
import { useSnapshotRetention } from '../../src/web/features/factory/timeline.js';
import { useFactoryView } from '../../src/web/features/factory/view.js';
import { makeSummary } from './factoryFixtures.js';

const W = 'w1';

describe('snapshot prefetch', () => {
  it('loads the next four in the direction of travel and the one behind, nearest first', () => {
    expect(prefetchIndices(0, 10, 1)).toEqual([1, 2, 3, 4]);
    expect(prefetchIndices(5, 10, 1)).toEqual([6, 4, 7, 8, 9]);
    expect(prefetchIndices(5, 10, -1)).toEqual([4, 6, 3, 2, 1]);
    expect(prefetchIndices(8, 10, 1)).toEqual([9, 7]);
    expect(prefetchIndices(9, 10, 1)).toEqual([8]);
    expect(prefetchIndices(-1, 10, 1)).toEqual([]);
  });
});

describe('snapshot cache retention', () => {
  let qc: QueryClient;
  const ids = () => qc.getQueryCache().findAll({ queryKey: ['snapshot', W] }).map(q => q.queryKey[2]).sort();
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;

  beforeEach(() => {
    vi.useFakeTimers();
    useFactoryView.getState().reset();
    qc = new QueryClient();
    // Saves 1..6 (6 the newest), all downloaded.
    qc.setQueryData(queryKeys.snapshots(W), [6, 5, 4, 3, 2, 1].map(i => makeSummary(i, i * 1000, 'S')));
    for (let i = 1; i <= 6; i++) qc.setQueryData(queryKeys.snapshot(W, i), { id: i });
  });
  afterEach(() => {
    useFactoryView.getState().reset();
    vi.useRealTimers();
  });

  it('drops only what nothing shows, never the kept ids', () => {
    evictSnapshots(qc, W, new Set([2, 3]));
    expect(ids()).toEqual([2, 3]);
  });

  it('keeps everything while the timeline is in use and for 15 s after, then keeps the shown save and its neighbours', () => {
    const { unmount } = renderHook(() => useSnapshotRetention(W), { wrapper });
    const v = useFactoryView.getState();
    v.hold('play', true);
    v.select(2, { input: true });
    vi.advanceTimersByTime(SNAPSHOT_KEEP_MS * 3);
    expect(ids()).toEqual([1, 2, 3, 4, 5, 6]);
    v.hold('play', false);
    vi.advanceTimersByTime(SNAPSHOT_KEEP_MS - 1000);
    // Another step restarts the time.
    v.select(3, { input: true });
    vi.advanceTimersByTime(SNAPSHOT_KEEP_MS - 1);
    expect(ids()).toEqual([1, 2, 3, 4, 5, 6]);
    vi.advanceTimersByTime(1);
    expect(ids()).toEqual([2, 3, 4]);
    // Leaving the world drops the rest once the time is up.
    unmount();
    vi.advanceTimersByTime(SNAPSHOT_KEEP_MS);
    expect(ids()).toEqual([]);
  });
});

describe('snapshot download as a difference', () => {
  const W2 = 'w2';
  const building = (id: string, x = 0) => ({ id, cls: 'Build_SmelterMk1_C', x, y: 0, z: 0, yaw: 0 });
  const snap = (saveTime: number, buildings: object[]) => ({ v: 1, meta: { sessionName: 'S', saveTime }, buildings });
  const S1 = snap(1000, [building('a'), building('b')]);
  const S2 = snap(2000, [building('a'), building('b', 5)]);
  const S3 = snap(3000, [building('a'), building('b', 5), building('c')]);
  const list = [makeSummary(3, 3000, 'S'), makeSummary(2, 2000, 'S'), makeSummary(1, 1000, 'S')];
  const base = `/api/worlds/${W2}/snapshots`;
  afterEach(() => vi.unstubAllGlobals());

  it('builds on the nearest snapshot the browser holds and shares what did not change', async () => {
    const qc = new QueryClient();
    qc.setQueryData(queryKeys.snapshots(W2), list);
    const held = JSON.parse(JSON.stringify(S1));
    qc.setQueryData(queryKeys.snapshot(W2, 1), held);
    expect(deltaBase(qc, W2, 3)).toBe(1);
    const stub = stubFetch({ [`GET ${base}/2/delta/1`]: { body: diffSnapshots(S1, S2, 1, 2) } });
    const s2 = await qc.fetchQuery(snapshotQuery(W2, 2));
    expect(s2).toEqual(S2);
    expect(s2.buildings[0]).toBe(held.buildings[0]);
    expect(stub.calls.map(c => c.path)).toEqual([`${base}/2/delta/1`]);
    // Now 2 is nearer to 3 than 1.
    expect(deltaBase(qc, W2, 3)).toBe(2);
  });

  it('chains on a download under way and falls back to the whole snapshot when the delta fails', async () => {
    const qc = new QueryClient();
    qc.setQueryData(queryKeys.snapshots(W2), list);
    qc.setQueryData(queryKeys.snapshot(W2, 1), JSON.parse(JSON.stringify(S1)));
    const stub = stubFetch({
      [`GET ${base}/2/delta/1`]: { body: diffSnapshots(S1, S2, 1, 2) },
      // 3 builds on 2 (still downloading); its delta is missing on this server, so the whole 3 comes.
      [`GET ${base}/3`]: { body: S3 },
    });
    const [s2, s3] = await Promise.all([qc.fetchQuery(snapshotQuery(W2, 2)), qc.fetchQuery(snapshotQuery(W2, 3))]);
    expect(s2).toEqual(S2);
    expect(s3).toEqual(S3);
    expect(stub.calls.map(c => c.path)).toEqual([`${base}/2/delta/1`, `${base}/3/delta/2`, `${base}/3`]);
  });

  it('downloads whole without a snapshot to build on', async () => {
    const qc = new QueryClient();
    qc.setQueryData(queryKeys.snapshots(W2), list);
    const stub = stubFetch({ [`GET ${base}/2`]: { body: S2 } });
    expect(await fetchSnapshot(W2, 2, qc)).toEqual(S2);
    expect(stub.calls.map(c => c.path)).toEqual([`${base}/2`]);
  });
});
