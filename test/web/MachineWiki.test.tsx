import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MeDto, WorldDto } from '../../src/shared/api.js';
import { indexDataset, type Dataset } from '../../src/shared/dataset.js';
import type { MachineData } from '../../src/shared/machines.js';
import type { WorldCtx } from '../../src/web/app/feature.js';
import { initI18n } from '../../src/web/app/i18n/index.js';
import { machineWikiFeature, machineWikiTool } from '../../src/web/features/machineWiki/index.js';
import { MachineWikiHeaderItem } from '../../src/web/features/machineWiki/MachineWikiDialog.js';
import { useMachineWiki } from '../../src/web/features/machineWiki/useMachineWiki.js';
import { stubFetch } from './fetchStub.js';

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
      stats: { extractionPerMinute: 60, extractionFluid: true, extractionNode: true, resources: ['Desc_LiquidOil_C'] }, unlockedBy: [],
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
      stats: { powerProduction: 500, gridBoost: 0.1, fuels: [{ item: 'Desc_AlienPowerFuel_C', perMinute: 5, boost: 0.2 }] }, unlockedBy: [],
    },
    {
      id: 'Build_DroneStation_C', category: 'logistics', name: { en: 'Drone Port', de: 'Drohnenlandeplatz' },
      description: { en: 'x', de: 'x' }, wikiPage: 'Drone_Port', stats: { powerUse: 100, storageSlots: 18, fuelSlots: 1 }, unlockedBy: [],
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

function setup(data: 'present' | 'missing') {
  const { calls } = stubFetch(data === 'present' ? { 'GET /data/test/machines.json': { body: DATA } } : {});
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ctx: WorldCtx = { worldId: W, world: WORLD, me: ME, index: indexDataset(DS), queryClient: client, navigate: () => {}, toast: { show: () => {} } };
  render(<QueryClientProvider client={client}><MachineWikiHeaderItem ctx={ctx} /></QueryClientProvider>);
  return { calls };
}

const user = () => userEvent.setup();

async function open() {
  await user().click(screen.getByRole('button', { name: 'Machines' }));
  return screen.findByRole('dialog', { name: 'Machines and vehicles' });
}

describe('machine wiki', () => {
  beforeEach(() => {
    initI18n(['en']);
    useMachineWiki.setState({ open: false, selected: null, query: '' });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('is a header item of its own feature and has a tool definition for the tools navigation', () => {
    expect(machineWikiFeature.headerItems?.map(h => h.id)).toEqual(['machine-wiki']);
    expect(machineWikiTool).toMatchObject({ id: 'machine-wiki', labelKey: 'machineWiki.open', hintKey: 'machineWiki.openHint' });
  });

  it('loads the data only when opened and lists the entries grouped by category', async () => {
    const { calls } = setup('present');
    expect(calls).toEqual([]);
    const dialog = await open();
    const list = await within(dialog).findByRole('navigation', { name: 'Machines and vehicles' });
    expect(calls.map(c => c.path)).toEqual(['/data/test/machines.json']);
    expect(within(list).getAllByRole('heading').map(h => h.textContent)).toEqual(['Production', 'Extraction', 'Power', 'Logistics', 'Vehicles']);
    expect(within(list).getAllByRole('button').map(b => b.textContent)).toEqual([
      'Constructor', 'Resource Well Extractor', 'Coal-Powered Generator', 'Geothermal Generator', 'Alien Power Augmenter', 'Drone Port', 'Fluid Truck',
    ]);
    expect(within(dialog).getByText('Pick a machine or vehicle from the list.')).toBeInTheDocument();
  });

  it('filters by English or German name', async () => {
    setup('present');
    const dialog = await open();
    const search = await within(dialog).findByLabelText('Search');
    const list = within(dialog).getByRole('navigation');
    await user().type(search, 'kohle');
    expect(within(list).getAllByRole('button').map(b => b.textContent)).toEqual(['Coal-Powered Generator']);
    await user().clear(search);
    await user().type(search, 'zzz');
    expect(within(list).queryAllByRole('button')).toEqual([]);
    expect(within(list).getByText('Nothing matches.')).toBeInTheDocument();
  });

  it('shows stats, game description, build cost, unlock, recipes and the wiki link of an entry', async () => {
    setup('present');
    const dialog = await open();
    await user().click(await within(dialog).findByRole('button', { name: 'Constructor' }));
    const article = within(dialog).getByRole('article', { name: 'Constructor' });
    expect(within(dialog).getByRole('button', { name: 'Constructor' })).toHaveAttribute('aria-current', 'true');

    const stats = within(article).getByRole('table', { name: 'Stats' });
    const row = (label: string) => within(stats).getByRole('rowheader', { name: label }).nextElementSibling?.textContent;
    expect(row('Power use')).toBe('4 MW');
    expect(row('Clock speed')).toBe('1%–100% without Power Shards');
    expect(row('Somersloop slots')).toBe('1');
    expect(within(article).getByText('Crafts 1 part into another part.')).toBeInTheDocument();
    expect(within(article).getByText('2 × Reinforced Iron Plate')).toBeInTheDocument();
    expect(within(article).getByText('8 × Cable')).toBeInTheDocument();
    expect(within(article).getByText('Tier 0: HUB Upgrade 3')).toBeInTheDocument();
    expect(within(article).getByText('1 recipe')).toBeInTheDocument();
    const recipe = within(article).getAllByRole('listitem').find(li => li.textContent?.startsWith('Iron Plate'));
    expect(recipe).toHaveTextContent('Iron Plate30/min Iron Ingot →makes 20/min Iron Plate6 s per cycle');
    const link = within(article).getByRole('link', { name: /On the Satisfactory wiki/ });
    expect(link).toHaveAttribute('href', 'https://satisfactory.wiki.gg/wiki/Constructor');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('shows generator fuels per minute and marks a fluid tank as not in the game data', async () => {
    setup('present');
    const dialog = await open();
    await user().click(await within(dialog).findByRole('button', { name: 'Coal-Powered Generator' }));
    const gen = within(dialog).getByRole('article');
    expect(within(gen).getByRole('rowheader', { name: 'Power generated' }).nextElementSibling).toHaveTextContent('75 MW');
    expect(within(gen).getByText('15/min Coal')).toBeInTheDocument();
    expect(within(gen).getByText(/45 m³\/min Water/)).toBeInTheDocument();

    await user().click(within(dialog).getByRole('button', { name: 'Fluid Truck' }));
    const truck = within(dialog).getByRole('article');
    expect(within(truck).getByRole('rowheader', { name: 'Fuel burn rate' }).nextElementSibling).toHaveTextContent('75 MW');
    expect(within(truck).getByRole('rowheader', { name: 'Fluid capacity' }).nextElementSibling).toHaveTextContent('Not in the game data');
    expect(within(truck).queryByText(/Unlocked by/)).toBeNull();
  });

  it('shows the augmenter fuel per minute with its boost, without a clock speed', async () => {
    setup('present');
    const dialog = await open();
    await user().click(await within(dialog).findByRole('button', { name: 'Alien Power Augmenter' }));
    const aug = within(dialog).getByRole('article');
    expect(within(aug).getByRole('rowheader', { name: 'Grid boost' }).nextElementSibling).toHaveTextContent("+10% of the grid's production");
    expect(within(aug).getByText('5/min Alien Power Matrix')).toBeInTheDocument();
    expect(within(aug).getByText(/\+20% grid boost/)).toBeInTheDocument();
    expect(within(aug).queryByRole('rowheader', { name: 'Clock speed' })).toBeNull();
    expect(within(aug).queryByText('Per minute at 100 % clock speed.')).toBeNull();
  });

  it('shows the geothermal average, the drone port storage size and fluid extraction on a normal node', async () => {
    setup('present');
    const dialog = await open();
    const value = (label: string) => within(within(dialog).getByRole('article')).getByRole('rowheader', { name: label }).nextElementSibling;
    await user().click(await within(dialog).findByRole('button', { name: 'Geothermal Generator' }));
    expect(value('Power generated')).toHaveTextContent('200 MW average on a normal geyser, fluctuates in a cycle of 60 s');
    await user().click(within(dialog).getByRole('button', { name: 'Drone Port' }));
    expect(value('Storage size')).toHaveTextContent('18 slots');
    expect(within(dialog).queryByRole('rowheader', { name: /Clock speed|Power exponent/ })).toBeNull();
    await user().click(within(dialog).getByRole('button', { name: 'Resource Well Extractor' }));
    expect(value('Extraction rate')).toHaveTextContent('60 m³/min (normal node)');
  });

  it('goes back to the list from an entry', async () => {
    setup('present');
    const dialog = await open();
    await user().click(await within(dialog).findByRole('button', { name: 'Constructor' }));
    await user().click(within(dialog).getByRole('button', { name: 'Back to the list' }));
    expect(useMachineWiki.getState().selected).toBeNull();
    expect(within(dialog).queryByRole('article')).toBeNull();
  });

  it('opens at an entry from elsewhere', async () => {
    setup('present');
    useMachineWiki.getState().show('Build_GeneratorCoal_C');
    const dialog = await screen.findByRole('dialog', { name: 'Machines and vehicles' });
    expect(await within(dialog).findByRole('article', { name: 'Coal-Powered Generator' })).toBeInTheDocument();
  });

  it('speaks German', async () => {
    initI18n(['de']);
    setup('present');
    await user().click(screen.getByRole('button', { name: 'Maschinen' }));
    const dialog = await screen.findByRole('dialog', { name: 'Maschinen und Fahrzeuge' });
    await user().click(await within(dialog).findByRole('button', { name: 'Konstruktor' }));
    const article = within(dialog).getByRole('article', { name: 'Konstruktor' });
    expect(within(article).getByText('Verarbeitet ein Teil zu einem anderen Teil.')).toBeInTheDocument();
    expect(within(article).getByRole('rowheader', { name: 'Taktrate' }).nextElementSibling).toHaveTextContent('1 %–100 % ohne Energiefragmente');
    expect(within(article).getByRole('link', { name: /Im Satisfactory-Wiki/ })).toBeInTheDocument();

    await user().click(within(dialog).getByRole('button', { name: 'Geothermie-Generator' }));
    expect(within(dialog).getByRole('rowheader', { name: 'Stromerzeugung' }).nextElementSibling)
      .toHaveTextContent('Durchschnittlich 200 MW auf einem normalen Geysir, schwankt im Zyklus von 60 s');
    await user().click(within(dialog).getByRole('button', { name: 'Alien-Energieverstärker' }));
    expect(within(dialog).getByText(/\+20 % Netzverstärkung/)).toBeInTheDocument();
    await user().click(within(dialog).getByRole('button', { name: 'Drohnenlandeplatz' }));
    expect(within(dialog).getByRole('rowheader', { name: 'Lagergröße' }).nextElementSibling).toHaveTextContent('18 Plätze');
    await user().click(within(dialog).getByRole('button', { name: 'Quellenextraktor' }));
    expect(within(dialog).getByRole('rowheader', { name: 'Förderrate' }).nextElementSibling).toHaveTextContent('60 m³/min (normales Vorkommen)');
  });

  it('says so when the dataset has no machine data', async () => {
    setup('missing');
    const dialog = await open();
    expect(await within(dialog).findByText(/This dataset has no machine data/)).toBeInTheDocument();
  });
});
