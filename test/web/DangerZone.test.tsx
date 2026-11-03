import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MeDto, WorldDto } from '../../src/shared/api.js';
import type { WorldCtx } from '../../src/web/app/feature.js';
import { initI18n } from '../../src/web/app/i18n/index.js';
import { ToastProvider, useToast } from '../../src/web/components/Toast.js';
import { marksFeature } from '../../src/web/features/marks/index.js';
import { DangerZone } from '../../src/web/features/sharing/DangerZone.js';
import { stubFetch } from './fetchStub.js';

const W = '11111111-1111-4111-8111-111111111111';
const WORLD: WorldDto = {
  id: W, name: 'Alpha', isOwner: true, rev: 1, datasetVersion: 'v1', owner: { id: 1, displayName: 'Nick' }, members: [], lastImport: null,
};

const navigate = vi.fn();
const show = vi.fn();
let currentCtx: WorldCtx;
function Zone() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const ctx = { worldId: W, world: WORLD, me: { id: 1 } as MeDto, toast: { show }, navigate, queryClient } as unknown as WorldCtx;
  currentCtx = ctx;
  return <DangerZone ctx={ctx} />;
}

describe('DangerZone', () => {
  beforeAll(() => { initI18n(['en']); });
  afterEach(() => { vi.unstubAllGlobals(); navigate.mockClear(); show.mockClear(); });

  it('enables Delete only once the exact world name is typed, then deletes and leaves', async () => {
    const { calls } = stubFetch({ [`DELETE /api/worlds/${W}`]: { status: 204 } });
    const client = new QueryClient();
    render(<QueryClientProvider client={client}><ToastProvider><Zone /></ToastProvider></QueryClientProvider>);

    const button = screen.getByRole('button', { name: 'Delete world' });
    const input = screen.getByLabelText('Type the world name to confirm');
    expect(input).not.toHaveAttribute('placeholder'); // a placeholder showing the name reads as already filled in
    expect(button).toBeDisabled();
    await userEvent.type(input, 'alpha');
    expect(button).toBeDisabled();
    await userEvent.clear(input);
    await userEvent.type(input, 'Alpha');
    expect(button).toBeEnabled();

    await userEvent.click(button);
    await waitFor(() => expect(calls).toContainEqual({ method: 'DELETE', path: `/api/worlds/${W}`, body: undefined }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/?list=1', { replace: true }));
    expect(show).toHaveBeenCalledWith({ message: 'World deleted' });
  });

  it('navigates and toasts once even when the server announces the deletion first', async () => {
    let release!: () => void;
    stubFetch({ [`DELETE /api/worlds/${W}`]: () => new Promise(resolve => { release = () => resolve({ status: 204 }); }) });
    render(<QueryClientProvider client={new QueryClient()}><ToastProvider><Zone /></ToastProvider></QueryClientProvider>);
    await userEvent.type(screen.getByLabelText('Type the world name to confirm'), 'Alpha');
    await userEvent.click(screen.getByRole('button', { name: 'Delete world' }));
    await waitFor(() => expect(release).toBeDefined());
    act(() => marksFeature.sseHandlers!.deleted!({ type: 'deleted', rev: 1 } as never, currentCtx));
    expect(navigate).not.toHaveBeenCalled();
    await act(async () => { release(); });
    await waitFor(() => expect(navigate).toHaveBeenCalledTimes(1));
    expect(show).toHaveBeenCalledTimes(1);
  });
});
