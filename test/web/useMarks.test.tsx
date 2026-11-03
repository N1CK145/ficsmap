import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import type { MeDto } from '../../src/shared/api.js';
import { initI18n } from '../../src/web/app/i18n/index.js';
import { queryKeys } from '../../src/web/app/queryKeys.js';
import { ToastProvider } from '../../src/web/components/Toast.js';
import { applyMarkEvent } from '../../src/web/features/live/applyEvents.js';
import { useUndoStack, type UndoEntry } from '../../src/web/features/marks/undo.js';
import { isCollected, useMarks, useSetMark, type MarksCache } from '../../src/web/features/marks/useMarks.js';
import { stubFetch, type StubReply } from './fetchStub.js';

const W = '11111111-1111-4111-8111-111111111111';
const ME: MeDto = { id: 1, displayName: 'Nick', avatarUrl: null, email: null, datasetVersion: 'v1' };

function setup(initial?: MarksCache) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(queryKeys.me(), ME);
  if (initial) queryClient.setQueryData(queryKeys.marks(W), initial);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}><ToastProvider>{children}</ToastProvider></QueryClientProvider>
  );
  const marks = () => queryClient.getQueryData<MarksCache>(queryKeys.marks(W))!;
  return { queryClient, wrapper, marks };
}

const empty = (rev = 10): MarksCache => ({ rev, baseRev: rev, marks: new Map(), revs: new Map(), pending: new Map() });

function deferred() {
  let resolve!: (r: StubReply) => void;
  const promise = new Promise<StubReply>(r => { resolve = r; });
  return { promise, resolve };
}

