import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import type { MeDto, WorldDto } from '../../src/shared/api.js';
import type { Dataset } from '../../src/shared/dataset.js';
import { FeaturesProvider } from '../../src/web/app/FeaturesContext.js';
import { initI18n } from '../../src/web/app/i18n/index.js';
import { lastWorld } from '../../src/web/app/persist.js';
import { ToastProvider } from '../../src/web/components/Toast.js';
import { FEATURES } from '../../src/web/features/index.js';
import { useImportDialog } from '../../src/web/features/import/index.js';
import { appRoutes } from '../../src/web/router.js';
import { FakeEventSource } from './fakeEventSource.js';
import { stubFetch } from './fetchStub.js';
import { MOBILE, stubMatchMedia } from './matchMedia.js';

const W = '11111111-1111-4111-8111-111111111111';
const ME: MeDto = { id: 1, displayName: 'Nick', avatarUrl: null, email: 'nick@example.com', datasetVersion: 'v1' };
const WORLD: WorldDto = {
  id: W, name: 'Alpha', isOwner: false, rev: 3, datasetVersion: 'v1', owner: { id: 2, displayName: 'Anna' }, members: [], lastImport: null,
};
const DATASET: Dataset = {
  version: 'v1', build: 1, bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 }, mapId: 'm', podRequirementsKnown: false, biomes: [], items: [], aliases: {},
};

function renderAt(url: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(appRoutes(FEATURES), { initialEntries: [url] });
  render(
    <QueryClientProvider client={queryClient}>
      <FeaturesProvider features={FEATURES}><ToastProvider><RouterProvider router={router} /></ToastProvider></FeaturesProvider>
    </QueryClientProvider>,
  );
  return router;
}

function stubWorld(extra: Parameters<typeof stubFetch>[0] = {}) {
  return stubFetch({
    'GET /api/me': { body: ME },
    [`GET /api/worlds/${W}`]: { body: WORLD },
    [`GET /api/worlds/${W}/marks`]: { body: { rev: 3, marks: [] } },
    'GET /data/v1/collectibles.min.json': { body: DATASET },
    ...extra,
  });
}

