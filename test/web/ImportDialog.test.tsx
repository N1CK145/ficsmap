import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ImportResultDto, MeDto, WorldDto } from '../../src/shared/api.js';
import { indexDataset, type Dataset } from '../../src/shared/dataset.js';
import type { ExtractResult } from '../../src/shared/extract.js';
import type { WorldCtx } from '../../src/web/app/feature.js';
import { initI18n } from '../../src/web/app/i18n/index.js';
import { queryKeys } from '../../src/web/app/queryKeys.js';
import { ToastProvider } from '../../src/web/components/Toast.js';
import { ImportButton, ImportDialog, importRequest, useImportDialog } from '../../src/web/features/import/ImportDialog.js';
import { IMPORT_BANNER_MS, ImportBanner, useImportBanner } from '../../src/web/features/import/ImportBanner.js';
import { SAVE_FOLDER_HINT } from '../../src/web/features/import/pickSave.js';
import type { MarksCache } from '../../src/web/features/marks/useMarks.js';
import { FakeWorker } from './fakeWorker.js';
import { stubFetch } from './fetchStub.js';

const W = '6f1c2b0e-8a43-4f5e-9d1b-2c3d4e5f6a7b';
const ME: MeDto = { id: 1, displayName: 'Nick', avatarUrl: null, email: null, datasetVersion: 'test' };
const WORLD: WorldDto = {
  id: W, name: 'Alpha', isOwner: true, rev: 1, datasetVersion: 'test', owner: { id: 1, displayName: 'Nick' }, members: [], lastImport: null,
};
const DATASET: Dataset = {
  version: 'test', build: 500, bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 }, mapId: 'm', podRequirementsKnown: true, biomes: [],
  items: [['A', 'somersloop', 0, 0, 0, 0, 1], ['B', 'hard_drive', 0, 0, 0, 0, 1], ['C', 'hard_drive', 0, 0, 0, 0, 2]],
  aliases: {},
};

function marks(checked: string[]): MarksCache {
  return {
    rev: 1, baseRev: 1, revs: new Map(), pending: new Map(),
    marks: new Map(checked.map(a => [a, { mismatch: false, updatedBy: 1, updatedAt: 0 }])),
  };
}

function renderDialog(checked: string[] = []) {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  client.setQueryData(queryKeys.me(), ME);
  client.setQueryData(queryKeys.marks(W), marks(checked));
  const onClose = vi.fn();
  const ctx: WorldCtx = {
    worldId: W, world: WORLD, me: ME, index: indexDataset(DATASET), queryClient: client, navigate: () => {}, toast: { show: () => {} },
  };
  render(
    <QueryClientProvider client={client}>
      <ToastProvider><ImportDialog ctx={ctx} open onClose={onClose} /></ToastProvider>
    </QueryClientProvider>,
  );
  return { onClose, client };
}

function result(collected: string[], build = 500): ExtractResult {
  return { meta: { sessionName: 'Home Base', saveTime: Date.UTC(2026, 10, 2, 22, 24), build }, collected, openedNotLooted: [], recognised: collected.length };
}

/** Picks a file and lets the fake worker answer with `out`. */
async function parse(user: ReturnType<typeof userEvent.setup>, answer: Parameters<FakeWorker['emit']>[0]) {
  await user.upload(screen.getByLabelText('Choose a save file'), new File([new Uint8Array([1])], 'Home Base_021126-222410.sav'));
  await waitFor(() => expect(FakeWorker.instances[0]?.posted).toHaveLength(1));
  act(() => FakeWorker.instances[0]!.emit(answer));
}

