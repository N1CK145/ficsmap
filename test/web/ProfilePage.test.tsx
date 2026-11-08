import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import type { MeDto } from '../../src/shared/api.js';
import { initI18n } from '../../src/web/app/i18n/index.js';
import { getWheelSpeed, usePrefsStore } from '../../src/web/app/prefs.js';
import { ToastProvider } from '../../src/web/components/Toast.js';
import { AccountMenu } from '../../src/web/features/worlds/AccountMenu.js';
import { ProfilePage } from '../../src/web/features/worlds/ProfilePage.js';
import { stubFetch, type StubRoute } from './fetchStub.js';

const ME: MeDto = { id: 1, displayName: 'Nick', avatarUrl: null, email: null, datasetVersion: 'v1', prefs: { wheelSpeed: 1.5 } };
/** Debounce of the save plus a margin. */
const SAVE_WAIT = { timeout: 2000 };

function renderAt(url: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter([
    { path: '/', element: <AccountMenu /> },
    { path: '/profile', Component: ProfilePage },
  ], { initialEntries: [url] });
  render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider><RouterProvider router={router} /></ToastProvider>
    </QueryClientProvider>,
  );
  return { queryClient };
}

function stub(patch: StubRoute = call => ({ body: call.body })) {
  return stubFetch({ 'GET /api/me': { body: ME }, 'PATCH /api/me/prefs': patch });
}

/** The save state under the setting (the toasts have a status region of their own). */
const saveStatus = () => within(screen.getByRole('region', { name: 'Controls' })).getByRole('status');
const slider = () => screen.getByRole('slider', { name: 'Mouse wheel speed' });
const patches = (calls: { method: string; path: string; body: unknown }[]) =>
  calls.filter(c => c.method === 'PATCH' && c.path === '/api/me/prefs').map(c => c.body);

describe('ProfilePage', () => {
  beforeAll(() => { initI18n(['en']); });
  beforeEach(() => {
    localStorage.clear();
    usePrefsStore.setState({ saved: {}, local: {}, status: 'idle' });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('is reached from the account menu', async () => {
    stub();
    renderAt('/');
    await userEvent.click(await screen.findByRole('button', { name: 'Account' }));
    await userEvent.click(screen.getByRole('link', { name: 'Profile settings' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Profile settings' })).toBeInTheDocument();
  });

  it('shows the account\'s wheel speed with its value, the hint and the language switch', async () => {
    stub();
    renderAt('/profile');
    await screen.findByRole('region', { name: 'Controls' });
    // The slider moves over the stops 0.25 0.4 0.5 0.75 [1] 1.25 1.5 2 3, with 1× in the middle.
    expect(slider()).toHaveValue('6');
    expect(slider()).toHaveAttribute('min', '0');
    expect(slider()).toHaveAttribute('max', '8');
    expect(slider()).toHaveAttribute('step', '1');
    expect(slider()).toHaveAttribute('aria-valuetext', '1.5×');
    expect(slider()).toHaveAccessibleDescription('How far one turn of the mouse wheel zooms on the map and in the diagrams.');
    expect(saveStatus()).toBeEmptyDOMElement();
    expect(screen.getByText('1.5×')).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: 'Language' })).toBeInTheDocument();
    expect(getWheelSpeed()).toBe(1.5);
  });

  it('applies a change at once and saves the last value once the slider rests', async () => {
    const { calls } = stub();
    renderAt('/profile');
    await screen.findByRole('region', { name: 'Controls' });
    fireEvent.change(slider(), { target: { value: '8' } });
    fireEvent.change(slider(), { target: { value: '7' } });
    expect(screen.getByText('2.0×')).toBeInTheDocument();
    expect(getWheelSpeed()).toBe(2);
    expect(saveStatus()).toHaveTextContent('Saving…');
    await waitFor(() => expect(saveStatus()).toHaveTextContent('Saved'), SAVE_WAIT);
    expect(patches(calls)).toEqual([{ wheelSpeed: 2 }]);
    expect(JSON.parse(localStorage.getItem('ficsmap:prefs')!)).toEqual({ wheelSpeed: 2 });
  });

  it('[Default] goes back to 1.0× and is off at the default', async () => {
    const { calls } = stub();
    renderAt('/profile');
    await screen.findByRole('region', { name: 'Controls' });
    const reset = screen.getByRole('button', { name: 'Reset the mouse wheel speed to the default (1.0×)' });
    expect(reset).toHaveTextContent('Default');
    await userEvent.click(reset);
    expect(slider()).toHaveValue('4');
    expect(screen.getByText('1.0×')).toBeInTheDocument();
    expect(reset).toBeDisabled();
    await waitFor(() => expect(patches(calls)).toEqual([{ wheelSpeed: 1 }]), SAVE_WAIT);
  });

  it('keeps the value when the save fails, says so, and saves on [Retry]', async () => {
    let fail = true;
    const { calls } = stub(call => (fail ? { status: 500, body: { error: 'internal', message: 'boom' } } : { body: call.body }));
    const { queryClient } = renderAt('/profile');
    await screen.findByRole('region', { name: 'Controls' });
    fireEvent.change(slider(), { target: { value: '2' } });
    await waitFor(() => expect(saveStatus()).toHaveTextContent('Not saved. The setting applies on this device for now.'), SAVE_WAIT);
    expect(slider()).toHaveValue('2');
    // A fresh GET /api/me (focus, another tab) still says 1.5: the unsaved value stays.
    await queryClient.refetchQueries({ queryKey: ['me'] });
    expect(slider()).toHaveValue('2');
    expect(getWheelSpeed()).toBe(0.5);

    fail = false;
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(saveStatus()).toHaveTextContent('Saved'));
    expect(patches(calls)).toEqual([{ wheelSpeed: 0.5 }, { wheelSpeed: 0.5 }]);
    expect(queryClient.getQueryData<MeDto>(['me'])?.prefs).toEqual({ wheelSpeed: 0.5 });
  });

  it('is in German', async () => {
    initI18n(['de']);
    try {
      stub();
      renderAt('/profile');
      expect(await screen.findByRole('heading', { level: 1, name: 'Profil-Einstellungen' })).toBeInTheDocument();
      expect(await screen.findByRole('slider', { name: 'Mausrad-Geschwindigkeit' })).toHaveAttribute('aria-valuetext', '1,5×');
      expect(screen.getByRole('button', { name: /Standard/ })).toHaveTextContent('Standard');
      expect(screen.getByText('Wie stark ein Dreh am Mausrad auf der Karte und in den Diagrammen zoomt.')).toBeInTheDocument();
    } finally {
      initI18n(['en']);
    }
  });
});

describe('prefs store', () => {
  beforeEach(() => localStorage.clear());

  it('starts from what this device remembered, before the account is loaded', async () => {
    localStorage.setItem('ficsmap:prefs', JSON.stringify({ wheelSpeed: 2.5 }));
    vi.resetModules();
    const fresh = await import('../../src/web/app/prefs.js');
    expect(fresh.getWheelSpeed()).toBe(2.5);
    // The account wins once it is there.
    fresh.receivePrefs({ wheelSpeed: 0.75 });
    expect(fresh.getWheelSpeed()).toBe(0.75);
    expect(JSON.parse(localStorage.getItem('ficsmap:prefs')!)).toEqual({ wheelSpeed: 0.75 });
  });

  it('falls back to 1 for nothing or garbage remembered', async () => {
    localStorage.setItem('ficsmap:prefs', '{"wheelSpeed":42');
    vi.resetModules();
    expect((await import('../../src/web/app/prefs.js')).getWheelSpeed()).toBe(1);
  });
});
