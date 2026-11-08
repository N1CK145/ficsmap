import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import type { MeDto, WorldDto } from '../../src/shared/api.js';
import { indexDataset, type CrashSites, type Dataset } from '../../src/shared/dataset.js';
import type { FeatureModule, SearchEntry, WorldCtx } from '../../src/web/app/feature.js';
import { FeaturesProvider } from '../../src/web/app/FeaturesContext.js';
import { initI18n } from '../../src/web/app/i18n/index.js';
import { queryKeys } from '../../src/web/app/queryKeys.js';
import { useUiStore } from '../../src/web/app/store.js';
import { biomesFeature } from '../../src/web/features/biomes/index.js';
import { biomeEntries } from '../../src/web/features/biomes/search.js';
import { cavesFeature } from '../../src/web/features/caves/index.js';
import { caveEntries } from '../../src/web/features/caves/search.js';
import { toShapes, useCaveLayer } from '../../src/web/features/caves/useCaves.js';
import { itemPanelFeature } from '../../src/web/features/itemPanel/index.js';
import { crashSiteEntries } from '../../src/web/features/itemPanel/search.js';
import { collectibleEntries } from '../../src/web/features/search/collectibles.js';
import { useMapFit } from '../../src/web/features/search/fit.js';
import { searchFeature } from '../../src/web/features/search/index.js';
import { SearchBox } from '../../src/web/features/search/SearchBox.js';
import { stubFetch } from './fetchStub.js';
import { MOBILE, stubMatchMedia } from './matchMedia.js';

const W = '6f1c2b0e-8a43-4f5e-9d1b-2c3d4e5f6a7b';
const ME: MeDto = { id: 1, displayName: 'Nick', avatarUrl: null, email: null, datasetVersion: 'test' };
const WORLD: WorldDto = {
  id: W, name: 'Alpha', isOwner: true, rev: 1, datasetVersion: 'test', owner: { id: 1, displayName: 'Nick' }, members: [], lastImport: null,
};
const DS: Dataset = {
  version: 'test', build: 1, bounds: { minX: 0, minY: 0, maxX: 100_000, maxY: 100_000 }, mapId: 'm', podRequirementsKnown: true,
  biomes: [{ id: 'dune-desert', name: { en: 'Dune Desert', de: 'Dünenwüste' } }, { id: 'swamp', name: { en: 'Swamp', de: 'Sumpf' } }],
  items: [
    ['BP_WAT139', 'somersloop', 1000, 1000, 0, 0, 1, { cave: true }],
    ['BP_WAT13', 'somersloop', 50_000, 50_000, 0, 1, 1],
    ['BP_Crystal_mk29', 'slug_blue', 60_000, 60_000, 0, 1, 2],
    ['BP_WAT2_X', 'mercer_sphere', 70_000, 70_000, 0, 0, 2],
    ['BP_DropPod1', 'hard_drive', 80_000, 80_000, 0, 1, 3, { pod: { item: { en: 'Motor', de: 'Motor' }, amount: 5, power: 0 } }],
  ],
  aliases: { BP_MercerShrine_A: 'BP_WAT2_X' },
};
const SITES: CrashSites = {
  BP_DropPod1: { items: [{ item: 'Modular Frame', amount: 11 }], threats: [{ name: 'Alpha Hog', count: 1 }], notes: [] },
};
const CAVES = {
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', properties: { kind: 'cave', id: 'cave-007' }, geometry: { type: 'Polygon', coordinates: [[[0, 0], [2000, 0], [2000, 2000], [0, 2000], [0, 0]]] } },
  ],
};

function makeCtx(navigate: WorldCtx['navigate'] = () => {}): WorldCtx {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(queryKeys.me(), ME);
  return { worldId: W, world: WORLD, me: ME, index: indexDataset(DS), queryClient: client, navigate, toast: { show: () => {} } };
}

