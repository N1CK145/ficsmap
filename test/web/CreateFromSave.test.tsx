import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider, useParams } from 'react-router';
import type { MeDto } from '../../src/shared/api.js';
import type { Dataset } from '../../src/shared/dataset.js';
import { initI18n } from '../../src/web/app/i18n/index.js';
import { ToastProvider } from '../../src/web/components/Toast.js';
import { useImportBanner } from '../../src/web/features/import/index.js';
import { WorldListPage } from '../../src/web/features/worlds/WorldListPage.js';
import { FakeWorker } from './fakeWorker.js';
import { stubFetch, type StubRoute } from './fetchStub.js';

const ME: MeDto = { id: 1, displayName: 'Nick', avatarUrl: null, email: null, datasetVersion: 'v1' };
const NEW_ID = '33333333-3333-4333-8333-333333333333';
const DATASET: Dataset = {
  version: 'v1', build: 500, bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 }, mapId: 'm', podRequirementsKnown: true, biomes: [],
  items: [['B', 'hard_drive', 0, 0, 0, 0, 1]], aliases: {},
};
const LONG_SESSION = `  ${'x'.repeat(90)}  `;

function WorldStub() {
  return <p>world page {useParams().id}</p>;
}

async function openAndParse(importRoute: StubRoute, sessionName = 'Home Base') {
  const stub = stubFetch({
    'GET /api/me': { body: ME },
    'GET /api/worlds': { body: [] },
    'GET /data/v1/collectibles.min.json': { body: DATASET },
    'POST /api/worlds': { status: 201, body: { id: NEW_ID, name: 'x' } },
    [`POST /api/worlds/${NEW_ID}/import`]: importRoute,
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter([{ path: '/', Component: WorldListPage }, { path: '/w/:id', Component: WorldStub }], { initialEntries: ['/'] });
  render(<QueryClientProvider client={queryClient}><ToastProvider><RouterProvider router={router} /></ToastProvider></QueryClientProvider>);
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: '+ New world' }));
  await user.click(screen.getByRole('tab', { name: 'From save file' }));
  await user.upload(await screen.findByLabelText('Choose a save file'), new File([new Uint8Array([1])], 'Home Base_021126-222410.sav'));
  await waitFor(() => expect(FakeWorker.instances[0]?.posted).toHaveLength(1));
  expect(FakeWorker.instances[0]!.posted[0]!.msg.datasetUrl).toBe('http://localhost:3000/data/v1/collectibles.min.json');
  act(() => FakeWorker.instances[0]!.emit({
    type: 'done', result: { meta: { sessionName, saveTime: 0, build: 500 }, collected: ['B'], openedNotLooted: [], recognised: 1 },
  }));
  return { ...stub, user };
}

describe('Create from save', () => {
  beforeAll(() => { initI18n(['en']); });
  beforeEach(() => {
    localStorage.clear();
    FakeWorker.instances = [];
    vi.stubGlobal('Worker', FakeWorker);
    useImportBanner.getState().dismiss();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('prefills the name from the session, creates the world, imports and opens it', async () => {
    const { calls, user } = await openAndParse({ body: { rev: 1, newlyChecked: 1, conflicts: 0, ignored: 0, collectedTotal: 1 } });
    const dialog = screen.getByRole('dialog', { name: 'New world' });
    expect(within(dialog).getByText('Hard Drives')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Name')).toHaveValue('Home Base');
    await user.click(within(dialog).getByRole('button', { name: 'Create' }));
    expect(await screen.findByText(`world page ${NEW_ID}`)).toBeInTheDocument();
    const posts = calls.filter(c => c.method === 'POST');
    expect(posts.map(c => c.path)).toEqual(['/api/worlds', `/api/worlds/${NEW_ID}/import`]);
    expect(posts[0]!.body).toEqual({ name: 'Home Base' });
    expect(posts[1]!.body).toMatchObject({ fileName: 'Home Base_021126-222410.sav', collected: ['B'] });
    expect(useImportBanner.getState().shown).toMatchObject({ worldId: NEW_ID, added: 1, conflicts: 0 });
  });

  it('trims the prefilled name to 80 characters', async () => {
    await openAndParse({ body: {} }, LONG_SESSION);
    expect(screen.getByLabelText('Name')).toHaveValue('x'.repeat(80));
  });

  it('opens the world anyway when the import fails, with a toast', async () => {
    const { user } = await openAndParse({ status: 500, body: { error: 'internal', message: 'x' } });
    await user.click(screen.getByRole('button', { name: 'Create' }));
    expect(await screen.findByText(`world page ${NEW_ID}`)).toBeInTheDocument();
    expect(screen.getByText('World created, but the import failed. You can import again from the map.')).toBeInTheDocument();
  });
});