describe('marks cache', () => {
  beforeAll(() => { initI18n(['en']); });
  beforeEach(() => useUndoStack.getState().clear());
  afterEach(() => vi.unstubAllGlobals());

  it('useMarks loads the tuples into a map', async () => {
    stubFetch({ [`GET /api/worlds/${W}/marks`]: { body: { rev: 7, marks: [['A', 1, 2, 300], ['B', 0, null, 400]] } } });
    const { wrapper } = setup();
    const { result } = renderHook(() => useMarks(W), { wrapper });
    await waitFor(() => expect(result.current).toBeDefined());
    expect(result.current!.rev).toBe(7);
    expect(result.current!.marks.get('A')).toEqual({ mismatch: true, updatedBy: 2, updatedAt: 300 });
    expect(result.current!.marks.get('B')).toEqual({ mismatch: false, updatedBy: null, updatedAt: 400 });
    expect(result.current!.pending.size).toBe(0);
  });

  it('isCollected lets a pending value override the stored mark', () => {
    const c: MarksCache = {
      ...empty(1), marks: new Map([['A', { mismatch: false, updatedBy: 1, updatedAt: 1 }]]), pending: new Map([['A', false], ['B', true]]),
    };
    expect(isCollected(c, 'A')).toBe(false);
    expect(isCollected(c, 'B')).toBe(true);
    expect(isCollected(c, 'C')).toBe(false);
  });

  it('useSetMark is optimistic, then stores the confirmed mark and rev and records undo', async () => {
    const reply = deferred();
    const { calls } = stubFetch({ [`PUT /api/worlds/${W}/marks/A`]: () => reply.promise });
    const { wrapper, marks } = setup(empty(10));
    const { result } = renderHook(() => useSetMark(W), { wrapper });

    let done!: Promise<UndoEntry | null>;
    act(() => { done = result.current('A', true); });
    expect(marks().pending.get('A')).toBe(true);
    expect(isCollected(marks(), 'A')).toBe(true);

    await act(async () => { reply.resolve({ body: { rev: 15 } }); await done; });
    await expect(done).resolves.toBe(useUndoStack.getState().stack.at(-1));
    expect(calls).toContainEqual({ method: 'PUT', path: `/api/worlds/${W}/marks/A`, body: { collected: true } });
    expect(marks().pending.size).toBe(0);
    expect(marks().revs.get('A')).toBe(15);
    expect(marks().rev).toBe(10); // the stream rev only moves with events
    expect(marks().marks.get('A')).toMatchObject({ mismatch: false, updatedBy: ME.id });
    expect(useUndoStack.getState().stack).toEqual([{ kind: 'single', actor: 'A', prev: false, prevMismatch: false }]);
  });

  it('unchecking deletes the mark and records the previous mismatch', async () => {
    stubFetch({ [`PUT /api/worlds/${W}/marks/A`]: { body: { rev: 11 } } });
    const { wrapper, marks } = setup({ ...empty(10), marks: new Map([['A', { mismatch: true, updatedBy: 2, updatedAt: 5 }]]) });
    const { result } = renderHook(() => useSetMark(W), { wrapper });
    await act(() => result.current('A', false));
    expect(marks().marks.has('A')).toBe(false);
    expect(useUndoStack.getState().stack).toEqual([{ kind: 'single', actor: 'A', prev: true, prevMismatch: true }]);
  });

  it('recordUndo: false leaves the undo stack alone', async () => {
    stubFetch({ [`PUT /api/worlds/${W}/marks/A`]: { body: { rev: 11 } } });
    const { wrapper } = setup(empty());
    const { result } = renderHook(() => useSetMark(W), { wrapper });
    await act(() => result.current('A', true, { recordUndo: false }));
    expect(useUndoStack.getState().stack).toEqual([]);
  });

  it('reverts on error and offers Retry in a toast', async () => {
    let fail = true;
    const { calls } = stubFetch({
      [`PUT /api/worlds/${W}/marks/A`]: () => (fail ? { status: 500, body: { error: 'internal', message: 'x' } } : { body: { rev: 12 } }),
    });
    const { wrapper, marks } = setup(empty(10));
    const { result } = renderHook(() => useSetMark(W), { wrapper });
    let saved: UndoEntry | null | undefined;
    await act(async () => { saved = await result.current('A', true); });
    expect(saved).toBeNull();
    expect(marks().pending.size).toBe(0);
    expect(marks().marks.has('A')).toBe(false);
    expect(useUndoStack.getState().stack).toEqual([]);
    expect(screen.getByText("Couldn't save. Check your connection.")).toBeInTheDocument();

    fail = false;
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(marks().marks.has('A')).toBe(true));
    expect(calls.filter(c => c.method === 'PUT')).toHaveLength(2);
  });

  it('a newer remote event for a pending actor wins over the own older write', async () => {
    const reply = deferred();
    stubFetch({ [`PUT /api/worlds/${W}/marks/A`]: () => reply.promise });
    const { wrapper, marks, queryClient } = setup(empty(10));
    const { result } = renderHook(() => useSetMark(W), { wrapper });

    let done!: Promise<UndoEntry | null>;
    act(() => { done = result.current('A', true); });
    // Another member unchecks A after the server stored our write (our PUT got rev 11, theirs 12).
    act(() => {
      queryClient.setQueryData<MarksCache>(queryKeys.marks(W), c =>
        c && applyMarkEvent(c, { type: 'mark', actor: 'A', collected: false, mismatch: false, by: 2, at: 60, rev: 12 }));
    });
    expect(isCollected(marks(), 'A')).toBe(true); // still pending

    await act(async () => { reply.resolve({ body: { rev: 11 } }); await done; });
    expect(marks().pending.size).toBe(0);
    expect(isCollected(marks(), 'A')).toBe(false);
  });

  it('out-of-order answers to a double click end with the latest write', async () => {
    const replies = [deferred(), deferred()];
    let n = 0;
    stubFetch({ [`PUT /api/worlds/${W}/marks/A`]: () => replies[n++]!.promise });
    const { wrapper, marks } = setup(empty(10));
    const { result } = renderHook(() => useSetMark(W), { wrapper });

    let first!: Promise<UndoEntry | null>;
    let second!: Promise<UndoEntry | null>;
    act(() => { first = result.current('A', true); });
    act(() => { second = result.current('A', false); });
    await waitFor(() => expect(n).toBe(2));

    await act(async () => { replies[1]!.resolve({ body: { rev: 12 } }); await second; });
    expect(marks().pending.size).toBe(0);
    expect(isCollected(marks(), 'A')).toBe(false);
    await expect(second).resolves.toMatchObject({ kind: 'single', actor: 'A', prev: true });

    await act(async () => { replies[0]!.resolve({ body: { rev: 11 } }); await first; });
    expect(isCollected(marks(), 'A')).toBe(false);
    await expect(first).resolves.toBeNull(); // overtaken: its feedback belongs to the newer write
  });

  it('an older answer keeps the pending value of a newer write in flight', async () => {
    const replies = [deferred(), deferred()];
    let n = 0;
    stubFetch({ [`PUT /api/worlds/${W}/marks/A`]: () => replies[n++]!.promise });
    const { wrapper, marks } = setup(empty(10));
    const { result } = renderHook(() => useSetMark(W), { wrapper });

    let first!: Promise<UndoEntry | null>;
    act(() => { first = result.current('A', true); });
    act(() => { void result.current('A', false); });
    await waitFor(() => expect(n).toBe(2));
    await act(async () => { replies[0]!.resolve({ body: { rev: 11 } }); await first; });
    expect(marks().pending.get('A')).toBe(false);
    expect(isCollected(marks(), 'A')).toBe(false);
    await act(async () => { replies[1]!.resolve({ body: { rev: 12 } }); });
  });

  it('a refetch keeps changes newer than its snapshot', async () => {
    stubFetch({ [`GET /api/worlds/${W}/marks`]: { body: { rev: 15, marks: [['B', 0, 4, 130]] } } });
    const current = applyMarkEvent(empty(15), { type: 'mark', actor: 'C', collected: true, mismatch: false, by: 2, at: 60, rev: 16 });
    const { wrapper, queryClient } = setup(current);
    const { result } = renderHook(() => useMarks(W), { wrapper });
    await act(() => queryClient.refetchQueries({ queryKey: queryKeys.marks(W) }));
    await waitFor(() => expect(result.current!.marks.has('B')).toBe(true));
    expect(result.current!.marks.has('C')).toBe(true);
    expect(result.current!.rev).toBe(16);
  });
});