/** A world page, as the planner is one: the search box is in the header there too. */
const pageFeature: FeatureModule = { id: 'page', pages: [{ id: 'planner', titleKey: 'planner.title', Component: () => null }] };
const FEATURES: FeatureModule[] = [biomesFeature, cavesFeature, itemPanelFeature, searchFeature, pageFeature];

function renderSearch(features: FeatureModule[] = FEATURES, { url = `/w/${W}`, navigate }: { url?: string; navigate?: WorldCtx['navigate'] } = {}) {
  const { calls } = stubFetch({ 'GET /data/test/caves.geojson': { body: CAVES }, 'GET /data/test/crash-sites.json': { body: SITES } });
  const ctx = makeCtx(navigate);
  const view = render(
    <QueryClientProvider client={ctx.queryClient}>
      <FeaturesProvider features={features}>
        <MemoryRouter initialEntries={[url]}><SearchBox ctx={ctx} /><input aria-label="Other field" /></MemoryRouter>
      </FeaturesProvider>
    </QueryClientProvider>,
  );
  const input = screen.getByRole('combobox', { name: 'Search' });
  return { ctx, input, calls, ...view };
}

const options = () => within(screen.getByRole('listbox', { hidden: true })).queryAllByRole('option').map(o => o.textContent);
const highlight = () => {
  const h = useUiStore.getState().searchHighlight;
  return h === null ? null : [...h].sort();
};

describe('search providers', () => {
  afterEach(() => { initI18n(['en']); });

  it('lists types and items with labels in both languages, IDs and aliases', () => {
    const i18n = initI18n(['de']);
    const entries = collectibleEntries(indexDataset(DS), i18n);
    const sloops = entries.find(e => e.id === 'type:somersloop')!;
    expect(sloops.actors).toEqual(['BP_WAT139', 'BP_WAT13']);
    expect(sloops.detail).toBe('2 auf der Karte');
    const sphere = entries.find(e => e.id === 'item:BP_WAT2_X')!;
    expect(sphere.label).toBe('Mercer-Sphäre · Dünenwüste 2');
    expect(sphere.terms).toEqual(['BP_WAT2_X', 'BP_MercerShrine_A', 'Mercer Sphere · Dune Desert 2', 'Mercer-Sphäre · Dünenwüste 2']);
    // The ID is found, not shown: the label says what and where.
    expect(sphere.detail).toBeUndefined();
    expect(entries.find(e => e.id === 'type:slug_blue')!.terms).toContain('Blue Power Slugs');
  });

  it('lists biomes with their items, and scopes the map to a chosen one', () => {
    const entries = biomeEntries(indexDataset(DS), initI18n(['en']));
    expect(entries.map(e => [e.label, e.terms, e.actors?.length])).toEqual([
      ['Dune Desert', ['Dune Desert', 'Dünenwüste', 'dune-desert'], 2],
      ['Swamp', ['Swamp', 'Sumpf', 'swamp'], 3],
    ]);
    entries[1]!.onSelect!(makeCtx());
    expect(useUiStore.getState().biomeScope).toBe(1);
  });

  it('numbers caves, names their biome, and finds the items inside', () => {
    const index = indexDataset(DS);
    const [cave] = caveEntries(index, toShapes(CAVES as Parameters<typeof toShapes>[0], DS.bounds), initI18n(['en']));
    expect(cave).toMatchObject({ id: 'cave:cave-007', label: 'Cave 7', detail: 'Dune Desert · 1 item', actors: ['BP_WAT139'] });
    expect(cave!.terms).toEqual(['Cave 7', 'Höhle 7', 'cave-007', 'Dune Desert', 'Dünenwüste']);
  });

  it('describes crash sites by what the pod needs and what lies around it', () => {
    const [site] = crashSiteEntries(indexDataset(DS), SITES, initI18n(['en']));
    expect(site).toMatchObject({ label: 'Crash site · Swamp 3', detail: 'To open: 5× Motor', actors: ['BP_DropPod1'] });
    expect(site!.terms).toEqual(expect.arrayContaining(['crash site', 'drop pod', 'Absturzort', 'Motor', 'Modular Frame', 'Alpha Hog']));
  });

  it('does not search the crash sites\' notes, so a note about a Somersloop nearby does not count as one', () => {
    const notes: CrashSites = { BP_DropPod1: { ...SITES.BP_DropPod1!, notes: ['A Somersloop is on the same island.'] } };
    const [site] = crashSiteEntries(indexDataset(DS), notes, initI18n(['en']));
    expect(site!.terms.join(' ')).not.toMatch(/Somersloop/);
  });
});

