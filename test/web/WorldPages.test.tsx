import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import type { MeDto, WorldDto } from '../../src/shared/api.js';
import type { Dataset } from '../../src/shared/dataset.js';
import type { MachineData } from '../../src/shared/machines.js';
import type { TransportData } from '../../src/shared/transport.js';
import { collect, type WorldCtx } from '../../src/web/app/feature.js';
import { FeaturesProvider } from '../../src/web/app/FeaturesContext.js';
import { initI18n } from '../../src/web/app/i18n/index.js';
import { useUiStore } from '../../src/web/app/store.js';
import { ToastProvider } from '../../src/web/components/Toast.js';
import { FEATURES } from '../../src/web/features/index.js';
import { useMachineWiki } from '../../src/web/features/machineWiki/index.js';
import { pickRouteMode, useVehicleCalc } from '../../src/web/features/vehicleCalc/index.js';
import { EMPTY_FORM } from '../../src/web/features/vehicleCalc/useVehicleCalc.js';
import { appRoutes } from '../../src/web/router.js';
import { RECIPE_DATA } from '../fixtures/recipeData.js';
import { FakeEventSource } from './fakeEventSource.js';
import { stubFetch } from './fetchStub.js';
import { MOBILE, stubMatchMedia } from './matchMedia.js';

const W = '11111111-1111-4111-8111-111111111111';
const ME: MeDto = { id: 1, displayName: 'Nick', avatarUrl: null, email: 'nick@example.com', datasetVersion: 'v1' };
const WORLD: WorldDto = {
  id: W, name: 'Alpha', isOwner: false, rev: 3, datasetVersion: 'v1', owner: { id: 2, displayName: 'Anna' }, members: [], lastImport: null,
};
const DATASET: Dataset = {
  version: 'v1', build: 1, bounds: { minX: 0, minY: 0, maxX: 100_000, maxY: 100_000 }, mapId: 'm', podRequirementsKnown: false,
  biomes: [{ id: 'swamp', name: { en: 'Swamp', de: 'Sumpf' } }], items: [['BP_WAT13', 'somersloop', 50_000, 50_000, 0, 0, 1]], aliases: {},
};
const MACHINES: MachineData = {
  format: 1, source: 'test', items: {}, recipes: [],
  machines: [{
    id: 'Build_ConstructorMk1_C', category: 'production', name: { en: 'Constructor', de: 'Konstruktor' },
    description: { en: 'Crafts 1 part into another part.', de: 'Verarbeitet ein Teil.' }, wikiPage: 'Constructor', stats: { powerUse: 4 }, unlockedBy: [],
  }, {
    id: 'Build_SmelterMk1_C', category: 'production', name: { en: 'Smelter', de: 'Schmelzofen' },
    description: { en: 'Smelts ore.', de: 'Schmilzt Erz.' }, wikiPage: 'Smelter', stats: { powerUse: 4 }, unlockedBy: [],
  }],
};
const TRANSPORT: TransportData = {
  gameVersion: '1.2.5.0',
  vehicles: [{ id: 'truck', name: { en: 'Truck', de: 'Lkw' }, slots: 48, fluidCapacity: null, stopSeconds: 16, stopSource: 'truckStation', straightPathSpeed: 25, tractionSpeed: 26.2, fuel: null }],
  items: [],
  fuels: [],
};
const PAGES = [
  { tool: 'Planner', heading: 'Planner', path: 'planner' },
  { tool: 'Vehicles', heading: 'Vehicle calculator', path: 'vehicles' },
  { tool: 'Machines', heading: 'Machines and vehicles', path: 'wiki' },
];

