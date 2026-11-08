import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider, useParams } from 'react-router';
import type { MeDto, WorldSummaryDto } from '../../src/shared/api.js';
import { initI18n } from '../../src/web/app/i18n/index.js';
import { setLastWorld } from '../../src/web/app/persist.js';
import { ToastProvider } from '../../src/web/components/Toast.js';
import { WorldListPage } from '../../src/web/features/worlds/WorldListPage.js';
import { stubFetch } from './fetchStub.js';

const ME: MeDto = { id: 1, displayName: 'Nick', avatarUrl: null, email: 'nick@example.com', datasetVersion: 'v1' };
const ALPHA: WorldSummaryDto = {
  id: '11111111-1111-4111-8111-111111111111', name: 'Alpha', role: 'owner', memberCount: 3,
  progress: { done: 42, total: 1764 }, lastImportAt: null,
};
const BETA: WorldSummaryDto = {
  id: '22222222-2222-4222-8222-222222222222', name: 'Beta', role: 'member', memberCount: 1,
  progress: { done: 0, total: 1764 }, lastImportAt: Date.now() - 2 * 3600_000,
};
const NEW_ID = '33333333-3333-4333-8333-333333333333';

function WorldStub() {
  return <p>world page {useParams().id}</p>;
}

function renderAt(url: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter([
    { path: '/', Component: WorldListPage },
    { path: '/w/:id', Component: WorldStub },
  ], { initialEntries: [url] });
  render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider><RouterProvider router={router} /></ToastProvider>
    </QueryClientProvider>,
  );
}

describe('WorldListPage', () => {
  beforeAll(() => { initI18n(['en']); });
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.unstubAllGlobals());

  it('renders the worlds with name, progress and role chip', async () => {
    const GAMMA: WorldSummaryDto = { ...BETA, id: '44444444-4444-4444-8444-444444444444', name: 'Gamma', role: 'admin' };
    stubFetch({ 'GET /api/me': { body: ME }, 'GET /api/worlds': { body: [ALPHA, BETA, GAMMA] } });
    renderAt('/');
    const alpha = (await screen.findByRole('link', { name: 'Alpha' })).closest('li')!;
    const beta = screen.getByRole('link', { name: 'Beta' }).closest('li')!;
    const gamma = screen.getByRole('link', { name: 'Gamma' }).closest('li')!;
    expect(within(alpha).getByText('Owner')).toBeInTheDocument();
    expect(within(gamma).getByText('Admin')).toBeInTheDocument();
    expect(within(beta).getByText('Member')).toBeInTheDocument();
    expect(within(alpha).getByText('42 / 1,764')).toBeInTheDocument();
    expect(within(alpha).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '42');
    expect(within(alpha).getByText('3 members')).toBeInTheDocument();
    expect(within(alpha).getByText('No import yet')).toBeInTheDocument();
    expect(within(beta).getByText('Last import 2 hours ago')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+ New world' })).toBeInTheDocument();
  });

  it('shows the empty state when there are no worlds', async () => {
    stubFetch({ 'GET /api/me': { body: ME }, 'GET /api/worlds': { body: [] } });
    renderAt('/');
    expect(await screen.findByText(/No worlds yet/)).toBeInTheDocument();
  });

  it('creates an empty world with the trimmed name and opens it', async () => {
    const { calls } = stubFetch({
      'GET /api/me': { body: ME },
      'GET /api/worlds': { body: [ALPHA] },
      'POST /api/worlds': { status: 201, body: { id: NEW_ID, name: 'Home base' } },
    });
    const user = userEvent.setup();
    renderAt('/');
    await user.click(await screen.findByRole('button', { name: '+ New world' }));
    const dialog = screen.getByRole('dialog', { name: 'New world' });
    // From a save is the default tab; starting empty is one click away.
    expect(within(dialog).getByRole('tab', { name: 'From save file' })).toHaveAttribute('aria-selected', 'true');
    await user.click(within(dialog).getByRole('tab', { name: 'Start empty' }));
    expect(within(dialog).getByRole('tab', { name: 'Start empty' })).toHaveAttribute('aria-selected', 'true');
    await user.type(within(dialog).getByLabelText('Name'), '  Home base  ');
    await user.click(within(dialog).getByRole('button', { name: 'Create' }));
    expect(await screen.findByText(`world page ${NEW_ID}`)).toBeInTheDocument();
    expect(calls.find(c => c.method === 'POST')).toEqual({ method: 'POST', path: '/api/worlds', body: { name: 'Home base' } });
  });

  it('shows the save-file tab placeholder until the import feature fills it', async () => {
    stubFetch({ 'GET /api/me': { body: ME }, 'GET /api/worlds': { body: [ALPHA] } });
    const user = userEvent.setup();
    renderAt('/');
    await user.click(await screen.findByRole('button', { name: '+ New world' }));
    await user.click(screen.getByRole('tab', { name: 'From save file' }));
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Coming soon');
  });

  it('redirects to the last opened world when it is still in the list', async () => {
    setLastWorld(BETA.id);
    stubFetch({ 'GET /api/me': { body: ME }, 'GET /api/worlds': { body: [ALPHA, BETA] } });
    renderAt('/');
    expect(await screen.findByText(`world page ${BETA.id}`)).toBeInTheDocument();
  });

  it('stays on the list with ?list=1 (back to list)', async () => {
    setLastWorld(BETA.id);
    stubFetch({ 'GET /api/me': { body: ME }, 'GET /api/worlds': { body: [ALPHA, BETA] } });
    renderAt('/?list=1');
    expect(await screen.findByRole('link', { name: 'Beta' })).toBeInTheDocument();
  });

  it('stays on the list when the last world is no longer one of mine', async () => {
    setLastWorld('44444444-4444-4444-8444-444444444444');
    stubFetch({ 'GET /api/me': { body: ME }, 'GET /api/worlds': { body: [ALPHA] } });
    renderAt('/');
    expect(await screen.findByRole('link', { name: 'Alpha' })).toBeInTheDocument();
  });
});