describe('SearchBox', () => {
  beforeAll(() => { initI18n(['en']); });
  beforeEach(() => {
    localStorage.clear();
    useUiStore.getState().enterWorld(W);
    useCaveLayer.setState({ visible: false });
    useMapFit.getState().clear();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('loads nothing before it is used', () => {
    const { calls } = renderSearch();
    expect(calls).toEqual([]);
  });

  it('lists matches while typing and highlights all their items on the map', async () => {
    const { input } = renderSearch();
    await userEvent.type(input, 'sloop');
    expect(input).toHaveAttribute('aria-expanded', 'true');
    expect(options()[0]).toContain('Somersloop');
    expect(options()[0]).toContain('Type');
    expect(highlight()).toEqual(['BP_WAT13', 'BP_WAT139']);
    expect(screen.getByRole('status')).toHaveTextContent('3 results · 2 items highlighted on the map');
  });

  it('ranks an exact ID first and chooses it with Enter: selected, zoomed to, alone highlighted', async () => {
    const { input } = renderSearch();
    await userEvent.type(input, 'bp_wat13');
    // The results show what and where; the ID they were found by is not repeated.
    expect(options().slice(0, 2)).toEqual(['Somersloop · Swamp 1Item', 'Somersloop · Dune Desert 1Item']);
    await userEvent.keyboard('{Enter}');
    expect(useUiStore.getState().selectedActor).toBe('BP_WAT13');
    expect(useUiStore.getState().focusRequest).toEqual({ actor: 'BP_WAT13' });
    expect(highlight()).toEqual(['BP_WAT13']);
    expect(input).toHaveValue('Somersloop · Swamp 1');
    expect(input).toHaveAttribute('aria-expanded', 'false');
  });

  it('moves through the results with the arrow keys', async () => {
    const { input } = renderSearch();
    await userEvent.type(input, 'bp_wat13');
    const [first, second] = within(screen.getByRole('listbox')).getAllByRole('option');
    expect(first).toHaveAttribute('aria-selected', 'true');
    expect(input).toHaveAttribute('aria-activedescendant', first!.id);
    await userEvent.keyboard('{ArrowDown}');
    expect(second).toHaveAttribute('aria-selected', 'true');
    expect(input).toHaveAttribute('aria-activedescendant', second!.id);
    await userEvent.keyboard('{ArrowUp}{ArrowUp}');
    expect(input).toHaveAttribute('aria-activedescendant', within(screen.getByRole('listbox')).getAllByRole('option').at(-1)!.id);
    await userEvent.keyboard('{ArrowDown}{ArrowDown}{Enter}');
    expect(useUiStore.getState().selectedActor).toBe('BP_WAT139');
  });

  it('closes the list with Esc, then clears the search and the highlight', async () => {
    const { input } = renderSearch();
    await userEvent.type(input, 'swamp');
    expect(highlight()).not.toBeNull();
    await userEvent.keyboard('{Escape}');
    expect(input).toHaveAttribute('aria-expanded', 'false');
    expect(input).toHaveValue('swamp');
    expect(highlight()).not.toBeNull();
    await userEvent.keyboard('{Escape}');
    expect(input).toHaveValue('');
    expect(highlight()).toBeNull();
  });

  it('clears with the × button', async () => {
    const { input } = renderSearch();
    await userEvent.type(input, 'swamp');
    await userEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(input).toHaveValue('');
    expect(input).toHaveFocus();
    expect(highlight()).toBeNull();
  });

  it('finds a biome by its German name, accents left out, and scopes the map to it', async () => {
    const navigate = vi.fn();
    const { input } = renderSearch(FEATURES, { navigate });
    await userEvent.type(input, 'dunenwuste');
    expect(options()[0]).toContain('Dune Desert');
    expect(options()[0]).toContain('Biome');
    await userEvent.click(within(screen.getByRole('listbox')).getAllByRole('option')[0]!);
    expect(useUiStore.getState().biomeScope).toBe(0);
    // The map fits to the biome once it is shown.
    expect(useUiStore.getState().biomeFitRequest).toBe(0);
    expect(highlight()).toEqual(['BP_WAT139', 'BP_WAT2_X']);
    // Already on the map: no navigation.
    expect(navigate).not.toHaveBeenCalled();
  });

  it('on a world page goes back to the map before acting on a map result, but not for other results', async () => {
    // What the map was asked to do when the navigation happened.
    const seen: unknown[] = [];
    const navigate = vi.fn((_to: string) => { seen.push(useUiStore.getState().focusRequest); });
    const recipe: SearchEntry = { id: 'recipe:motor', label: 'Motor', terms: ['Recipe_Motor_C'], kindKey: 'search.kind.item', onSelect: ctx => ctx.navigate('/elsewhere') };
    const recipes: FeatureModule = { id: 'recipes', searchProviders: [{ id: 'recipes', order: 50, useEntries: () => [recipe] }] };
    const { input } = renderSearch([...FEATURES, recipes], { url: `/w/${W}/planner`, navigate });
    await userEvent.type(input, 'bp_wat13{Enter}');
    expect(navigate.mock.calls).toEqual([[`/w/${W}`]]);
    // First to the map, then the request the map carries out once it is shown.
    expect(seen).toEqual([null]);
    expect(useUiStore.getState().focusRequest).toEqual({ actor: 'BP_WAT13' });

    navigate.mockClear();
    await userEvent.clear(input);
    await userEvent.type(input, 'recipe_motor{Enter}');
    expect(navigate.mock.calls).toEqual([['/elsewhere']]);
  });

  it('finds a crash site by what lies there and selects its pod', async () => {
    const { input } = renderSearch();
    await userEvent.type(input, 'modular frame');
    await waitFor(() => expect(options()[0]).toContain('Crash site · Swamp 3'));
    await userEvent.keyboard('{Enter}');
    expect(useUiStore.getState().selectedActor).toBe('BP_DropPod1');
  });

  it('finds a cave, switches the cave layer on and fits the map to it', async () => {
    const { input } = renderSearch();
    await userEvent.type(input, 'höhle 7');
    await waitFor(() => expect(options()[0]).toContain('Cave 7'));
    await userEvent.keyboard('{Enter}');
    expect(useCaveLayer.getState().visible).toBe(true);
    expect(useMapFit.getState().request).not.toBeNull();
    expect(highlight()).toEqual(['BP_WAT139']);
  });

  it('says so when nothing matches, and highlights nothing', async () => {
    const { input } = renderSearch();
    await userEvent.type(input, 'zzz');
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('No matches'));
    expect(highlight()).toBeNull();
  });

  it('takes a new provider without changes to the search box', async () => {
    const recipe: SearchEntry = { id: 'recipe:motor', label: 'Motor', terms: ['Recipe_Motor_C'], kindKey: 'search.kind.item' };
    const recipes: FeatureModule = { id: 'recipes', searchProviders: [{ id: 'recipes', order: 50, useEntries: () => [recipe] }] };
    const { input } = renderSearch([searchFeature, recipes]);
    await userEvent.type(input, 'recipe_motor');
    expect(options()).toEqual(['MotorItem']);
    // An entry without items leaves the map as it is.
    expect(highlight()).toBeNull();
  });

  it('opens with / and Ctrl+K, but / types normally in other fields', async () => {
    const { input } = renderSearch();
    await userEvent.keyboard('/');
    expect(input).toHaveFocus();
    expect(input).toHaveValue('');
    const other = screen.getByRole('textbox', { name: 'Other field' });
    await userEvent.click(other);
    await userEvent.keyboard('/');
    expect(other).toHaveValue('/');
    await userEvent.keyboard('{Control>}k{/Control}');
    expect(input).toHaveFocus();
  });

  it('clears the highlight when it goes away', async () => {
    const { input, unmount } = renderSearch();
    await userEvent.type(input, 'sloop');
    expect(highlight()).not.toBeNull();
    unmount();
    expect(highlight()).toBeNull();
  });

  it('on mobile opens over the top bar from a button and closes after a choice', async () => {
    stubMatchMedia({ [MOBILE]: true });
    stubFetch({});
    const ctx = makeCtx();
    render(
      <QueryClientProvider client={ctx.queryClient}>
        <FeaturesProvider features={FEATURES}><MemoryRouter initialEntries={[`/w/${W}`]}><SearchBox ctx={ctx} /></MemoryRouter></FeaturesProvider>
      </QueryClientProvider>,
    );
    expect(screen.queryByRole('combobox')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));
    const input = screen.getByRole('combobox', { name: 'Search' });
    expect(input).toHaveFocus();
    await userEvent.type(input, 'bp_wat13{Enter}');
    expect(useUiStore.getState().selectedActor).toBe('BP_WAT13');
    expect(screen.queryByRole('combobox')).toBeNull();
    act(() => { fireEvent.keyDown(window, { key: '/' }); });
    expect(screen.getByRole('combobox')).toHaveValue('Somersloop · Swamp 1');
  });

  function renderMobile() {
    stubMatchMedia({ [MOBILE]: true });
    stubFetch({});
    const ctx = makeCtx();
    render(
      <QueryClientProvider client={ctx.queryClient}>
        <FeaturesProvider features={FEATURES}><MemoryRouter initialEntries={[`/w/${W}`]}><SearchBox ctx={ctx} /></MemoryRouter></FeaturesProvider>
      </QueryClientProvider>,
    );
  }

  it('on mobile clears the search when it is closed without a choice, so nothing stays dimmed out of sight', async () => {
    renderMobile();
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));
    await userEvent.type(screen.getByRole('combobox', { name: 'Search' }), 'sloop');
    expect(highlight()).not.toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(highlight()).toBeNull();
    expect(screen.queryByText(/^Search:/)).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(screen.getByRole('combobox')).toHaveValue('');
  });

  it('on mobile shows a chosen result that keeps items highlighted as a chip under the bar, until it is removed', async () => {
    renderMobile();
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));
    await userEvent.type(screen.getByRole('combobox', { name: 'Search' }), 'somersloop');
    await userEvent.keyboard('{Enter}');
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(highlight()).toEqual(['BP_WAT13', 'BP_WAT139']);
    const chip = screen.getByRole('button', { name: 'Search: Somersloop' });
    // Its × ends the search, and with it the dimming.
    await userEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(highlight()).toBeNull();
    expect(chip).not.toBeInTheDocument();
  });

  it('on mobile reopens the search from the chip', async () => {
    renderMobile();
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));
    await userEvent.type(screen.getByRole('combobox', { name: 'Search' }), 'somersloop{Enter}');
    await userEvent.click(screen.getByRole('button', { name: 'Search: Somersloop' }));
    expect(screen.getByRole('combobox', { name: 'Search' })).toHaveValue('Somersloop');
    expect(screen.queryByRole('button', { name: 'Search: Somersloop' })).toBeNull();
  });
});