function renderAt(url: string) {
  stubFetch({
    'GET /api/me': { body: ME },
    [`GET /api/worlds/${W}`]: { body: WORLD },
    [`GET /api/worlds/${W}/marks`]: { body: { rev: 3, marks: [] } },
    'GET /data/v1/collectibles.min.json': { body: DATASET },
    'GET /data/v1/recipes.json': { body: RECIPE_DATA },
    'GET /data/v1/machines.json': { body: MACHINES },
    'GET /data/v1/transport.json': { body: TRANSPORT },
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(appRoutes(FEATURES), { initialEntries: [url] });
  render(
    <QueryClientProvider client={queryClient}>
      <FeaturesProvider features={FEATURES}><ToastProvider><RouterProvider router={router} /></ToastProvider></FeaturesProvider>
    </QueryClientProvider>,
  );
  return router;
}

const header = () => within(screen.getByRole('banner'));

describe('world pages', () => {
  beforeAll(() => { initI18n(['en']); });
  beforeEach(() => {
    localStorage.clear();
    FakeEventSource.instances = [];
    vi.stubGlobal('EventSource', FakeEventSource);
    useMachineWiki.setState({ query: '', tiers: [] });
    useVehicleCalc.setState({ form: EMPTY_FORM, route: null, pickedStart: null, lengthFromRoute: false, returnRequest: false });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('are the planner, the vehicle calculator and the machine wiki, with short English paths', () => {
    expect(collect(FEATURES, 'pages').map(p => [p.id, p.subPath])).toEqual([['vehicles', undefined], ['planner', undefined], ['wiki', ':entry?']]);
    // None of them is a dialog in the header any more.
    expect(collect(FEATURES, 'headerItems').map(h => h.id)).not.toEqual(expect.arrayContaining([expect.stringMatching(/dialog/)]));
  });

  it.each(PAGES)('opens $heading from the Tools menu at /w/:id/$path, full width under the header, the world kept', async ({ tool, heading, path }) => {
    stubMatchMedia({ '(min-width: 1280px)': true });
    const router = renderAt(`/w/${W}`);
    expect(await screen.findByRole('region', { name: 'Map' })).toBeInTheDocument();
    const stream = FakeEventSource.last();
    await userEvent.click(header().getByRole('button', { name: 'Tools' }));
    await userEvent.click(screen.getByRole('menuitem', { name: tool }));

    expect(router.state.location.pathname).toBe(`/w/${W}/${path}`);
    const page = screen.getByRole('main', { name: heading });
    expect(within(page).getByRole('heading', { level: 2, name: heading })).toHaveFocus();
    // No sidebar, map or item panel; the header keeps the world, the search and the tools.
    expect(screen.queryByRole('complementary', { name: 'Sidebar' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Map' })).toBeNull();
    expect(screen.queryByRole('button', { name: /sidebar/ })).toBeNull();
    expect(header().getByRole('heading', { level: 1, name: 'Alpha' })).toBeInTheDocument();
    expect(header().getByRole('combobox', { name: 'Search' })).toBeInTheDocument();
    await userEvent.click(header().getByRole('button', { name: 'Tools' }));
    expect(screen.getByRole('menuitem', { name: tool })).toHaveAttribute('aria-current', 'page');
    await userEvent.keyboard('{Escape}');
    // The world stays loaded: the same event stream.
    expect(FakeEventSource.instances).toEqual([stream]);

    await userEvent.click(within(page).getByRole('link', { name: 'Back to the map' }));
    expect(router.state.location.pathname).toBe(`/w/${W}`);
    expect(await screen.findByRole('region', { name: 'Map' })).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'Sidebar' })).toBeInTheDocument();
  });

  it('goes between pages and back with the browser history', async () => {
    const router = renderAt(`/w/${W}/planner`);
    expect(await screen.findByRole('heading', { name: 'Planner' })).toHaveFocus();
    await act(() => router.navigate(`/w/${W}/vehicles`));
    expect(await screen.findByRole('heading', { name: 'Vehicle calculator' })).toHaveFocus();
    await act(() => router.navigate(-1));
    expect(await screen.findByRole('heading', { name: 'Planner' })).toHaveFocus();
  });

  it('opens a wiki entry from its URL, and the browser goes back between entries', async () => {
    const router = renderAt(`/w/${W}/wiki/Build_SmelterMk1_C`);
    const page = await screen.findByRole('main', { name: 'Machines and vehicles' });
    expect(await within(page).findByRole('article', { name: 'Smelter' })).toBeInTheDocument();
    await userEvent.click(within(page).getByRole('button', { name: 'Constructor' }));
    expect(router.state.location.pathname).toBe(`/w/${W}/wiki/Build_ConstructorMk1_C`);
    expect(within(page).getByRole('article', { name: 'Constructor' })).toBeInTheDocument();
    await act(() => router.navigate(-1));
    expect(within(page).getByRole('article', { name: 'Smelter' })).toBeInTheDocument();
  });

  it('goes back to the map for a map result of the search, and to the wiki for a machine', async () => {
    const router = renderAt(`/w/${W}/planner`);
    await screen.findByRole('main', { name: 'Planner' });
    const search = header().getByRole('combobox', { name: 'Search' });
    await userEvent.type(search, 'constructor');
    expect(await screen.findByRole('option', { name: /Constructor/ })).toBeInTheDocument();
    await userEvent.keyboard('{Enter}');
    expect(router.state.location.pathname).toBe(`/w/${W}/wiki/Build_ConstructorMk1_C`);
    expect(await screen.findByRole('article', { name: 'Constructor' })).toBeInTheDocument();

    await userEvent.clear(search);
    await userEvent.type(search, 'bp_wat13{Enter}');
    expect(router.state.location.pathname).toBe(`/w/${W}`);
    expect(await screen.findByRole('region', { name: 'Map' })).toBeInTheDocument();
    expect(useUiStore.getState().selectedActor).toBe('BP_WAT13');
    // The map carried out the zoom it was asked for once it was shown.
    expect(useUiStore.getState().focusRequest).toBeNull();
    expect(screen.getByRole('complementary', { name: 'Item details' })).toBeInTheDocument();
  });

  it('picks the vehicle route on the map and comes back to the calculator page', async () => {
    const router = renderAt(`/w/${W}`);
    await screen.findByRole('region', { name: 'Map' });
    await act(() => router.navigate(`/w/${W}/vehicles`));
    const page = await screen.findByRole('main', { name: 'Vehicle calculator' });
    await userEvent.click(await within(page).findByRole('button', { name: 'Pick on the map' }));

    expect(router.state.location.pathname).toBe(`/w/${W}`);
    expect(await screen.findByRole('region', { name: 'Map' })).toBeInTheDocument();
    expect(await screen.findByText('Vehicle calculator: choose the start on the map')).toBeInTheDocument();
    const ctx = {} as WorldCtx;
    act(() => pickRouteMode.onMapClick!({ x: 0, y: 0 }, ctx));
    act(() => pickRouteMode.onMapClick!({ x: 30_000, y: 40_000 }, ctx));

    const back = await screen.findByRole('main', { name: 'Vehicle calculator' });
    expect(router.state.location.pathname).toBe(`/w/${W}/vehicles`);
    expect(within(back).getByLabelText('Route length (one way)')).toHaveValue(500);
    expect(within(back).getByRole('region', { name: 'Route on the map' })).toHaveTextContent('Straight line500 m');
    // The pick was a detour of the page: Back leads to where the page was opened from, the map without the pick mode.
    await act(() => router.navigate(-1));
    expect(router.state.location.pathname).toBe(`/w/${W}`);
    expect(await screen.findByRole('region', { name: 'Map' })).toBeInTheDocument();
    expect(useUiStore.getState().interactionMode).toBe('inspect');
    expect(screen.queryByRole('main')).toBeNull();
  });

  it('shows a page full screen under the header on mobile, without the sheets', async () => {
    stubMatchMedia({ [MOBILE]: true });
    const router = renderAt(`/w/${W}`);
    expect(await screen.findByRole('region', { name: 'Panels' })).toBeInTheDocument();
    await userEvent.click(header().getByRole('button', { name: 'Tools' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Planner' }));
    expect(router.state.location.pathname).toBe(`/w/${W}/planner`);
    expect(screen.getByRole('main', { name: 'Planner' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Panels' })).toBeNull();
    expect(header().getByRole('button', { name: 'Search' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('link', { name: 'Back to the map' }));
    expect(await screen.findByRole('region', { name: 'Panels' })).toBeInTheDocument();
  });

  it('speaks German', async () => {
    initI18n(['de']);
    renderAt(`/w/${W}/wiki`);
    const page = await screen.findByRole('main', { name: 'Maschinen und Fahrzeuge' });
    expect(within(page).getByRole('link', { name: 'Zurück zur Karte' })).toHaveAttribute('href', `/w/${W}`);
    initI18n(['en']);
  });
});
