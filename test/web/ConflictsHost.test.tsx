import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import type { MeDto, WorldDto } from '../../src/shared/api.js';
import { indexDataset, type Dataset } from '../../src/shared/dataset.js';
import type { WorldCtx } from '../../src/web/app/feature.js';
import { initI18n } from '../../src/web/app/i18n/index.js';
import { queryKeys } from '../../src/web/app/queryKeys.js';
import { useUiStore } from '../../src/web/app/store.js';
import { ToastProvider, useToast } from '../../src/web/components/Toast.js';
import { ConflictsHost, ConflictsPanel } from '../../src/web/features/conflicts/ConflictsPanel.js';
import { useConflictReview } from '../../src/web/features/conflicts/ConflictStepper.js';
import { useImportBanner } from '../../src/web/features/import/ImportBanner.js';
import type { MarksCache } from '../../src/web/features/marks/useMarks.js';

const W = '11111111-1111-4111-8111-111111111111';
const dataset: Dataset = {
  version: 't', build: 1, bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 }, mapId: 'm', podRequirementsKnown: true,
  biomes: [{ id: 'g', name: { en: 'Grass', de: 'Gras' } }],
  items: [['S1', 'somersloop', 1, 1, 0, 0, 1], ['S2', 'somersloop', 1, 1, 0, 0, 2]],
  aliases: {},
};
const cache = (actors: string[]): MarksCache => ({
  rev: 1, baseRev: 1, revs: new Map(), pending: new Map(),
  marks: new Map(actors.map(a => [a, { mismatch: true, updatedBy: 1, updatedAt: 0 }])),
});

function Mount({ client }: { client: QueryClient }) {
  const toast = useToast();
  const ctx = { worldId: W, world: {} as WorldDto, me: {} as MeDto, index: indexDataset(dataset), queryClient: client, navigate: () => {}, toast } satisfies WorldCtx;
  return <><ConflictsHost ctx={ctx} /><ConflictsPanel worldId={W} /></>;
}

function setup(actors: string[]) {
  initI18n(['en']);
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  client.setQueryData(queryKeys.me(), { id: 1, displayName: 'A', avatarUrl: null, email: null, datasetVersion: 't' } satisfies MeDto);
  client.setQueryData(queryKeys.dataset('t'), indexDataset(dataset));
  client.setQueryData(queryKeys.marks(W), cache(actors));
  const view = render(<QueryClientProvider client={client}><ToastProvider><Mount client={client} /></ToastProvider></QueryClientProvider>);
  return { client, view };
}

describe('conflicts host and panel', () => {
  beforeEach(() => useUiStore.getState().enterWorld(W));
  afterEach(() => { act(() => useConflictReview.getState().close()); });

  it('the import banner opens the stepper on the first conflict', () => {
    setup(['S2', 'S1']);
    expect(screen.getByText('⚠ 2 conflicts')).toBeInTheDocument();
    act(() => useImportBanner.getState().onReview?.());
    expect(screen.getByText('Conflict 1 of 2')).toBeInTheDocument();
    expect(useUiStore.getState().selectedActor).toBe('S1');
  });

  it('the Show only conflicts checkbox sets onlyConflicts', () => {
    setup(['S1']);
    act(() => screen.getByRole('checkbox', { name: 'Show only conflicts' }).click());
    expect(useUiStore.getState().onlyConflicts).toBe(true);
  });

  it('switches "Show only conflicts" off once no conflict is left, so the items show again', async () => {
    const { client } = setup(['S1']);
    act(() => screen.getByRole('checkbox', { name: 'Show only conflicts' }).click());
    expect(useUiStore.getState().onlyConflicts).toBe(true);
    act(() => { client.setQueryData(queryKeys.marks(W), cache([])); });
    await waitFor(() => expect(useUiStore.getState().onlyConflicts).toBe(false));
    expect(screen.queryByRole('checkbox', { name: 'Show only conflicts' })).toBeNull();
  });

  it('a remembered "only conflicts" filter is dropped when the world has no conflicts', () => {
    useUiStore.getState().setOnlyConflicts(true);
    setup([]);
    expect(useUiStore.getState().onlyConflicts).toBe(false);
  });

  it('ends the review with a toast when the last conflict is resolved', async () => {
    const { client } = setup(['S1']);
    act(() => useImportBanner.getState().onReview?.());
    act(() => { client.setQueryData(queryKeys.marks(W), cache([])); });
    expect(await screen.findByText('All conflicts resolved')).toBeInTheDocument();
    expect(useConflictReview.getState().isOpen).toBe(false);
  });
});
