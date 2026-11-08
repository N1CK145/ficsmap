import { QueryClient } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { MeDto, WorldDto } from '../../src/shared/api.js';
import { indexDataset } from '../../src/shared/dataset.js';
import type { WorldCtx } from '../../src/web/app/feature.js';
import { FeaturesProvider } from '../../src/web/app/FeaturesContext.js';
import { initI18n } from '../../src/web/app/i18n/index.js';
import { queryKeys } from '../../src/web/app/queryKeys.js';
import { useRemotePulse } from '../../src/web/features/live/pulse.js';
import { useLiveStatus, useWorldEvents } from '../../src/web/features/live/useWorldEvents.js';
import { FEATURES } from '../../src/web/features/index.js';
import type { MarksCache } from '../../src/web/features/marks/useMarks.js';
import { FakeEventSource } from './fakeEventSource.js';

const W = '11111111-1111-4111-8111-111111111111';
const ME: MeDto = { id: 1, displayName: 'Nick', avatarUrl: null, email: null, datasetVersion: 'v1' };
const WORLD: WorldDto = {
  id: W, name: 'Alpha', role: 'owner', rev: 10, datasetVersion: 'v1', owner: { id: 1, displayName: 'Nick' }, members: [], lastImport: null,
};

function makeCtx(): WorldCtx {
  const queryClient = new QueryClient();
  queryClient.setQueryData<MarksCache>(queryKeys.marks(W), { rev: 10, baseRev: 10, marks: new Map(), revs: new Map(), pending: new Map() });
  return {
    worldId: W, world: WORLD, me: ME, queryClient, navigate: vi.fn(), toast: { show: vi.fn() },
    index: indexDataset({ version: 'v1', build: 1, bounds: { minX: 0, maxX: 1, minY: 0, maxY: 1 }, mapId: 'm', podRequirementsKnown: false, biomes: [], items: [], aliases: {} }),
  };
}

const wrapper = ({ children }: { children: ReactNode }) => <FeaturesProvider features={FEATURES}>{children}</FeaturesProvider>;
const events = (ctx: WorldCtx) => renderHook(() => useWorldEvents(W, ctx), { wrapper });

const marksOf = (ctx: WorldCtx) => ctx.queryClient.getQueryData<MarksCache>(queryKeys.marks(W))!;

describe('useWorldEvents', () => {
  beforeAll(() => { initI18n(['en']); });
  beforeEach(() => {
    FakeEventSource.instances = [];
    vi.stubGlobal('EventSource', FakeEventSource);
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

  it('connects to the world stream and is live after open, refetching world, marks and routes (spec §9)', () => {
    const ctx = makeCtx();
    const invalidate = vi.spyOn(ctx.queryClient, 'invalidateQueries');
    const { result } = events(ctx);
    expect(FakeEventSource.last().url).toBe(`/api/worlds/${W}/events`);
    expect(result.current).toBe('connecting');
    act(() => FakeEventSource.last().open());
    expect(result.current).toBe('live');
    expect(useLiveStatus.getState().status).toBe('live');
    // Also on the first open: an event between the initial GET and the subscription would otherwise be lost.
    const keys = invalidate.mock.calls.map(([f]) => f?.queryKey);
    expect(keys).toEqual(expect.arrayContaining([queryKeys.world(W), queryKeys.marks(W), queryKeys.routes(W)]));
  });

  it('refetches world, marks and routes when the stream reopens (events may have been missed)', () => {
    const ctx = makeCtx();
    const invalidate = vi.spyOn(ctx.queryClient, 'invalidateQueries');
    events(ctx);
    const es = FakeEventSource.last();
    act(() => es.open());
    act(() => es.fail(FakeEventSource.CONNECTING)); // the browser reconnects the same EventSource itself
    invalidate.mockClear();
    act(() => es.open());
    const keys = invalidate.mock.calls.map(([f]) => f?.queryKey);
    expect(keys).toEqual(expect.arrayContaining([queryKeys.world(W), queryKeys.marks(W), queryKeys.routes(W)]));
  });

  it('applies a remote mark event and pulses the actor', () => {
    const ctx = makeCtx();
    events(ctx);
    act(() => FakeEventSource.last().emit({ type: 'mark', actor: 'A', collected: true, mismatch: false, by: 2, at: 50, rev: 11 }));
    expect(marksOf(ctx).marks.get('A')).toEqual({ mismatch: false, updatedBy: 2, updatedAt: 50 });
    expect(marksOf(ctx).rev).toBe(11);
    expect(useRemotePulse.getState().pulse.get('A')).toBeGreaterThan(Date.now());
  });

  it('does not pulse for its own echo', () => {
    const ctx = makeCtx();
    events(ctx);
    act(() => FakeEventSource.last().emit({ type: 'mark', actor: 'B', collected: true, mismatch: false, by: ME.id, at: 50, rev: 11 }));
    expect(marksOf(ctx).marks.has('B')).toBe(true);
    expect(useRemotePulse.getState().pulse.has('B')).toBe(false);
  });

  it('leaves the world when it was deleted', () => {
    const ctx = makeCtx();
    const invalidate = vi.spyOn(ctx.queryClient, 'invalidateQueries');
    events(ctx);
    act(() => FakeEventSource.last().emit({ type: 'deleted' }));
    expect(ctx.navigate).toHaveBeenCalledWith('/?list=1');
    expect(ctx.toast.show).toHaveBeenCalledWith({ message: 'This world was deleted' });
    expect(invalidate.mock.calls.map(([f]) => f?.queryKey)).toContainEqual(queryKeys.worlds());
  });

  it('shows the removed screen only when the own user was removed', () => {
    const ctx = makeCtx();
    events(ctx);
    act(() => FakeEventSource.last().emit({ type: 'removed', userId: 99 }));
    expect(ctx.navigate).not.toHaveBeenCalled();
    act(() => FakeEventSource.last().emit({ type: 'removed', userId: ME.id }));
    expect(ctx.navigate).toHaveBeenCalledWith('/removed');
  });

  it('is offline on error and reconnects itself when the browser gave up', () => {
    vi.useFakeTimers();
    const ctx = makeCtx();
    const { result } = events(ctx);
    const first = FakeEventSource.last();
    act(() => first.fail(FakeEventSource.CONNECTING));
    expect(result.current).toBe('offline');
    expect(FakeEventSource.instances).toHaveLength(1); // the browser retries on its own

    const invalidate = vi.spyOn(ctx.queryClient, 'invalidateQueries');
    act(() => first.fail(FakeEventSource.CLOSED));
    // A closed stream may mean the session ended (401) or the world is gone (404): let those surface.
    expect(invalidate.mock.calls.map(([f]) => f?.queryKey)).toEqual(expect.arrayContaining([queryKeys.world(W), queryKeys.me()]));
    act(() => { vi.advanceTimersByTime(30_000); });
    expect(FakeEventSource.instances).toHaveLength(2);
    expect(result.current).toBe('connecting');
    act(() => FakeEventSource.last().open());
    expect(result.current).toBe('live');
  });

  it('closes the stream on unmount', () => {
    const ctx = makeCtx();
    const { unmount } = events(ctx);
    unmount();
    expect(FakeEventSource.last().closed).toBe(true);
  });
});
