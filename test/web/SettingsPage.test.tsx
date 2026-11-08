import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MeDto, WorldDto } from '../../src/shared/api.js';
import type { WorldCtx } from '../../src/web/app/feature.js';
import { FeaturesProvider } from '../../src/web/app/FeaturesContext.js';
import { initI18n } from '../../src/web/app/i18n/index.js';
import { queryKeys } from '../../src/web/app/queryKeys.js';
import { useUiStore } from '../../src/web/app/store.js';
import { ToastProvider, useToast } from '../../src/web/components/Toast.js';
import { marksFeature } from '../../src/web/features/marks/index.js';
import { FEATURES } from '../../src/web/features/index.js';
import { useImportDialog } from '../../src/web/features/import/index.js';
import { SettingsPage } from '../../src/web/features/sharing/SettingsPage.js';
import { stubFetch } from './fetchStub.js';

const W = '11111111-1111-4111-8111-111111111111';
const world = (isOwner: boolean): WorldDto => ({
  id: W, name: 'Alpha', isOwner, rev: 1, datasetVersion: 'v1', owner: { id: 1, displayName: 'Nick' },
  members: [
    { userId: 1, displayName: 'Nick', avatarUrl: null, joinedVia: 'owner', joinedAt: 0 },
    { userId: 2, displayName: 'Anna', avatarUrl: 'https://cdn.test/a.png', joinedVia: 'invite', joinedAt: Date.UTC(2026, 9, 1) },
  ],
  lastImport: null,
});

const navigate = vi.fn();
let currentCtx: WorldCtx;
function Page({ w, meId }: { w: WorldDto; meId: number }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const ctx = { worldId: W, world: w, me: { id: meId } as MeDto, toast, navigate, queryClient } as unknown as WorldCtx;
  currentCtx = ctx;
  return <SettingsPage ctx={ctx} />;
}

function renderPage(w: WorldDto, meId: number) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(queryKeys.world(W), w);
  render(
    <QueryClientProvider client={client}>
      <FeaturesProvider features={FEATURES}><ToastProvider><Page w={w} meId={meId} /></ToastProvider></FeaturesProvider>
    </QueryClientProvider>,
  );
}

