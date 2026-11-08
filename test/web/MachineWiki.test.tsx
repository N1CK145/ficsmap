import { QueryClient } from '@tanstack/react-query';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MeDto, WorldDto } from '../../src/shared/api.js';
import { indexDataset, type Dataset } from '../../src/shared/dataset.js';
import type { MachineData } from '../../src/shared/machines.js';
import type { WorldCtx } from '../../src/web/app/feature.js';
import { initI18n } from '../../src/web/app/i18n/index.js';
import { machineWikiFeature, machineWikiTool } from '../../src/web/features/machineWiki/index.js';
import { machineEntries } from '../../src/web/features/machineWiki/search.js';
import type { ItemIcons } from '../../src/web/features/machineWiki/icons.js';
import { getI18n } from 'react-i18next';
import { useMachineWiki } from '../../src/web/features/machineWiki/useMachineWiki.js';
import { NARROW_QUERY } from '../../src/web/features/machineWiki/MachineWiki.js';
import { RECIPE_DATA } from '../fixtures/recipeData.js';
import { stubFetch } from './fetchStub.js';
import { stubMatchMedia } from './matchMedia.js';
import { renderWorldPages } from './worldPages.js';

const W = '6f1c2b0e-8a43-4f5e-9d1b-2c3d4e5f6a7b';
const ME: MeDto = { id: 1, displayName: 'Nick', avatarUrl: null, email: null, datasetVersion: 'test' };
const WORLD: WorldDto = {
  id: W, name: 'Alpha', isOwner: true, rev: 1, datasetVersion: 'test', owner: { id: 1, displayName: 'Nick' }, members: [], lastImport: null,
};
const DS: Dataset = {
  version: 'test', build: 1, bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 }, mapId: 'm', podRequirementsKnown: true,
  biomes: [{ id: 'b', name: { en: 'B', de: 'B' } }], items: [], aliases: {},
};
// Values as in machines.json built from the game's 1.2.5.0 Docs.
const DATA: MachineData = {
  format: 1,
  source: 'test',
  items: {
    Desc_IronIngot_C: { name: { en: 'Iron Ingot', de: 'Eisenbarren' }, form: 'solid' },
    Desc_IronPlate_C: { name: { en: 'Iron Plate', de: 'Eisenplatte' }, form: 'solid' },
    Desc_IronPlateReinforced_C: { name: { en: 'Reinforced Iron Plate', de: 'Verstärkte Eisenplatte' }, form: 'solid' },
    Desc_Cable_C: { name: { en: 'Cable', de: 'Kabel' }, form: 'solid' },
    Desc_Coal_C: { name: { en: 'Coal', de: 'Kohle' }, form: 'solid' },
    Desc_Water_C: { name: { en: 'Water', de: 'Wasser' }, form: 'liquid' },
    Desc_LiquidOil_C: { name: { en: 'Crude Oil', de: 'Rohöl' }, form: 'liquid' },
    Desc_AlienPowerFuel_C: { name: { en: 'Alien Power Matrix', de: 'Alien-Energiematrix' }, form: 'solid' },
  },
  machines: [
    {
      id: 'Build_ConstructorMk1_C', category: 'production', name: { en: 'Constructor', de: 'Konstruktor' },
      description: { en: 'Crafts 1 part into another part.', de: 'Verarbeitet ein Teil zu einem anderen Teil.' }, wikiPage: 'Constructor',
      stats: { powerUse: 4, clock: { min: 0.01, max: 1 }, powerExponent: 1.321929, somersloopSlots: 1 },
      build: { place: 'buildGun', ingredients: [{ item: 'Desc_IronPlateReinforced_C', amount: 2 }, { item: 'Desc_Cable_C', amount: 8 }] },
      unlockedBy: [{ kind: 'tutorial', name: { en: 'HUB Upgrade 3', de: 'HUB-Upgrade 3' }, tier: 0 }],
    },
    {
      id: 'Build_FrackingExtractor_C', category: 'extraction', name: { en: 'Resource Well Extractor', de: 'Quellenextraktor' },
      description: { en: 'x', de: 'x' }, wikiPage: 'Resource_Well_Extractor',
      stats: { extractionPerMinute: 60, extractionFluid: true, extractionNode: true, resources: ['Desc_LiquidOil_C'] },
      unlockedBy: [{ kind: 'milestone', name: { en: 'Advanced Aluminum Production', de: 'Fortgeschrittene Aluminiumproduktion' }, tier: 8 }],
    },
    {
      id: 'Build_GeneratorCoal_C', category: 'power', name: { en: 'Coal-Powered Generator', de: 'Kohlegenerator' },
      description: { en: 'Burns Coal to boil Water.', de: 'Verbrennt Kohle.' }, wikiPage: 'Coal-Powered_Generator',
      stats: { powerProduction: 75, fuels: [{ item: 'Desc_Coal_C', perMinute: 15, supplement: { item: 'Desc_Water_C', amount: 45 } }], clock: { min: 0.01, max: 1 } },
      unlockedBy: [{ kind: 'milestone', name: { en: 'Coal Power', de: 'Kohlestrom' }, tier: 3 }],
    },
    {
      id: 'Build_GeneratorGeoThermal_C', category: 'power', name: { en: 'Geothermal Generator', de: 'Geothermie-Generator' },
      description: { en: 'x', de: 'x' }, wikiPage: 'Geothermal_Generator', stats: { powerVariable: { average: 200, cycleSeconds: 60 } }, unlockedBy: [],
    },
    {
      id: 'Build_AlienPowerBuilding_C', category: 'power', name: { en: 'Alien Power Augmenter', de: 'Alien-Energieverstärker' },
      description: { en: 'x', de: 'x' }, wikiPage: 'Alien_Power_Augmenter',
      stats: { powerProduction: 500, gridBoost: 0.1, fuels: [{ item: 'Desc_AlienPowerFuel_C', perMinute: 5, boost: 0.2 }] },
      unlockedBy: [{ kind: 'mam', name: { en: 'Power Augmenter', de: 'Energieverstärker' }, tier: 0 }],
    },
    {
      id: 'Build_DroneStation_C', category: 'logistics', name: { en: 'Drone Port', de: 'Drohnenlandeplatz' },
      description: { en: 'x', de: 'x' }, wikiPage: 'Drone_Port', stats: { powerUse: 100, storageSlots: 18, fuelSlots: 1 },
      unlockedBy: [{ kind: 'milestone', name: { en: 'Aeronautical Engineering', de: 'Luft- und Raumfahrttechnik' }, tier: 8 }],
    },
    {
      id: 'Desc_FluidTruck_C', category: 'vehicles', name: { en: 'Fluid Truck', de: 'Tanklaster' },
      description: { en: 'Has a capacity of 3200 m³ for fluid storage.', de: 'Hat 3200 m³.' }, wikiPage: 'Fluid_Truck',
      stats: { fluidStorage: true, fuelBurn: 75 }, unlockedBy: [],
    },
  ],
  recipes: [
    { id: 'Recipe_IronPlate_C', name: { en: 'Iron Plate', de: 'Eisenplatte' }, alternate: false, machine: 'Build_ConstructorMk1_C', duration: 6,
      ingredients: [{ item: 'Desc_IronIngot_C', amount: 3 }], products: [{ item: 'Desc_IronPlate_C', amount: 2 }] },
  ],
};

