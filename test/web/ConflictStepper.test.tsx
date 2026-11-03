import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { indexDataset, type Dataset } from '../../src/shared/dataset.js';
import type { MeDto, WorldDto } from '../../src/shared/api.js';
import { initI18n } from '../../src/web/app/i18n/index.js';
import { queryKeys } from '../../src/web/app/queryKeys.js';
import { useUiStore } from '../../src/web/app/store.js';
import { ToastProvider, useToast } from '../../src/web/components/Toast.js';
import { ConflictsHost } from '../../src/web/features/conflicts/ConflictsPanel.js';
import { ConflictStepper, useConflictReview } from '../../src/web/features/conflicts/ConflictStepper.js';
import type { WorldCtx } from '../../src/web/app/feature.js';
import type { MarksCache } from '../../src/web/features/marks/useMarks.js';
import { useUndoStack } from '../../src/web/features/marks/undo.js';
import { stubFetch } from './fetchStub.js';

const W = '11111111-1111-4111-8111-111111111111';
const dataset: Dataset = {
  version: 't', build: 1, bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 }, mapId: 'm', podRequirementsKnown: true,
  biomes: [{ id: 'g', name: { en: 'Grass', de: 'Gras' } }],
  items: [['S1', 'somersloop', 1, 1, 0, 0, 1], ['S2', 'somersloop', 1, 1, 0, 0, 2], ['S3', 'somersloop', 1, 1, 0, 0, 3]],
  aliases: {},
};
const cache = (actors: string[]): MarksCache => ({
  rev: 1, baseRev: 1, revs: new Map(), pending: new Map(),
  marks: new Map(actors.map(a => [a, { mismatch: true, updatedBy: 1, updatedAt: 0 }])),
});

/** The stepper together with the always-mounted host, as in the world layout. */
function Mount({ client }: { client: QueryClient }) {
  const toast = useToast();
  const ctx = { worldId: W, world: {} as WorldDto, me: {} as MeDto, index: indexDataset(dataset), queryClient: client, navigate: () => {}, toast } satisfies WorldCtx;
  return <><ConflictsHost ctx={ctx} /><ConflictStepper worldId={W} /></>;
}

function setup(lang = 'en') {
  initI18n([lang]);
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  const me: MeDto = { id: 1, displayName: 'Anna', avatarUrl: null, email: null, datasetVersion: 't' };
  client.setQueryData(queryKeys.me(), me);
  client.setQueryData(queryKeys.dataset('t'), indexDataset(dataset));
  client.setQueryData(queryKeys.marks(W), cache(['S1', 'S2', 'S3']));
  render(<QueryClientProvider client={client}><ToastProvider><Mount client={client} /></ToastProvider></QueryClientProvider>);
  return client;
}

describe('ConflictStepper', () => {
  beforeEach(() => {
    useUiStore.getState().enterWorld(W);
    useUndoStack.getState().clear();
    useConflictReview.getState().open(['S1', 'S2', 'S3']);
  });
  afterEach(() => { vi.unstubAllGlobals(); act(() => useConflictReview.getState().close()); });

  it('shows the position and selects the first conflict', () => {
    setup();
    expect(screen.getByText('Conflict 1 of 3')).toBeInTheDocument();
    expect(useUiStore.getState().selectedActor).toBe('S1');
  });

  it('Next selects the second actor, Prev goes back', async () => {
    setup();
    await userEvent.click(screen.getByRole('button', { name: 'Next ›' }));
    expect(screen.getByText('Conflict 2 of 3')).toBeInTheDocument();
    expect(useUiStore.getState().selectedActor).toBe('S2');
    await userEvent.click(screen.getByRole('button', { name: '‹ Prev' }));
    expect(useUiStore.getState().selectedActor).toBe('S1');
  });

  it('recounts after the current conflict is resolved', async () => {
    const client = setup();
    act(() => { client.setQueryData(queryKeys.marks(W), cache(['S2', 'S3'])); });
    expect(await screen.findByText('Conflict 1 of 2')).toBeInTheDocument();
  });

  it('Trust the save asks first, with the exact copy', async () => {
    const { calls } = stubFetch({});
    setup();
    await userEvent.click(screen.getByRole('button', { name: 'Trust the save' }));
    expect(screen.getByText(/Uncheck all 3 items\? They'll count as not collected again, as in the save\. You can undo this right after\./)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Uncheck 3 items' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(calls).toEqual([]);
  });

  it('Trust current data asks first, with the exact copy', async () => {
    setup();
    await userEvent.click(screen.getByRole('button', { name: 'Trust current data' }));
    expect(screen.getByText(/Keep all 3 items checked\? The save says they're still in the world\. Your checks stay and the warnings go away\./)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Keep checked' })).toBeInTheDocument();
  });

  it('confirming Trust the save posts the bulk call for all conflicts', async () => {
    const { calls } = stubFetch({ [`POST /api/worlds/${W}/marks/bulk`]: { body: { rev: 2, previous: [] } } });
    setup();
    await userEvent.click(screen.getByRole('button', { name: 'Trust the save' }));
    await userEvent.click(screen.getByRole('button', { name: 'Uncheck 3 items' }));
    expect(calls[0]?.body).toEqual({ actors: ['S1', 'S2', 'S3'], collected: false, onlyIfMismatch: true });
  });

  it('keeps the Undo toast after trusting the save from the stepper empties the list', async () => {
    stubFetch({ [`POST /api/worlds/${W}/marks/bulk`]: { body: { rev: 2, previous: [['S1', true, 1], ['S2', true, 1], ['S3', true, 1]] } } });
    const client = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Trust the save' }));
    await userEvent.click(screen.getByRole('button', { name: 'Uncheck 3 items' }));
    act(() => { client.setQueryData(queryKeys.marks(W), cache([])); });
    expect(await screen.findByText('3 items unchecked')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument();
    expect(screen.queryByText('All conflicts resolved')).toBeNull();
  });

  it('Done closes the stepper', async () => {
    setup();
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(useConflictReview.getState().isOpen).toBe(false);
  });
});

describe('ConflictStepper (German)', () => {
  beforeEach(() => { useUiStore.getState().enterWorld(W); useConflictReview.getState().open(['S1', 'S2', 'S3']); });
  afterEach(() => { act(() => useConflictReview.getState().close()); });

  it('uses the German confirmation copy', async () => {
    setup('de');
    expect(screen.getByText('Konflikt 1 von 3')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Dem Spielstand vertrauen' }));
    expect(screen.getByText(/Alle 3 Häkchen entfernen\? Sie gelten wieder als nicht gesammelt, wie im Spielstand\. Du kannst das direkt danach rückgängig machen\./)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '3 Häkchen entfernen' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Abbrechen' })).toBeInTheDocument();
  });
});
