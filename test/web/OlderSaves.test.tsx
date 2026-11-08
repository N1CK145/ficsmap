import { gunzipSync } from 'node:zlib';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ImportResultDto, MeDto, WorldDto } from '../../src/shared/api.js';
import { indexDataset, type Dataset } from '../../src/shared/dataset.js';
import type { ExtractResult } from '../../src/shared/extract.js';
import type { FactorySnapshot } from '../../src/shared/factory/snapshot.js';
import type { WorldCtx } from '../../src/web/app/feature.js';
import { initI18n } from '../../src/web/app/i18n/index.js';
import { queryKeys } from '../../src/web/app/queryKeys.js';
import { ToastProvider } from '../../src/web/components/Toast.js';
import { ImportDialog, useImportDialog } from '../../src/web/features/import/ImportDialog.js';
import { expectedSession } from '../../src/web/features/import/OlderSaves.js';
import { ImportSection } from '../../src/web/features/sharing/ImportSection.js';
import { makeSnapshot, makeSummary } from './factoryFixtures.js';
import { FakeWorker } from './fakeWorker.js';
import { stubFetch } from './fetchStub.js';

const W = '6f1c2b0e-8a43-4f5e-9d1b-2c3d4e5f6a7b';
const ME: MeDto = { id: 1, displayName: 'Nick', avatarUrl: null, email: null, datasetVersion: 'test' };
const WORLD: WorldDto = {
  id: W, name: 'Alpha', role: 'owner', rev: 1, datasetVersion: 'test', owner: { id: 1, displayName: 'Nick' }, members: [],
  lastImport: { at: 0, sessionName: 'Letz Fetz', fileName: 'Letz Fetz_081126.sav' },
};
const DATASET: Dataset = {
  version: 'test', build: 500, bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 }, mapId: 'm', podRequirementsKnown: true, biomes: [],
  items: [['A', 'somersloop', 0, 0, 0, 0, 1]], aliases: {},
};
const SNAPSHOTS = `/api/worlds/${W}/snapshots`;

function resultOf(snapshot: FactorySnapshot | undefined, session = snapshot?.meta.sessionName ?? 'Letz Fetz'): ExtractResult {
  return {
    meta: { sessionName: session, saveTime: snapshot?.meta.saveTime ?? 0, build: 1 }, collected: ['A'], openedNotLooted: [], recognised: 1,
    ...(snapshot ? { factory: snapshot } : {}),
  } as ExtractResult;
}

function renderDialog(mode: 'save' | 'older' = 'older') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(queryKeys.marks(W), { rev: 1, baseRev: 1, revs: new Map(), pending: new Map(), marks: new Map() });
  const toast = { show: vi.fn() };
  const onClose = vi.fn();
  const ctx: WorldCtx = { worldId: W, world: WORLD, me: ME, index: indexDataset(DATASET), queryClient: client, navigate: () => {}, toast };
  render(
    <QueryClientProvider client={client}>
      <ToastProvider><ImportDialog ctx={ctx} open mode={mode} onClose={onClose} /></ToastProvider>
    </QueryClientProvider>,
  );
  return { client, toast, onClose };
}

const file = (name: string, lastModified: number) => new File([new Uint8Array([1])], name, { lastModified });

/** Answers the n-th parse (0-based) once its worker got the file. */
async function answer(n: number, result: ExtractResult) {
  await waitFor(() => expect(FakeWorker.instances[n]?.posted).toHaveLength(1));
  act(() => FakeWorker.instances[n]!.emit({ type: 'progress', stage: 'parsing', percent: 50 }));
  act(() => FakeWorker.instances[n]!.emit({ type: 'done', result }));
}

/** The snapshot bodies the stub received (gzip-compressed). */
function uploaded(fn: ReturnType<typeof stubFetch>['fn']): FactorySnapshot[] {
  return fn.mock.calls
    .filter(([url, init]) => String(url) === SNAPSHOTS && init?.method === 'POST')
    .map(([, init]) => JSON.parse(gunzipSync(init!.body as Uint8Array).toString('utf8')) as FactorySnapshot);
}

