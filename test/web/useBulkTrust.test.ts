import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement, type ReactNode } from 'react';
import { initI18n } from '../../src/web/app/i18n/index.js';
import { queryKeys } from '../../src/web/app/queryKeys.js';
import { ToastProvider } from '../../src/web/components/Toast.js';
import { conflictActors } from '../../src/web/features/conflicts/conflictActors.js';
import { useBulkTrust } from '../../src/web/features/conflicts/useBulkTrust.js';
import { useUndoStack } from '../../src/web/features/marks/undo.js';
import type { MarksCache } from '../../src/web/features/marks/useMarks.js';
import { indexDataset, type Dataset } from '../../src/shared/dataset.js';
import { stubFetch } from './fetchStub.js';

const W = '11111111-1111-4111-8111-111111111111';
const dataset: Dataset = {
  version: 't', build: 1, bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 }, mapId: 'm', podRequirementsKnown: true,
  biomes: [{ id: 'g', name: { en: 'Grass', de: 'Gras' } }, { id: 'a', name: { en: 'Abyss', de: 'Abgrund' } }],
  items: [
    ['H1', 'hard_drive', 1, 1, 0, 0, 1], ['S2', 'somersloop', 1, 1, 0, 0, 2], ['S1', 'somersloop', 1, 1, 0, 0, 1],
    ['S3', 'somersloop', 1, 1, 0, 1, 1], ['B1', 'slug_blue', 1, 1, 0, 0, 1],
  ],
  aliases: {},
};
const index = indexDataset(dataset);
const mark = (mismatch: boolean) => ({ mismatch, updatedBy: 1, updatedAt: 0 });
const cache = (entries: [string, boolean][], pending: [string, boolean][] = []): MarksCache => ({
  rev: 1, baseRev: 1, revs: new Map(), pending: new Map(pending), marks: new Map(entries.map(([a, m]) => [a, mark(m)])),
});

describe('conflictActors', () => {
  it('lists mismatched, indexed, non-pending actors by type order, then biome and number', () => {
    const c = cache([['H1', true], ['S2', true], ['S1', true], ['S3', true], ['B1', true], ['X', true], ['P', true], ['OK', false]], [['P', true]]);
    expect(conflictActors(c, index)).toEqual(['B1', 'S3', 'S1', 'S2', 'H1']);
  });
  it('skips actors with a pending write', () => {
    expect(conflictActors(cache([['S1', true], ['S2', true]], [['S1', false]]), index)).toEqual(['S2']);
  });
});

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(queryKeys.marks(W), cache([['S1', true], ['S2', true], ['S3', true]]));
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, createElement(ToastProvider, null, children));
  return { queryClient, wrapper };
}

describe('useBulkTrust', () => {
  beforeAll(() => { initI18n(['en']); });
  beforeEach(() => useUndoStack.getState().clear());
  afterEach(() => vi.unstubAllGlobals());

  it('trustSave posts collected:false with onlyIfMismatch, records previous rows and toasts', async () => {
    const previous = [['S1', true, 1], ['S2', true, 1], ['S3', true, 1]];
    const { calls } = stubFetch({ [`POST /api/worlds/${W}/marks/bulk`]: { body: { rev: 5, previous } } });
    const { wrapper } = setup();
    const { result } = renderHook(() => useBulkTrust(W), { wrapper });
    await act(() => result.current.trustSave(['S1', 'S2', 'S3']));
    expect(calls[0]).toEqual({ method: 'POST', path: `/api/worlds/${W}/marks/bulk`, body: { actors: ['S1', 'S2', 'S3'], collected: false, onlyIfMismatch: true } });
    expect(useUndoStack.getState().stack).toEqual([{ kind: 'bulk', rows: previous }]);
  });

  it('trustCurrent posts collected:true', async () => {
    const { calls } = stubFetch({ [`POST /api/worlds/${W}/marks/bulk`]: { body: { rev: 5, previous: [['S1', true, 1]] } } });
    const { wrapper } = setup();
    const { result } = renderHook(() => useBulkTrust(W), { wrapper });
    await act(() => result.current.trustCurrent(['S1']));
    expect(calls[0]?.body).toEqual({ actors: ['S1'], collected: true, onlyIfMismatch: true });
  });

  it('does not push an undo entry when nothing changed', async () => {
    stubFetch({ [`POST /api/worlds/${W}/marks/bulk`]: { body: { rev: 5, previous: [] } } });
    const { wrapper } = setup();
    const { result } = renderHook(() => useBulkTrust(W), { wrapper });
    await act(() => result.current.trustSave(['S1']));
    expect(useUndoStack.getState().stack).toEqual([]);
  });

  it('shows the toast and its Undo restores the previous rows and removes the entry', async () => {
    const previous = [['S1', true, 1], ['S2', true, 1], ['S3', true, 1]];
    const { calls } = stubFetch({
      [`POST /api/worlds/${W}/marks/bulk`]: { body: { rev: 5, previous } },
      [`POST /api/worlds/${W}/marks/restore`]: { body: { rev: 6 } },
    });
    const { wrapper } = setup();
    const { result } = renderHook(() => useBulkTrust(W), { wrapper });
    await act(() => result.current.trustSave(['S1', 'S2', 'S3']));
    expect(await screen.findByText('3 items unchecked')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(calls.at(-1)).toEqual({ method: 'POST', path: `/api/worlds/${W}/marks/restore`, body: { rows: previous } }));
    expect(useUndoStack.getState().stack).toEqual([]);
  });

  it('toasts "kept checked" for trustCurrent', async () => {
    stubFetch({ [`POST /api/worlds/${W}/marks/bulk`]: { body: { rev: 5, previous: [['S1', true, 1], ['S2', true, 1]] } } });
    const { wrapper } = setup();
    const { result } = renderHook(() => useBulkTrust(W), { wrapper });
    await act(() => result.current.trustCurrent(['S1', 'S2']));
    expect(await screen.findByText('2 items kept checked')).toBeInTheDocument();
  });

  it('toasts a save error with Retry', async () => {
    stubFetch({ [`POST /api/worlds/${W}/marks/bulk`]: { status: 500, body: { error: 'internal', message: 'x' } } });
    const { wrapper } = setup();
    const { result } = renderHook(() => useBulkTrust(W), { wrapper });
    await act(() => result.current.trustSave(['S1']));
    expect(await screen.findByText("Couldn't save. Check your connection.")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(useUndoStack.getState().stack).toEqual([]);
  });
});
