import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MemberRole, MeDto, WorldDto, WorldRole } from '../../src/shared/api.js';
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
/** Nick owns Alpha; Anna (2) has `annaRole`, Ben (3) is a member, Cleo (4) an admin. `role` is the viewer's. */
const world = (role: WorldRole, annaRole: MemberRole = role === 'admin' ? 'admin' : 'member'): WorldDto => ({
  id: W, name: 'Alpha', role, rev: 1, datasetVersion: 'v1', owner: { id: 1, displayName: 'Nick' },
  members: [
    { userId: 1, displayName: 'Nick', avatarUrl: null, joinedVia: 'owner', joinedAt: 0, role: 'owner' },
    { userId: 2, displayName: 'Anna', avatarUrl: 'https://cdn.test/a.png', joinedVia: 'invite', joinedAt: Date.UTC(2026, 9, 1), role: annaRole },
    { userId: 3, displayName: 'Ben', avatarUrl: null, joinedVia: 'invite', joinedAt: Date.UTC(2026, 9, 2), role: 'member' },
    { userId: 4, displayName: 'Cleo', avatarUrl: null, joinedVia: 'invite', joinedAt: Date.UTC(2026, 9, 3), role: 'admin' },
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
    renderPage(world('owner'), 1);
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
    renderPage(world('owner'), 1);
    await userEvent.click(screen.getByRole('button', { name: 'Import a save…' }));
    expect(useImportDialog.getState().open).toBe(true);
    useImportDialog.getState().hide();
  });

  it('renames the world and only enables Save for a changed, valid name', async () => {
    const { calls } = stubFetch({
      [`GET /api/worlds/${W}/invite-link`]: { body: { url: 'u', expiresAt: 0 } },
      [`PATCH /api/worlds/${W}`]: { body: {} },
    });
    renderPage(world('owner'), 1);
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
    renderPage(world('member'), 2);
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
    renderPage(world('member'), 2);
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
    renderPage(world('member'), 2);
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
    const { rerender } = render(ui(world('owner')));
    rerender(ui({ ...world('owner'), name: 'Gamma' }));
    expect(screen.getByRole('textbox', { name: 'World name' })).toHaveValue('Gamma');
    await userEvent.type(screen.getByRole('textbox', { name: 'World name' }), 'x');
    rerender(ui({ ...world('owner'), name: 'Delta' }));
    expect(screen.getByRole('textbox', { name: 'World name' })).toHaveValue('Gammax');
  });
  it("shows each member's role as a badge", () => {
    stubFetch({});
    renderPage(world('member'), 2);
    const badge = (name: string) => within(screen.getByRole('listitem', { name })).getByText(/^(Owner|Admin|Member)$/).textContent;
    expect(['Nick', 'Anna', 'Ben', 'Cleo'].map(badge)).toEqual(['Owner', 'Member', 'Member', 'Admin']);
  });

  it('lets the owner make a member an admin after a confirm that says what admins can do', async () => {
    const { calls } = stubFetch({
      [`GET /api/worlds/${W}/invite-link`]: { body: { url: 'u', expiresAt: 0 } },
      [`PUT /api/worlds/${W}/members/2/role`]: { status: 204 },
    });
    renderPage(world('owner'), 1);
    expect(within(screen.getByRole('listitem', { name: 'Nick' })).queryByRole('button')).not.toBeInTheDocument();
    const cleo = screen.getByRole('listitem', { name: 'Cleo' });
    expect(within(cleo).queryByRole('button', { name: 'Make Cleo an admin' })).not.toBeInTheDocument();
    expect(within(cleo).getByRole('button', { name: 'Remove Cleo' })).toBeInTheDocument();

    await userEvent.click(within(screen.getByRole('listitem', { name: 'Anna' })).getByRole('button', { name: 'Make Anna an admin' }));
    expect(screen.getByText(/^Make Anna an admin\? Admins can import saves/)).toBeInTheDocument();
    expect(calls.some(c => c.method === 'PUT')).toBe(false);
    await userEvent.click(screen.getByRole('button', { name: 'Make admin' }));
    await waitFor(() => expect(calls).toContainEqual({ method: 'PUT', path: `/api/worlds/${W}/members/2/role`, body: { role: 'admin' } }));
  });

  it('lets the owner take admin rights away', async () => {
    const { calls } = stubFetch({
      [`GET /api/worlds/${W}/invite-link`]: { body: { url: 'u', expiresAt: 0 } },
      [`PUT /api/worlds/${W}/members/4/role`]: { status: 204 },
    });
    renderPage(world('owner'), 1);
    await userEvent.click(within(screen.getByRole('listitem', { name: 'Cleo' })).getByRole('button', { name: 'Remove admin rights from Cleo' }));
    expect(screen.getByText(/Upload keys Cleo created are revoked/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Remove admin rights' }));
    await waitFor(() => expect(calls).toContainEqual({ method: 'PUT', path: `/api/worlds/${W}/members/4/role`, body: { role: 'member' } }));
  });

  it('shows an admin every block but the danger zone, [Remove] only for plain members, and lets them step down', async () => {
    const { calls } = stubFetch({
      [`GET /api/worlds/${W}/invite-link`]: { body: { url: 'u', expiresAt: 0 } },
      [`PUT /api/worlds/${W}/members/2/role`]: { status: 204 },
    });
    renderPage(world('admin'), 2);
    expect(screen.getAllByRole('heading', { level: 3 }).map(h => h.textContent)).toEqual(['Name', 'Members', 'Invite', 'Import save', 'Automatic upload']);
    expect(screen.queryByRole('button', { name: /an admin$|^Remove admin rights from/ })).not.toBeInTheDocument();
    expect(within(screen.getByRole('listitem', { name: 'Ben' })).getByRole('button', { name: 'Remove Ben' })).toBeInTheDocument();
    for (const name of ['Nick', 'Anna', 'Cleo']) {
      expect(within(screen.getByRole('listitem', { name })).queryByRole('button')).not.toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: 'Leave world' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Give up admin rights' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Give up admin rights' }));
    await waitFor(() => expect(calls).toContainEqual({ method: 'PUT', path: `/api/worlds/${W}/members/2/role`, body: { role: 'member' } }));
  });

  it('gives a member neither role buttons nor [Give up admin rights]', () => {
    stubFetch({});
    renderPage(world('member'), 2);
    expect(screen.queryByRole('button', { name: /admin/i })).not.toBeInTheDocument();
  });
});