describe('Add older saves', () => {
  beforeAll(() => { initI18n(['en']); });
  beforeEach(() => {
    FakeWorker.instances = [];
    vi.stubGlobal('Worker', FakeWorker);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('parses the files one after another (oldest first), uploads only new snapshots and skips other sessions and duplicates', async () => {
    const user = userEvent.setup();
    let nextId = 10;
    const { fn } = stubFetch({
      [`GET ${SNAPSHOTS}`]: { body: [makeSummary(1, 3_000)] },
      [`POST ${SNAPSHOTS}`]: () => ({ status: 201, body: makeSummary(nextId++, 1_000) }),
    });
    renderDialog();
    expect(screen.getByRole('heading', { name: 'Add older saves' })).toBeInTheDocument();
    await user.upload(screen.getByLabelText('Choose save files'), [
      file('Letz Fetz_051126.sav', 300), file('Other_011126.sav', 200), file('Letz Fetz_021126.sav', 100),
    ]);

    // Oldest first: Letz Fetz_021126 (new), Other_011126 (other session), Letz Fetz_051126 (already on the server).
    await answer(0, resultOf(makeSnapshot('Letz Fetz', 1_000)));
    await waitFor(() => expect(screen.getByText(/^2 of 3/)).toBeInTheDocument());
    await answer(1, resultOf(makeSnapshot('Other', 2_000)));
    await answer(2, resultOf(makeSnapshot('Letz Fetz', 3_000)));

    expect(await screen.findByText('1 save added · 2 skipped')).toBeInTheDocument();
    const list = screen.getByRole('list', { name: 'Chosen saves' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows.map(r => r.querySelector('span')?.textContent)).toEqual(['Letz Fetz_021126.sav', 'Other_011126.sav', 'Letz Fetz_051126.sav']);
    expect(within(rows[0]!).getByText('Added')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('Other session')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('Session “Other” isn\'t this world\'s “Letz Fetz”, so it was skipped.')).toBeInTheDocument();
    expect(within(rows[2]!).getByText('Already there')).toBeInTheDocument();
    expect(uploaded(fn).map(s => s.meta)).toEqual([makeSnapshot('Letz Fetz', 1_000).meta]);
    // Older saves never touch checks or resource nodes.
    expect(fn.mock.calls.some(([url]) => String(url).endsWith('/import'))).toBe(false);

    // "Add anyway" parses that file again and uploads it despite its session.
    await user.click(within(rows[1]!).getByRole('button', { name: 'Add anyway' }));
    await answer(3, resultOf(makeSnapshot('Other', 2_000)));
    await waitFor(() => expect(within(rows[1]!).getByText('Added')).toBeInTheDocument());
    expect(uploaded(fn).map(s => s.meta.sessionName)).toEqual(['Letz Fetz', 'Other']);
  });

  it('skips the second copy of the same save in one batch, and says when a save has no factory data or is no save', async () => {
    const user = userEvent.setup();
    const { fn } = stubFetch({
      [`GET ${SNAPSHOTS}`]: { body: [] },
      [`POST ${SNAPSHOTS}`]: { status: 201, body: makeSummary(5, 1_000) },
    });
    renderDialog();
    await user.upload(screen.getByLabelText('Choose save files'), [file('a.sav', 1), file('b.sav', 2), file('c.sav', 3), file('d.sav', 4)]);
    await answer(0, resultOf(makeSnapshot('Letz Fetz', 1_000)));
    await answer(1, resultOf(makeSnapshot('Letz Fetz', 1_000)));
    await answer(2, resultOf(undefined));
    await waitFor(() => expect(FakeWorker.instances[3]?.posted).toHaveLength(1));
    act(() => FakeWorker.instances[3]!.emit({ type: 'error', code: 'not_a_save', message: 'x' }));
    expect(await screen.findByText('1 save added · 3 skipped')).toBeInTheDocument();
    expect(screen.getByText('Already there')).toBeInTheDocument();
    expect(screen.getByText('This version of ficsmap reads no factory data from saves yet.')).toBeInTheDocument();
    expect(screen.getByText('Not a save')).toBeInTheDocument();
    expect(uploaded(fn)).toHaveLength(1);
  });

  it('stops at the snapshot limit and on Cancel', async () => {
    const user = userEvent.setup();
    stubFetch({
      [`GET ${SNAPSHOTS}`]: { body: [] },
      [`POST ${SNAPSHOTS}`]: { status: 409, body: { error: 'limit_reached', message: 'full' } },
    });
    renderDialog();
    await user.upload(screen.getByLabelText('Choose save files'), [file('a.sav', 1), file('b.sav', 2)]);
    await answer(0, resultOf(makeSnapshot('Letz Fetz', 1_000)));
    expect(await screen.findByText('Limit reached')).toBeInTheDocument();
    expect(screen.getByText('Cancelled')).toBeInTheDocument();
    expect(FakeWorker.instances).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: 'Choose more saves' }));
    await user.upload(screen.getByLabelText('Choose save files'), [file('c.sav', 3)]);
    await waitFor(() => expect(FakeWorker.instances[1]?.posted).toHaveLength(1));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(FakeWorker.instances[1]!.terminate).toHaveBeenCalled();
    expect(await screen.findByText('0 saves added · 1 skipped')).toBeInTheDocument();
  });

  it('is reached from the import dialog and leads back to it', async () => {
    const user = userEvent.setup();
    renderDialog('save');
    await user.click(screen.getByRole('button', { name: 'Add older saves…' }));
    expect(screen.getByRole('heading', { name: 'Add older saves' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Back to import' }));
    expect(screen.getByRole('heading', { name: 'Import save' })).toBeInTheDocument();
  });

  it('the settings open the dialog in this mode', async () => {
    const user = userEvent.setup();
    render(<ImportSection ctx={{} as WorldCtx} />);
    await user.click(screen.getByRole('button', { name: 'Add older saves…' }));
    expect(useImportDialog.getState()).toMatchObject({ open: true, mode: 'older' });
    useImportDialog.getState().hide();
  });

  it('expects the session of the last import, else of the newest snapshot', () => {
    expect(expectedSession({ sessionName: 'A' }, [makeSummary(1, 1, 'B')])).toBe('A');
    expect(expectedSession(null, [makeSummary(1, 1, 'B')])).toBe('B');
    expect(expectedSession(null, [])).toBeUndefined();
  });
});

describe('the save import uploads the factory snapshot', () => {
  beforeAll(() => { initI18n(['en']); });
  beforeEach(() => {
    FakeWorker.instances = [];
    vi.stubGlobal('Worker', FakeWorker);
  });
  afterEach(() => vi.unstubAllGlobals());

  const reply: ImportResultDto = { rev: 2, newlyChecked: 1, conflicts: 0, ignored: 0, collectedTotal: 1 };

  async function importSave(result: ExtractResult) {
    const user = userEvent.setup();
    await user.upload(screen.getByLabelText('Choose a save file'), file('Letz Fetz_081126.sav', 1));
    await answer(0, result);
    await user.click(screen.getByRole('button', { name: 'Import' }));
  }

  it('after the import succeeded', async () => {
    const { fn } = stubFetch({
      [`POST /api/worlds/${W}/import`]: { body: reply },
      [`POST ${SNAPSHOTS}`]: { status: 201, body: makeSummary(1, 1_000) },
    });
    const { onClose, toast } = renderDialog('save');
    await importSave(resultOf(makeSnapshot('Letz Fetz', 1_000)));
    await waitFor(() => expect(uploaded(fn)).toHaveLength(1));
    expect(onClose).toHaveBeenCalled();
    const posts = fn.mock.calls.filter(([, init]) => init?.method === 'POST').map(([url]) => String(url));
    expect(posts).toEqual([`/api/worlds/${W}/import`, SNAPSHOTS]);
    expect(toast.show).not.toHaveBeenCalled();
  });

  it('a failed upload keeps the import and shows a note', async () => {
    stubFetch({
      [`POST /api/worlds/${W}/import`]: { body: reply },
      [`POST ${SNAPSHOTS}`]: { status: 500, body: { error: 'internal', message: 'boom' } },
    });
    const { onClose, toast } = renderDialog('save');
    await importSave(resultOf(makeSnapshot('Letz Fetz', 1_000)));
    await waitFor(() => expect(toast.show).toHaveBeenCalledWith({
      message: "Import done, but the factory of this save couldn't be saved for the factory plan.",
    }));
    expect(onClose).toHaveBeenCalled();
  });

  it('nothing is uploaded without factory data (older parser)', async () => {
    const { fn } = stubFetch({ [`POST /api/worlds/${W}/import`]: { body: reply } });
    const { onClose } = renderDialog('save');
    await importSave(resultOf(undefined));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(uploaded(fn)).toHaveLength(0);
  });
});
