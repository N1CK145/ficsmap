import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MeDto, WorldDto } from '../../src/shared/api.js';
import type { WorldCtx } from '../../src/web/app/feature.js';
import { initI18n } from '../../src/web/app/i18n/index.js';
import { ToastProvider, useToast } from '../../src/web/components/Toast.js';
import { InviteSection } from '../../src/web/features/sharing/InviteSection.js';
import { stubFetch } from './fetchStub.js';

const W = '11111111-1111-4111-8111-111111111111';
const EXPIRES = Date.UTC(2026, 10, 10, 12);
const WORLD: WorldDto = {
  id: W, name: 'Alpha', isOwner: true, rev: 1, datasetVersion: 'v1', owner: { id: 1, displayName: 'Nick' }, members: [], lastImport: null,
};

function mockClipboard() {
  const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  return writeText;
}

function Section() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const ctx = { worldId: W, world: WORLD, me: { id: 1 } as MeDto, toast, queryClient } as unknown as WorldCtx;
  return <InviteSection ctx={ctx} />;
}

function renderSection() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><ToastProvider><Section /></ToastProvider></QueryClientProvider>);
}

function stubLinks() {
  let n = 0;
  return stubFetch({
    [`GET /api/worlds/${W}/invite-link`]: () => ({ body: { url: `https://ficsmap.test/invite/token-${++n}`, expiresAt: EXPIRES } }),
    [`POST /api/worlds/${W}/invite-links/revoke`]: { body: {} },
  });
}

const linkCalls = (calls: { method: string; path: string }[]) => calls.filter(c => c.method === 'GET' && c.path.endsWith('/invite-link')).length;

describe('InviteSection', () => {
  beforeAll(() => { initI18n(['en']); });
  afterEach(() => vi.unstubAllGlobals());

  it('fetches the link on mount and shows it in a read-only field with the validity hint', async () => {
    stubLinks();
    renderSection();
    const input = await screen.findByRole('textbox', { name: 'Invite link' });
    await waitFor(() => expect(input).toHaveValue('https://ficsmap.test/invite/token-1'));
    expect(input).toHaveAttribute('readonly');
    expect(screen.getByText(/works once/)).toHaveTextContent(`Valid until ${new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(EXPIRES)} · works once`);
  });

  it('fetches a fresh link after copying and keeps the copied label', async () => {
    const writeText = mockClipboard();
    const { calls } = stubLinks();
    renderSection();
    await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue('https://ficsmap.test/invite/token-1'));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Copy link' })); });
    expect(writeText).toHaveBeenCalledWith('https://ficsmap.test/invite/token-1');
    await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue('https://ficsmap.test/invite/token-2'));
    expect(linkCalls(calls)).toBe(2);
    expect(screen.getByRole('button', { name: 'Copied ✓ · This link is for one person' })).toBeInTheDocument();
  });

  it('revokes all open links after confirming, then shows a fresh link and a toast', async () => {
    const { calls } = stubLinks();
    renderSection();
    await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue('https://ficsmap.test/invite/token-1'));
    await userEvent.click(screen.getByRole('button', { name: 'Revoke all open links' }));
    expect(screen.getByText("Links you've sent stop working. People who already joined stay.")).toBeInTheDocument();
    expect(calls.some(c => c.path.endsWith('/revoke'))).toBe(false);
    await userEvent.click(screen.getByRole('button', { name: 'Revoke links' }));
    await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue('https://ficsmap.test/invite/token-2'));
    expect(calls.some(c => c.method === 'POST' && c.path === `/api/worlds/${W}/invite-links/revoke`)).toBe(true);
    expect(await screen.findByText('Open links revoked')).toBeInTheDocument();
  });

  it('disables Copy while a link is being fetched', async () => {
    let release!: () => void;
    stubFetch({
      [`GET /api/worlds/${W}/invite-link`]: () => new Promise(resolve => { release = () => resolve({ body: { url: 'https://ficsmap.test/invite/t', expiresAt: EXPIRES } }); }),
    });
    renderSection();
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeDisabled();
    await act(async () => { release(); });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Copy link' })).toBeEnabled());
  });

  it('clears the field and shows an error when the refresh after a copy fails', async () => {
    mockClipboard();
    let n = 0;
    stubFetch({
      [`GET /api/worlds/${W}/invite-link`]: () => (++n === 1
        ? { body: { url: 'https://ficsmap.test/invite/token-1', expiresAt: EXPIRES } }
        : { status: 500, body: { error: 'internal', message: 'x' } }),
    });
    renderSection();
    await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue('https://ficsmap.test/invite/token-1'));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Copy link' })); });
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't create an invite link.");
    expect(screen.getByRole('textbox')).toHaveValue('');
  });

  it('resets the copied label after revoking', async () => {
    mockClipboard();
    stubLinks();
    renderSection();
    await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue('https://ficsmap.test/invite/token-1'));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Copy link' })); });
    await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue('https://ficsmap.test/invite/token-2'));
    expect(screen.getByRole('button', { name: /^Copied/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Revoke all open links' }));
    await userEvent.click(screen.getByRole('button', { name: 'Revoke links' }));
    await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue('https://ficsmap.test/invite/token-3'));
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeInTheDocument();
  });
});