describe('SettingsPage', () => {
  beforeAll(() => { initI18n(['en']); });
  beforeEach(() => { useUiStore.getState().enterWorld(W); });
  afterEach(() => { vi.unstubAllGlobals(); navigate.mockClear(); });

  it('shows the owner sections in order and removes a member after confirming', async () => {
    const { calls } = stubFetch({
      [`GET /api/worlds/${W}/invite-link`]: { body: { url: 'https://ficsmap.test/invite/t', expiresAt: 0 } },
      [`DELETE /api/worlds/${W}/members/2`]: { status: 204 },
    });
    renderPage(world(true), 1);
    expect(screen.getAllByRole('heading', { level: 3 }).map(h => h.textContent)).toEqual(['Name', 'Members', 'Invite', 'Import save', 'Automatic upload', 'Danger zone']);

    const anna = screen.getByRole('listitem', { name: 'Anna' });
    expect(within(anna).getByText(/joined via invite/)).toBeInTheDocument();
    expect(anna.querySelector('img')).toHaveAttribute('alt', '');
    expect(screen.queryByRole('button', { name: 'Remove Nick' })).not.toBeInTheDocument();
    await userEvent.click(within(anna).getByRole('button', { name: 'Remove Anna' }));
    expect(screen.getByText('Remove Anna? Their checks stay.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(calls).toContainEqual({ method: 'DELETE', path: `/api/worlds/${W}/members/2`, body: undefined }));
  });

  it('Import save opens the import dialog', async () => {
    stubFetch({ [`GET /api/worlds/${W}/invite-link`]: { body: { url: 'u', expiresAt: 0 } } });
    renderPage(world(true), 1);
    await userEvent.click(screen.getByRole('button', { name: 'Import a save…' }));
    expect(useImportDialog.getState().open).toBe(true);
    useImportDialog.getState().hide();
  });

  it('renames the world and only enables Save for a changed, valid name', async () => {
    const { calls } = stubFetch({
      [`GET /api/worlds/${W}/invite-link`]: { body: { url: 'u', expiresAt: 0 } },
      [`PATCH /api/worlds/${W}`]: { body: {} },
    });
    renderPage(world(true), 1);
    const save = screen.getByRole('button', { name: 'Save' });
    const input = screen.getByRole('textbox', { name: 'World name' });
    expect(save).toBeDisabled();
    await userEvent.clear(input);
    expect(save).toBeDisabled();
    await userEvent.type(input, '  Beta  ');
    await userEvent.click(save);
    await waitFor(() => expect(calls).toContainEqual({ method: 'PATCH', path: `/api/worlds/${W}`, body: { name: 'Beta' } }));
  });

  it('shows members a read-only list and [Leave world] instead of owner sections', async () => {
    const { calls } = stubFetch({ [`DELETE /api/worlds/${W}/members/2`]: { status: 204 } });
    renderPage(world(false), 2);
    expect(screen.getAllByRole('heading', { level: 3 }).map(h => h.textContent)).toEqual(['Members']);
    expect(screen.queryByRole('button', { name: /^Remove/ })).not.toBeInTheDocument();
    expect(screen.getByText('Owner')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Leave world' }));
    expect(screen.getByText("Leave Alpha? You'll need a new invite to come back.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Leave' }));
    await waitFor(() => expect(calls).toContainEqual({ method: 'DELETE', path: `/api/worlds/${W}/members/2`, body: undefined }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/?list=1', { replace: true }));
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it('does not send a leaving member to /removed when the server broadcasts the removal first', async () => {
    let release!: () => void;
    stubFetch({
      [`DELETE /api/worlds/${W}/members/2`]: () => new Promise(resolve => { release = () => resolve({ status: 204 }); }),
    });
    renderPage(world(false), 2);
    await userEvent.click(screen.getByRole('button', { name: 'Leave world' }));
    await userEvent.click(screen.getByRole('button', { name: 'Leave' }));
    await waitFor(() => expect(release).toBeDefined());
    // The server's `removed` event arrives before the 204.
    act(() => marksFeature.sseHandlers!.removed!({ type: 'removed', rev: 1, userId: 2 } as never, currentCtx));
    expect(navigate).not.toHaveBeenCalledWith('/removed');
    await act(async () => { release(); });
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/?list=1', { replace: true }));
    expect(navigate).not.toHaveBeenCalledWith('/removed');
  });

  it('still honours a removal of the user when they are not leaving on their own', () => {
    stubFetch({});
    renderPage(world(false), 2);
    act(() => marksFeature.sseHandlers!.removed!({ type: 'removed', rev: 1, userId: 2 } as never, currentCtx));
    expect(navigate).toHaveBeenCalledWith('/removed');
  });

  it('adopts a new world name in the field unless the user is editing it', async () => {
    stubFetch({ [`GET /api/worlds/${W}/invite-link`]: { body: { url: 'u', expiresAt: 0 } } });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const ui = (w: WorldDto) => (
      <QueryClientProvider client={client}>
        <FeaturesProvider features={FEATURES}><ToastProvider><Page w={w} meId={1} /></ToastProvider></FeaturesProvider>
      </QueryClientProvider>
    );
    const { rerender } = render(ui(world(true)));
    rerender(ui({ ...world(true), name: 'Gamma' }));
    expect(screen.getByRole('textbox', { name: 'World name' })).toHaveValue('Gamma');
    await userEvent.type(screen.getByRole('textbox', { name: 'World name' }), 'x');
    rerender(ui({ ...world(true), name: 'Delta' }));
    expect(screen.getByRole('textbox', { name: 'World name' })).toHaveValue('Gammax');
  });
});