// The picture index of the dataset part `icons`: every class above but Coal has a picture.
const ICONS = {
  format: 1, sizes: [64, 256],
  icons: [...Object.keys(DATA.items).filter(i => i !== 'Desc_Coal_C'), ...DATA.machines.map(m => m.id.replace(/^Build_/, 'Desc_'))].sort(),
};

function setup(data: 'present' | 'missing', icons: 'present' | 'missing' = 'present', url = `/w/${W}`, { recipes = false } = {}) {
  const { calls } = stubFetch({
    ...(data === 'present' && { 'GET /data/test/machines.json': { body: DATA } }),
    ...(icons === 'present' && { 'GET /data/test/icons/items/index.json': { body: ICONS } }),
    ...(recipes && { 'GET /data/test/recipes.json': { body: RECIPE_DATA } }),
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ctx: WorldCtx = { worldId: W, world: WORLD, me: ME, index: indexDataset(DS), queryClient: client, navigate: () => {}, toast: { show: () => {} } };
  const { router } = renderWorldPages({ features: [machineWikiFeature], ctx, url });
  return { calls, router };
}

const user = () => userEvent.setup();
/** The accessible name of a simple element: its aria-label or alt, else its text without the aria-hidden parts. */
function nameOf(el: Element): string {
  const label = el.getAttribute('aria-label') ?? el.getAttribute('alt');
  if (label !== null) return label;
  const copy = el.cloneNode(true) as Element;
  copy.querySelectorAll('[aria-hidden="true"]').forEach(n => n.remove());
  return copy.textContent?.trim() ?? '';
}
/** The accessible names of the buttons in an element. */
const buttonNames = (el: HTMLElement) => within(el).queryAllByRole('button').map(nameOf);
const ICON = (cls: string, size: number) => `/data/test/icons/items/${size}/${cls}.webp`;
/** Whether a stat row's label (`dt`, maybe with a picture and a second line) is `label`. */
const isTerm = (dt: Element, label: string) => dt.textContent === label
  || [...dt.querySelectorAll('span')].some(sp => sp.firstChild?.nodeType === Node.TEXT_NODE && sp.firstChild.textContent === label);
/** A stat row's value (`dd`) by its label (`dt`). */
function stat(scope: HTMLElement, label: string): HTMLElement {
  const term = within(scope).getAllByRole('term').find(dt => isTerm(dt, label));
  if (!term) throw new Error(`no stat "${label}"`);
  return term.nextElementSibling as HTMLElement;
}
const hasStat = (scope: HTMLElement, label: string) => within(scope).queryAllByRole('term').some(dt => isTerm(dt, label));

async function open() {
  await user().click(screen.getByRole('link', { name: 'Machines' }));
  return screen.findByRole('main', { name: 'Machines' });
}

describe('machine wiki', () => {
  beforeEach(() => {
    initI18n(['en']);
    localStorage.clear();
    useMachineWiki.setState({ query: '', tiers: [] });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('is a tool that leads to its own page, /w/:id/wiki with the entry after it', () => {
    expect(machineWikiFeature.tools).toEqual([machineWikiTool]);
    expect(machineWikiFeature.headerItems).toBeUndefined();
    expect(machineWikiTool).toMatchObject({ id: 'machine-wiki', labelKey: 'machineWiki.open', hintKey: 'machineWiki.openHint', action: true, page: 'wiki' });
    expect(machineWikiFeature.pages?.map(p => [p.id, p.subPath, p.titleKey])).toEqual([['wiki', ':entry?', 'machineWiki.title']]);
  });

  it('loads the data only when opened and lists the entries grouped by category', async () => {
    const { calls, router } = setup('present');
    expect(calls).toEqual([]);
    const page = await open();
    expect(router.state.location.pathname).toBe(`/w/${W}/wiki`);
    expect(screen.getByRole('link', { name: 'Machines' })).toHaveAttribute('aria-current', 'page');
    const list = await within(page).findByRole('navigation', { name: 'Machines and vehicles' });
    expect(calls.map(c => c.path)).toEqual(['/data/test/machines.json', '/data/test/icons/items/index.json']);
    expect(within(list).getAllByRole('heading').map(nameOf)).toEqual(['Production', 'Extraction', 'Power', 'Logistics', 'Vehicles']);
    expect(buttonNames(list)).toEqual([
      'Constructor', 'Resource Well Extractor', 'Coal-Powered Generator', 'Geothermal Generator', 'Alien Power Augmenter', 'Drone Port', 'Fluid Truck',
    ]);
    // the tier is the card's description
    expect(within(list).getByRole('button', { name: 'Constructor' })).toHaveAccessibleDescription('Tier 0');
    expect(within(list).getByRole('button', { name: 'Alien Power Augmenter' })).toHaveAccessibleDescription('MAM');
    expect(within(list).getByRole('button', { name: 'Fluid Truck' })).not.toHaveAccessibleDescription();
    // No filler: no "pick one" line, no count while nothing is filtered.
    expect(within(page).queryByText(/Pick a machine/)).toBeNull();
    expect(within(page).queryByText(/of 7 shown/)).toBeNull();
  });

  it('filters by English or German name', async () => {
    setup('present');
    const page = await open();
    const search = await within(page).findByLabelText('Search');
    const list = within(page).getByRole('navigation');
    await user().type(search, 'kohle');
    expect(buttonNames(list)).toEqual(['Coal-Powered Generator']);
    expect(within(page).getByText('1 of 7 shown')).toBeInTheDocument();
    await user().clear(search);
    await user().type(search, 'zzz');
    expect(buttonNames(list)).toEqual([]);
    expect(within(list).getByText('Nothing matches.')).toBeInTheDocument();
  });

  it('shows an entry as a window: picture, name, the other name, category and tier in its title bar', async () => {
    setup('present');
    const page = await open();
    await user().click(await within(page).findByRole('button', { name: 'Coal-Powered Generator' }));
    const article = within(page).getByRole('article', { name: 'Coal-Powered Generator' });
    expect(within(article).getByRole('heading', { level: 3, name: 'Coal-Powered Generator' })).toBeInTheDocument();
    expect(article).toHaveTextContent('Kohlegenerator · Power');
    expect(within(article).getByText('Tier 3')).toBeInTheDocument();
    // Its sections have section headings.
    expect(within(article).getAllByRole('heading', { level: 4 }).map(nameOf)).toEqual(['Stats', 'Fuels', 'In the game', 'Unlocked by']);
  });

  it('shows stats, game description, build cost, unlock, recipes and the wiki link of an entry', async () => {
    setup('present');
    const page = await open();
    await user().click(await within(page).findByRole('button', { name: 'Constructor' }));
    const article = within(page).getByRole('article', { name: 'Constructor' });
    expect(within(page).getByRole('button', { name: 'Constructor' })).toHaveAttribute('aria-current', 'true');

    const stats = within(article).getByRole('region', { name: 'Stats' });
    const row = (label: string) => stat(stats, label).textContent;
    expect(row('Power use')).toBe('4 MW');
    // Without the recipe data (what a Power Shard adds) the range without shards.
    expect(row('Clock speed')).toBe('1%–100% without Power Shards');
    expect(row('Somersloop slots')).toBe('1');
    expect(within(article).getByText('Crafts 1 part into another part.')).toBeInTheDocument();
    expect(within(article).getByText('2 × Reinforced Iron Plate')).toBeInTheDocument();
    expect(within(article).getByText('8 × Cable')).toBeInTheDocument();
    expect(within(article).getByText('Tier 0: HUB Upgrade 3')).toBeInTheDocument();
    expect(within(article).getByText('1 recipe')).toBeInTheDocument();
    const recipe = within(article).getAllByRole('listitem').find(li => li.textContent?.startsWith('Iron Plate'));
    expect(recipe).toHaveTextContent('Iron Plate30/min Iron Ingot→makes20/min Iron Plate6 s per cycle');
    // The recipes are folded away.
    expect(within(article).getByText('1 recipe').closest('details')).not.toHaveAttribute('open');
    const link = within(article).getByRole('link', { name: /On the Satisfactory wiki/ });
    expect(link).toHaveAttribute('href', 'https://satisfactory.wiki.gg/wiki/Constructor');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('gives the clock speed with Power Shards from the recipe data, loaded for an entry that has one', async () => {
    const { calls } = setup('present', 'present', `/w/${W}`, { recipes: true });
    const page = await open();
    await user().click(await within(page).findByRole('button', { name: 'Drone Port' }));
    expect(calls.map(c => c.path)).not.toContain('/data/test/recipes.json');
    await user().click(within(page).getByRole('button', { name: 'Constructor' }));
    const article = within(page).getByRole('article', { name: 'Constructor' });
    await vi.waitFor(() => expect(stat(article, 'Clock speed')).toHaveTextContent('1–250% (up to 3 Power Shards)'));
    expect(calls.map(c => c.path)).toContain('/data/test/recipes.json');
  });

  it('shows generator fuels per minute and marks a fluid tank as not in the game data', async () => {
    setup('present');
    const page = await open();
    await user().click(await within(page).findByRole('button', { name: 'Coal-Powered Generator' }));
    const gen = within(page).getByRole('article');
    expect(stat(gen, 'Power generated')).toHaveTextContent('75 MW');
    const fuels = within(gen).getByRole('region', { name: 'Fuels' });
    expect(stat(fuels, 'Coal')).toHaveTextContent('15/min');
    expect(within(fuels).getByText('plus 45 m³/min Water')).toBeInTheDocument();
    expect(within(gen).getByText('Per minute at 100 % clock speed.')).toBeInTheDocument();

    await user().click(within(page).getByRole('button', { name: 'Fluid Truck' }));
    const truck = within(page).getByRole('article');
    expect(stat(truck, 'Fuel burn rate')).toHaveTextContent('75 MW');
    expect(stat(truck, 'Fluid capacity')).toHaveTextContent('Not in the game data');
    expect(within(truck).queryByText(/Unlocked by/)).toBeNull();
  });

  it('shows the augmenter fuel per minute with its boost, without a clock speed', async () => {
    setup('present');
    const page = await open();
    await user().click(await within(page).findByRole('button', { name: 'Alien Power Augmenter' }));
    const aug = within(page).getByRole('article');
    expect(stat(aug, 'Grid boost')).toHaveTextContent("+10% of the grid's production");
    expect(stat(aug, 'Alien Power Matrix')).toHaveTextContent('5/min');
    expect(within(aug).getByText(/\+20% grid boost/)).toBeInTheDocument();
    expect(hasStat(aug, 'Clock speed')).toBe(false);
    expect(within(aug).queryByText('Per minute at 100 % clock speed.')).toBeNull();
  });

  it('shows the geothermal average, the drone port storage size and fluid extraction on a normal node', async () => {
    setup('present');
    const page = await open();
    const value = (label: string) => stat(within(page).getByRole('article'), label);
    await user().click(await within(page).findByRole('button', { name: 'Geothermal Generator' }));
    expect(value('Power generated')).toHaveTextContent('200 MW average on a normal geyser, fluctuates in a cycle of 60 s');
    await user().click(within(page).getByRole('button', { name: 'Drone Port' }));
    expect(value('Storage size')).toHaveTextContent('18 slots');
    expect(hasStat(within(page).getByRole('article'), 'Clock speed') || hasStat(within(page).getByRole('article'), 'Power exponent (clock speed)')).toBe(false);
    await user().click(within(page).getByRole('button', { name: 'Resource Well Extractor' }));
    expect(value('Extraction rate')).toHaveTextContent('60 m³/min (normal node)');
  });

  it('goes back to the list from an entry with the window\'s ×', async () => {
    const { router } = setup('present');
    const page = await open();
    await user().click(await within(page).findByRole('button', { name: 'Constructor' }));
    await user().click(within(within(page).getByRole('article')).getByRole('button', { name: 'Back to the list' }));
    expect(router.state.location.pathname).toBe(`/w/${W}/wiki`);
    expect(within(page).queryByRole('article')).toBeNull();
  });

  it('on a phone has one back control for an entry: the one above the page, leading to the list', async () => {
    stubMatchMedia({ [NARROW_QUERY]: true });
    const { router } = setup('present', 'present', `/w/${W}/wiki/Build_ConstructorMk1_C`);
    const page = await screen.findByRole('main', { name: 'Machines' });
    const article = await within(page).findByRole('article', { name: 'Constructor' });
    expect(within(article).queryByRole('button', { name: 'Back to the list' })).toBeNull();
    const back = within(page).getByRole('link', { name: 'Back to the list' });
    expect(back).toHaveAttribute('href', `/w/${W}/wiki`);
    await user().click(back);
    expect(router.state.location.pathname).toBe(`/w/${W}/wiki`);
    // In the list there is nothing to go back to inside the page.
    expect(within(page).queryByRole('link')).toBeNull();
  });

  it('puts the open entry into the URL, so Back goes through the entries and keeps the focus in the list', async () => {
    const { router } = setup('present');
    const page = await open();
    const constructor = await within(page).findByRole('button', { name: 'Constructor' });
    await user().click(constructor);
    expect(router.state.location.pathname).toBe(`/w/${W}/wiki/Build_ConstructorMk1_C`);
    expect(within(page).getByRole('button', { name: 'Constructor' })).toHaveFocus();
    // Choosing an entry does not move the focus to the page heading.
    expect(screen.getByRole('heading', { level: 2, name: 'Machines' })).not.toHaveFocus();
    await user().click(within(page).getByRole('button', { name: 'Drone Port' }));
    expect(router.state.location.pathname).toBe(`/w/${W}/wiki/Build_DroneStation_C`);
    expect(within(page).getByRole('article', { name: 'Drone Port' })).toBeInTheDocument();
    await act(() => router.navigate(-1));
    expect(within(page).getByRole('article', { name: 'Constructor' })).toBeInTheDocument();
    await act(() => router.navigate(-1));
    expect(within(page).queryByRole('article')).toBeNull();
    expect(router.state.location.pathname).toBe(`/w/${W}/wiki`);
  });

  it('opens at an entry from its URL (a deep link), the tool marked', async () => {
    setup('present', 'present', `/w/${W}/wiki/Build_GeneratorCoal_C`);
    const page = await screen.findByRole('main', { name: 'Machines' });
    expect(await within(page).findByRole('article', { name: 'Coal-Powered Generator' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Machines' })).toHaveAttribute('aria-current', 'page');
  });

  it('shows the list for an entry the data does not have', async () => {
    setup('present', 'present', `/w/${W}/wiki/Build_Nope_C`);
    const page = await screen.findByRole('main', { name: 'Machines' });
    expect(await within(page).findByRole('navigation', { name: 'Machines and vehicles' })).toBeInTheDocument();
    expect(within(page).queryByRole('article')).toBeNull();
  });

  it('speaks German', async () => {
    initI18n(['de']);
    setup('present', 'present', `/w/${W}`, { recipes: true });
    await user().click(screen.getByRole('link', { name: 'Maschinen' }));
    const page = await screen.findByRole('main', { name: 'Maschinen' });
    await user().click(await within(page).findByRole('button', { name: 'Konstruktor' }));
    const article = within(page).getByRole('article', { name: 'Konstruktor' });
    expect(within(article).getByText('Verarbeitet ein Teil zu einem anderen Teil.')).toBeInTheDocument();
    await vi.waitFor(() => expect(stat(article, 'Taktrate')).toHaveTextContent('1–250 % (bis 3 Energiefragmente)'));
    expect(within(article).getByRole('link', { name: /Im Satisfactory-Wiki/ })).toBeInTheDocument();

    await user().click(within(page).getByRole('button', { name: 'Geothermie-Generator' }));
    expect(stat(within(page).getByRole('article'), 'Stromerzeugung'))
      .toHaveTextContent('Durchschnittlich 200 MW auf einem normalen Geysir, schwankt im Zyklus von 60 s');
    await user().click(within(page).getByRole('button', { name: 'Alien-Energieverstärker' }));
    expect(within(page).getByText(/\+20 % Netzverstärkung/)).toBeInTheDocument();
    await user().click(within(page).getByRole('button', { name: 'Drohnenlandeplatz' }));
    expect(stat(within(page).getByRole('article'), 'Lagergröße')).toHaveTextContent('18 Plätze');
    await user().click(within(page).getByRole('button', { name: 'Quellenextraktor' }));
    expect(stat(within(page).getByRole('article'), 'Förderrate')).toHaveTextContent('60 m³/min (normales Vorkommen)');
  });

  it('says so when the dataset has no machine data', async () => {
    setup('missing');
    const page = await open();
    expect(await within(page).findByText(/This dataset has no machine data/)).toBeInTheDocument();
  });

  describe('pictures', () => {
    it('shows the game pictures in the cards, the entry\'s title bar and next to every item, sized for the screen', async () => {
      setup('present');
      const page = await open();
      const card = await within(page).findByRole('button', { name: 'Constructor' });
      const cardPic = card.querySelector('img')!;
      expect(cardPic).toHaveAttribute('src', ICON('Desc_ConstructorMk1_C', 256));
      expect(cardPic).toHaveAttribute('srcset', `${ICON('Desc_ConstructorMk1_C', 64)} 64w, ${ICON('Desc_ConstructorMk1_C', 256)} 256w`);
      expect(cardPic).toHaveAttribute('sizes', '88px');
      expect(cardPic).toHaveAttribute('alt', '');
      expect(cardPic).toHaveAttribute('aria-hidden', 'true');
      expect(cardPic).toHaveAttribute('loading', 'lazy');
      expect(within(page).getByRole('button', { name: 'Fluid Truck' }).querySelector('img')).toHaveAttribute('src', ICON('Desc_FluidTruck_C', 256));

      await user().click(card);
      const article = within(page).getByRole('article', { name: 'Constructor' });
      // every picture is decoration next to a name; the title bar's stands beside the entry's name
      expect(within(article).queryAllByRole('img')).toEqual([]);
      expect(article.firstElementChild?.querySelector('img')).toHaveAttribute('src', ICON('Desc_ConstructorMk1_C', 64));
      expect(within(article).getByText('2 × Reinforced Iron Plate').querySelector('img')).toHaveAttribute('src', ICON('Desc_IronPlateReinforced_C', 64));
      const recipe = within(article).getAllByRole('listitem').find(li => li.textContent?.startsWith('Iron Plate'))!;
      expect([...recipe.querySelectorAll('img')].map(i => i.getAttribute('src'))).toEqual([ICON('Desc_IronIngot_C', 64), ICON('Desc_IronPlate_C', 64)]);
      // the list beside the entry has small pictures too
      expect(within(page).getByRole('navigation').querySelector('img')).toHaveAttribute('sizes', '28px');
    });

    it('shows pictures next to fuels and extracted resources, and nothing for an item without one', async () => {
      setup('present');
      const page = await open();
      await user().click(await within(page).findByRole('button', { name: 'Coal-Powered Generator' }));
      const gen = within(page).getByRole('article');
      const fuel = stat(gen, 'Coal').parentElement!;
      expect(fuel.querySelector('img')).toBeNull(); // Coal is not in the picture index
      await user().click(within(page).getByRole('button', { name: 'Resource Well Extractor' }));
      const extracts = stat(within(page).getByRole('article'), 'Extracts');
      expect(extracts).toHaveTextContent('Crude Oil');
      expect(extracts.querySelector('img')).toHaveAttribute('src', ICON('Desc_LiquidOil_C', 64));
    });

    it('drops a picture whose file fails to load', async () => {
      setup('present');
      const page = await open();
      await user().click(await within(page).findByRole('button', { name: 'Constructor' }));
      const article = within(page).getByRole('article');
      const titleBar = article.firstElementChild!;
      fireEvent.error(titleBar.querySelector('img')!);
      expect(titleBar.querySelector('img')).toBeNull();
      expect(within(article).getByRole('heading', { name: 'Constructor' })).toBeInTheDocument();
      expect(titleBar.querySelector('[data-testid="icon-placeholder"]')).not.toBeNull();
    });

    it('works without pictures in the dataset', async () => {
      const { calls } = setup('present', 'missing');
      const page = await open();
      await user().click(await within(page).findByRole('button', { name: 'Constructor' }));
      expect(calls.map(c => c.path)).toContain('/data/test/icons/items/index.json');
      expect(page.querySelector('img')).toBeNull();
      expect(within(page).getByRole('article', { name: 'Constructor' })).toBeInTheDocument();
      expect(within(page).getByText('2 × Reinforced Iron Plate')).toBeInTheDocument();
    });
  });

  describe('tier filter', () => {
    const chips = (page: HTMLElement) => within(within(page).getByRole('group', { name: 'Filter by tier' }));
    const list = (page: HTMLElement) => within(page).getByRole('navigation', { name: 'Machines and vehicles' });

    it('offers tiers 0 to the highest in the data and the other unlock groups', async () => {
      setup('present');
      const page = await open();
      await within(page).findByRole('navigation');
      expect(buttonNames(within(page).getByRole('group', { name: 'Filter by tier' }))).toEqual([
        'Tier 0', 'Tier 1', 'Tier 2', 'Tier 3', 'Tier 4', 'Tier 5', 'Tier 6', 'Tier 7', 'Tier 8', 'MAM research', 'Other unlocks',
      ]);
      expect(chips(page).getByRole('button', { name: 'Tier 3' })).toHaveTextContent(/^3$/);
      expect(chips(page).getByRole('button', { name: 'Tier 3' })).toHaveAttribute('aria-pressed', 'false');
    });

    it('shows the entries of every selected tier, combined with the search', async () => {
      setup('present');
      const page = await open();
      await within(page).findByRole('navigation');
      await user().click(chips(page).getByRole('button', { name: 'Tier 8' }));
      expect(chips(page).getByRole('button', { name: 'Tier 8' })).toHaveAttribute('aria-pressed', 'true');
      expect(buttonNames(list(page))).toEqual(['Resource Well Extractor', 'Drone Port']);
      await user().click(chips(page).getByRole('button', { name: 'MAM research' }));
      expect(buttonNames(list(page))).toEqual(['Resource Well Extractor', 'Alien Power Augmenter', 'Drone Port']);
      expect(within(page).getByText('3 of 7 shown')).toBeInTheDocument();
      await user().type(within(page).getByLabelText('Search'), 'drohne');
      expect(buttonNames(list(page))).toEqual(['Drone Port']);
      await user().clear(within(page).getByLabelText('Search'));
      await user().click(within(page).getByRole('button', { name: 'Clear filter' }));
      expect(buttonNames(list(page))).toHaveLength(7);
      // The clear control is there only while a filter is set.
      expect(within(page).queryByRole('button', { name: 'Clear filter' })).toBeNull();
    });

    it('selects everything up to a tier with the select or chip by chip, and remembers it on the device', async () => {
      setup('present');
      const page = await open();
      await within(page).findByRole('navigation');
      for (const n of [0, 1, 2, 3]) await user().click(chips(page).getByRole('button', { name: `Tier ${n}` }));
      expect(useMachineWiki.getState().tiers).toEqual(['T0', 'T1', 'T2', 'T3']);
      expect(buttonNames(list(page))).toEqual(['Constructor', 'Coal-Powered Generator']);
      expect(within(page).getByRole('combobox', { name: 'Up to tier' })).toHaveValue('3');
      expect(JSON.parse(localStorage.getItem('ficsmap:machineWikiTiers')!)).toEqual(['T0', 'T1', 'T2', 'T3']);

      await user().selectOptions(within(page).getByRole('combobox', { name: 'Up to tier' }), '8');
      expect(useMachineWiki.getState().tiers).toEqual(['T0', 'T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8']);
      expect(buttonNames(list(page))).toEqual(['Constructor', 'Resource Well Extractor', 'Coal-Powered Generator', 'Drone Port']);
      // a single tier switched off: no longer a range from tier 0
      await user().click(chips(page).getByRole('button', { name: 'Tier 0' }));
      expect(within(page).getByRole('combobox', { name: 'Up to tier' })).toHaveValue('mixed');
      await user().selectOptions(within(page).getByRole('combobox', { name: 'Up to tier' }), '');
      expect(useMachineWiki.getState().tiers).toEqual([]);
      expect(localStorage.getItem('ficsmap:machineWikiTiers')).toBeNull();
    });

    it('speaks German', async () => {
      initI18n(['de']);
      setup('present');
      await user().click(screen.getByRole('link', { name: 'Maschinen' }));
      const page = await screen.findByRole('main', { name: 'Maschinen' });
      await within(page).findByRole('navigation');
      const group = within(page).getByRole('group', { name: 'Nach Stufe filtern' });
      expect(buttonNames(group).slice(0, 2)).toEqual(['Stufe 0', 'Stufe 1']);
      expect(within(group).getByRole('button', { name: 'MAM-Forschung' })).toBeInTheDocument();
      expect(within(page).getByRole('button', { name: 'Konstruktor' })).toHaveAccessibleDescription('Stufe 0');
      expect(within(page).getByRole('combobox', { name: 'Bis Stufe' })).toBeInTheDocument();
    });
  });
});

describe('machine wiki in the search', () => {
  beforeEach(() => { useMachineWiki.setState({ query: '' }); });

  it('has one entry per machine and vehicle, found by both names and the class, opening the wiki page there', () => {
    initI18n(['de']);
    const entries = machineEntries(DATA, getI18n());
    expect(entries).toHaveLength(DATA.machines.length);
    const first = DATA.machines[0]!;
    const e = entries[0]!;
    expect(e).toMatchObject({ id: `machine:${first.id}`, label: first.name.de });
    expect(e.terms).toEqual(expect.arrayContaining([first.name.en, first.name.de, first.id]));
    expect(e.actors).toBeUndefined();
    const vehicle = DATA.machines.findIndex(m => m.category === 'vehicles');
    if (vehicle >= 0) expect(entries[vehicle]!.kindKey).toBe('search.kind.vehicle');
    const navigate = vi.fn();
    e.onSelect?.({ worldId: W, navigate } as unknown as WorldCtx);
    expect(navigate).toHaveBeenCalledWith(`/w/${W}/wiki/${first.id}`);
    expect(machineWikiFeature.searchProviders?.map(p => p.id)).toEqual(['machines']);
    // Without the dataset's pictures the entries have no icon.
    expect(e.icon).toBeUndefined();
  });

  it('shows each machine\'s picture in its result when the dataset has one (the header has no IconsContext)', () => {
    initI18n(['de']);
    const first = DATA.machines[0]!;
    const cls = first.id.replace(/^Build_/, 'Desc_');
    const icons: ItemIcons = { has: c => c === cls, urls: c => ({ src: `/i/${c}.webp`, srcSet: `/i/${c}.webp 64w` }) };
    const entries = machineEntries(DATA, getI18n(), icons);
    const { container } = render(<>{entries[0]!.icon}</>);
    expect(container.querySelector('img')).toHaveAttribute('src', `/i/${cls}.webp`);
    expect(entries.slice(1).every(e => e.icon === undefined)).toBe(true);
  });
});