describe('WorldLayout', () => {
  beforeAll(() => { initI18n(['en']); });
  beforeEach(() => {
    localStorage.clear();
    FakeEventSource.instances = [];
    vi.stubGlobal('EventSource', FakeEventSource);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('renders the world with its header, map region and live stream, and remembers it', async () => {
    stubWorld();
    renderAt(`/w/${W}`);
    expect(await screen.findByRole('heading', { name: 'Alpha' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Map' })).toBeInTheDocument();
    expect(screen.getByText('Connecting…')).toBeInTheDocument();
    expect(FakeEventSource.last().url).toBe(`/api/worlds/${W}/events`);
    expect(lastWorld()).toBe(W);
  });

  it('hosts the import dialog for owners, opened through useImportDialog', async () => {
    stubWorld({ [`GET /api/worlds/${W}`]: { body: { ...WORLD, isOwner: true } } });
    renderAt(`/w/${W}`);
    await screen.findByRole('heading', { name: 'Alpha' });
    expect(screen.queryByRole('dialog', { name: 'Import save' })).not.toBeInTheDocument();
    act(() => useImportDialog.getState().show());
    expect(screen.getByRole('dialog', { name: 'Import save' })).toBeInTheDocument();
    act(() => useImportDialog.getState().hide());
  });

  it('shows the settings page on /settings in the same layout, without the sidebar, and links back to the map', async () => {
    stubWorld();
    renderAt(`/w/${W}/settings`);
    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.queryByRole('complementary', { name: 'Sidebar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Map' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('link', { name: '← Map' }));
    expect(await screen.findByRole('region', { name: 'Map' })).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'Sidebar' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('href', `/w/${W}/settings`);
  });

  it('switches the main area to the list with the sidebar Map | List control', async () => {
    stubWorld();
    renderAt(`/w/${W}`);
    await screen.findByRole('region', { name: 'Map' });
    await userEvent.click(screen.getByRole('radio', { name: 'List' }));
    expect(await screen.findByRole('table', { name: 'Collectibles' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: 'Map' }));
    expect(await screen.findByRole('region', { name: 'Map' })).toBeInTheDocument();
  });

  it('says hello after joining by invite and drops the flag from the URL', async () => {
    stubWorld();
    const router = renderAt(`/w/${W}?joined=1`);
    expect(await screen.findByText('You joined Alpha · invited by Anna')).toBeInTheDocument();
    expect(router.state.location.search).toBe('');
  });

  it('shows "World not found" with a way back to the list for an unknown world', async () => {
    stubFetch({ 'GET /api/me': { body: ME } });
    renderAt(`/w/${W}`);
    expect(await screen.findByRole('heading', { name: 'World not found' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to my worlds' })).toHaveAttribute('href', '/?list=1');
  });

  it('signs out from the account menu', async () => {
    const { calls } = stubWorld({ 'POST /auth/logout': { status: 204 } });
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    const user = userEvent.setup();
    renderAt(`/w/${W}`);
    await user.click(await screen.findByRole('button', { name: 'Account' }));
    const menu = screen.getByText('Signed in as nick@example.com via Discord').parentElement!;
    await user.click(within(menu).getByRole('button', { name: 'Sign out' }));
    expect(calls).toContainEqual({ method: 'POST', path: '/auth/logout', body: {} });
    expect(assign).toHaveBeenCalledWith('/login');
  });

  it('renders the panels in a bottom sheet instead of the sidebar below 900 px, and switches back', async () => {
    const media = stubMatchMedia({ [MOBILE]: false });
    stubWorld();
    renderAt(`/w/${W}`);
    expect(await screen.findByRole('complementary', { name: 'Sidebar' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Panels' })).not.toBeInTheDocument();

    expect(screen.getByRole('contentinfo')).toBeInTheDocument();

    act(() => media.set(MOBILE, true));
    expect(screen.queryByRole('complementary', { name: 'Sidebar' })).not.toBeInTheDocument();
    const sheet = screen.getByRole('region', { name: 'Panels' });
    // The footer stays visible on mobile: the sheet sits on top of it.
    expect(screen.getByRole('contentinfo')).toBeInTheDocument();
    expect(sheet).toHaveStyle({ bottom: '28px' });
    expect(within(sheet).getByRole('button', { name: 'Panel size: small' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('region', { name: 'Map' })).toBeInTheDocument();

    // Half shows the sidebar panels, full the list view.
    await userEvent.click(within(sheet).getByRole('button', { name: 'Panel size: small' }));
    expect(within(sheet).getByRole('heading', { name: 'Progress' })).toBeInTheDocument();
    // The Map | List switch is desktop-only: on mobile the full sheet is the list.
    expect(within(sheet).queryByRole('radio', { name: 'List' })).not.toBeInTheDocument();
    // No desktop sidebar toggle on mobile, and the account menu opens above the sheet.
    expect(screen.queryByRole('button', { name: /sidebar/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Account' }));
    expect(screen.getByText('Signed in as nick@example.com via Discord').parentElement).toHaveClass('z-[1400]');
    await userEvent.keyboard('{Escape}');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Panel size: half' }));
    expect(within(sheet).getByRole('table', { name: 'Collectibles' })).toBeInTheDocument();

    act(() => media.set(MOBILE, false));
    expect(screen.getByRole('complementary', { name: 'Sidebar' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Panels' })).not.toBeInTheDocument();
  });

  it('collapses the sidebar with [ on desktop', async () => {
    stubWorld();
    renderAt(`/w/${W}`);
    expect(await screen.findByRole('complementary', { name: 'Sidebar' })).toBeInTheDocument();
    await userEvent.keyboard('[[');
    expect(screen.queryByRole('complementary', { name: 'Sidebar' })).not.toBeInTheDocument();
    await userEvent.keyboard('[[');
    expect(screen.getByRole('complementary', { name: 'Sidebar' })).toBeInTheDocument();
  });

  it('hides and shows the sidebar with the header toggle', async () => {
    stubWorld();
    renderAt(`/w/${W}`);
    const hide = await screen.findByRole('button', { name: 'Hide sidebar' });
    expect(hide).toHaveAttribute('aria-expanded', 'true');
    expect(hide).toHaveAttribute('aria-controls', screen.getByRole('complementary', { name: 'Sidebar' }).id);
    await userEvent.click(hide);
    expect(screen.queryByRole('complementary', { name: 'Sidebar' })).not.toBeInTheDocument();
    const show = screen.getByRole('button', { name: 'Show sidebar' });
    expect(show).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(show);
    expect(screen.getByRole('complementary', { name: 'Sidebar' })).toBeInTheDocument();
  });

  it('has the search in the middle of the top bar and the tools next to it, neither on the settings page', async () => {
    stubMatchMedia({ '(min-width: 1280px)': true });
    stubWorld();
    const router = renderAt(`/w/${W}`);
    await screen.findByRole('heading', { name: 'Alpha' });
    const header = screen.getByRole('banner');
    const search = within(header).getByRole('search');
    expect(within(search).getByRole('combobox', { name: 'Search' })).toBeInTheDocument();
    const tools = within(header).getByRole('navigation', { name: 'Tools' });
    expect(within(tools).getByRole('button', { name: 'Quick Check' })).toHaveAttribute('aria-pressed', 'false');
    // The empty test dataset has no caves and no heights: those switches stay hidden.
    expect(within(tools).queryByRole('button', { name: 'Caves' })).toBeNull();
    // The search sits between the left and the right part of the bar.
    expect(search.parentElement?.previousElementSibling).toContainElement(screen.getByRole('heading', { name: 'Alpha' }));
    expect(search.parentElement?.nextElementSibling).toContainElement(tools);
    await act(() => router.navigate(`/w/${W}/settings`));
    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Search' })).toBeNull();
    expect(screen.queryByRole('navigation', { name: 'Tools' })).toBeNull();
  });

  it('on mobile has a search button and a Tools menu in the top bar', async () => {
    stubMatchMedia({ [MOBILE]: true });
    stubWorld();
    renderAt(`/w/${W}`);
    await screen.findByRole('heading', { name: 'Alpha' });
    const header = screen.getByRole('banner');
    await userEvent.click(within(header).getByRole('button', { name: 'Search' }));
    expect(within(header).getByRole('combobox', { name: 'Search' })).toHaveFocus();
    await userEvent.click(within(header).getByRole('button', { name: 'Close' }));
    await userEvent.click(within(header).getByRole('button', { name: 'Tools' }));
    expect(within(screen.getByRole('menu', { name: 'Tools' })).getByRole('menuitemcheckbox', { name: /Quick Check/ })).toBeInTheDocument();
  });
});