describe('ImportDialog', () => {
  beforeAll(() => { initI18n(['en']); });
  beforeEach(() => {
    FakeWorker.instances = [];
    vi.stubGlobal('Worker', FakeWorker);
    useImportBanner.getState().dismiss();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('without the folder picker shows a file input and [Copy path], which copies the save folder', async () => {
    const user = userEvent.setup();
    renderDialog();
    expect(screen.queryByRole('button', { name: 'Choose save folder' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Choose a save file')).toHaveAttribute('type', 'file');
    await user.click(screen.getByRole('button', { name: 'Copy path' }));
    expect(await navigator.clipboard.readText()).toBe(SAVE_FOLDER_HINT);
    expect(await screen.findByText('Path copied — paste it into the file dialog')).toBeInTheDocument();
  });

  it('shows the preview: meta, counts per type, will be checked and conflicts, newer build warning', async () => {
    const user = userEvent.setup();
    renderDialog(['A']);
    await parse(user, { type: 'done', result: result(['B', 'C'], 501) });
    expect(screen.getByText(/^Home Base · .+ · build 501$/)).toBeInTheDocument();
    expect(screen.getByText('2 items recognised')).toBeInTheDocument();
    expect(screen.getByText('Hard Drives')).toBeInTheDocument();
    expect(screen.getByText('+2 will be checked · 1 conflict')).toBeInTheDocument();
    expect(screen.getByText('This save is from a newer game build (501) than the map data (500). Some items may be missing.')).toBeInTheDocument();
  });

  it('shows — for a save time that is not a finite number', async () => {
    const user = userEvent.setup();
    renderDialog();
    const r = result(['B']);
    await parse(user, { type: 'done', result: { ...r, meta: { ...r.meta, saveTime: Number.NaN } } });
    expect(screen.getByText('Home Base · — · build 500')).toBeInTheDocument();
  });

  it('imports, closes and shows the banner', async () => {
    const user = userEvent.setup();
    const reply: ImportResultDto = { rev: 2, newlyChecked: 2, conflicts: 1, ignored: 0, collectedTotal: 2 };
    const { calls } = stubFetch({ [`POST /api/worlds/${W}/import`]: { body: reply } });
    const { onClose } = renderDialog(['A']);
    await parse(user, { type: 'done', result: result(['B', 'C']) });
    await user.click(screen.getByRole('button', { name: 'Import' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(calls.find(c => c.method === 'POST')?.body).toEqual({
      fileName: 'Home Base_021126-222410.sav', sessionName: 'Home Base', saveTime: Date.UTC(2026, 10, 2, 22, 24), build: 500, collected: ['B', 'C'],
    });
    expect(useImportBanner.getState().shown).toMatchObject({ worldId: W, added: 2, conflicts: 1 });
  });

  it.each([
    [403, { error: 'invalid_origin', message: 'Origin not allowed' }, "The import didn't work. Please try again."],
    [500, { error: 'internal', message: 'boom' }, "The import didn't work. Please try again."],
  ])('a failed import (%i) stays open and says so', async (status, body, text) => {
    const user = userEvent.setup();
    stubFetch({ [`POST /api/worlds/${W}/import`]: { status, body } });
    const { onClose } = renderDialog(['A']);
    await parse(user, { type: 'done', result: result(['B', 'C']) });
    await user.click(screen.getByRole('button', { name: 'Import' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(text);
    expect(alert).toHaveTextContent(`HTTP ${status} · ${body.error}: ${body.message}`);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('a save matching nothing needs [Import anyway] before it is sent (Review Focus 1)', async () => {
    const user = userEvent.setup();
    const reply: ImportResultDto = { rev: 2, newlyChecked: 0, conflicts: 2, ignored: 0, collectedTotal: 0 };
    const { calls } = stubFetch({ [`POST /api/worlds/${W}/import`]: { body: reply } });
    renderDialog(['A', 'B']);
    await parse(user, { type: 'done', result: result([]) });
    expect(screen.getByText('0 items recognised')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Import' }));
    expect(screen.getByText('This save matches none of the items on this map. Importing it marks all 2 checked items as conflicts.')).toBeInTheDocument();
    expect(calls.filter(c => c.method === 'POST')).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Import anyway' }));
    await waitFor(() => expect(calls.filter(c => c.method === 'POST')).toHaveLength(1));
  });

  it('a file that is not a save shows the error with [Choose another file] (Review Focus 5)', async () => {
    const user = userEvent.setup();
    renderDialog();
    await parse(user, { type: 'error', code: 'not_a_save', message: 'x' });
    expect(screen.getByText("This file couldn't be read as a Satisfactory save")).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Choose another file' }));
    expect(screen.getByLabelText('Choose a save file')).toBeInTheDocument();
  });

  it('a dataset that cannot be loaded says so, not that the file is no save', async () => {
    const user = userEvent.setup();
    renderDialog();
    await parse(user, { type: 'error', code: 'dataset_unavailable', message: 'x' });
    expect(screen.getByText("Couldn't load the map data. Check your connection and try again.")).toBeInTheDocument();
    expect(screen.queryByText("This file couldn't be read as a Satisfactory save")).not.toBeInTheDocument();
  });

  it('clamps the request to what the server accepts', () => {
    const r = { meta: { sessionName: 's'.repeat(300), saveTime: 12.9, build: 1 }, collected: [], openedNotLooted: [], recognised: 0 };
    const req = importRequest('f'.repeat(300), r);
    expect(req.fileName).toHaveLength(255);
    expect(req.sessionName).toHaveLength(255);
    expect(req.saveTime).toBe(12);
    expect(importRequest('a.sav', { ...r, meta: { ...r.meta, saveTime: -5 } }).saveTime).toBe(0);
    expect(importRequest('a.sav', { ...r, meta: { ...r.meta, saveTime: Number.NaN } }).saveTime).toBe(0);
  });

  it('shows the mobile hint on narrow screens', () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q === '(max-width: 899px)' }));
    renderDialog();
    expect(screen.getByText('Large saves parse faster on desktop.')).toBeInTheDocument();
  });

  it('[Import] in the header is for owners only', () => {
    const client = new QueryClient();
    const ctx = (isOwner: boolean): WorldCtx => ({
      worldId: W, world: { ...WORLD, isOwner }, me: ME, index: indexDataset(DATASET), queryClient: client, navigate: () => {}, toast: { show: () => {} },
    });
    const { rerender } = render(<QueryClientProvider client={client}><ToastProvider><ImportButton ctx={ctx(false)} /></ToastProvider></QueryClientProvider>);
    expect(screen.queryByRole('button', { name: 'Import' })).not.toBeInTheDocument();
    rerender(<QueryClientProvider client={client}><ToastProvider><ImportButton ctx={ctx(true)} /></ToastProvider></QueryClientProvider>);
    expect(screen.getByRole('button', { name: 'Import' })).toBeInTheDocument();
  });

  it('[Import] only opens the dialog store; the dialog lives in the world layout', async () => {
    const user = userEvent.setup();
    useImportDialog.getState().hide();
    const client = new QueryClient();
    const ctx: WorldCtx = {
      worldId: W, world: WORLD, me: ME, index: indexDataset(DATASET), queryClient: client, navigate: () => {}, toast: { show: () => {} },
    };
    render(<QueryClientProvider client={client}><ToastProvider><ImportButton ctx={ctx} /></ToastProvider></QueryClientProvider>);
    await user.click(screen.getByRole('button', { name: 'Import' }));
    expect(useImportDialog.getState().open).toBe(true);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    useImportDialog.getState().hide();
  });

  it('[Cancel] during parsing terminates the worker', async () => {
    const user = userEvent.setup();
    renderDialog();
    await parse(user, { type: 'progress', stage: 'parsing', percent: 40 });
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '40');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(FakeWorker.instances[0]!.terminate).toHaveBeenCalled();
    expect(screen.getByLabelText('Choose a save file')).toBeInTheDocument();
  });
});

describe('ImportBanner', () => {
  beforeAll(() => { initI18n(['en']); });
  beforeEach(() => { useImportBanner.setState({ shown: null, onReview: undefined }); });
  afterEach(() => { vi.useRealTimers(); });

  it('shows the result for its world with [Review conflicts], which calls onReview', async () => {
    const user = userEvent.setup();
    const onReview = vi.fn();
    useImportBanner.setState({ onReview });
    useImportBanner.getState().show(W, { added: 12, conflicts: 3 });
    render(<ImportBanner worldId={W} />);
    expect(screen.getByText('Import done · +12 · 3 conflicts (!)')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Review conflicts' }));
    expect(onReview).toHaveBeenCalled();
  });

  it('has no [Review conflicts] without conflicts, and × dismisses it', async () => {
    const user = userEvent.setup();
    useImportBanner.getState().show(W, { added: 2, conflicts: 0 });
    render(<ImportBanner worldId={W} />);
    expect(screen.getByText('Import done · +2 · no conflicts')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Review conflicts' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText(/Import done/)).not.toBeInTheDocument();
  });

  it('is not shown on another world and hides itself after 20 s', () => {
    vi.useFakeTimers();
    useImportBanner.getState().show(W, { added: 1, conflicts: 1 });
    const { rerender } = render(<ImportBanner worldId="other" />);
    expect(screen.queryByText(/Import done/)).not.toBeInTheDocument();
    rerender(<ImportBanner worldId={W} />);
    expect(screen.getByText(/Import done/)).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(IMPORT_BANNER_MS - 1); });
    expect(screen.getByText(/Import done/)).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(1); });
    expect(screen.queryByText(/Import done/)).not.toBeInTheDocument();
  });
});
