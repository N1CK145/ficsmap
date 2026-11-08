import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import L from 'leaflet';
import type { ReactNode } from 'react';
import { MapContainer } from 'react-leaflet';
import type { MeDto, WorldDto } from '../../src/shared/api.js';
import type { BuildingsFile } from '../../src/shared/buildings.js';
import { indexDataset, type Dataset } from '../../src/shared/dataset.js';
import { machineFlow, type AnalysisData, type MachineFlow } from '../../src/shared/factory/analysis.js';
import type { FactorySnapshot, SnapshotBuilding } from '../../src/shared/factory/snapshot.js';
import type { MachineData, MachineEntry } from '../../src/shared/machines.js';
import { indexRecipes, type RecipeData } from '../../src/shared/recipes.js';
import type { WorldCtx } from '../../src/web/app/feature.js';
import { initI18n } from '../../src/web/app/i18n/index.js';
import { factoryLabels } from '../../src/web/features/factory/data.js';
import { placePopup } from '../../src/web/features/factory/MachinePopup.js';
import { MachineWindow } from '../../src/web/features/factory/MachineWindow.js';
import { FactoryInfo } from '../../src/web/features/factory/map/FactoryInfo.js';
import { clickFactory, escapeStepsBack } from '../../src/web/features/factory/map/FactoryMapLayer.js';
import { MapMachinePopup } from '../../src/web/features/factory/map/MapMachinePopup.js';
import { DEFAULT_VIEW, useFactoryMap } from '../../src/web/features/factory/map/useFactoryMap.js';
import { useFactoryFormat } from '../../src/web/features/factory/format.js';
import { useFactoryView } from '../../src/web/features/factory/view.js';
import { makeSummary } from './factoryFixtures.js';
import { stubFetch } from './fetchStub.js';
import { MOBILE, stubMatchMedia } from './matchMedia.js';

const W = '6f1c2b0e-8a43-4f5e-9d1b-2c3d4e5f6a7b';
const ME: MeDto = { id: 1, displayName: 'Nick', avatarUrl: null, email: null, datasetVersion: 'test' };
const WORLD: WorldDto = {
  id: W, name: 'Alpha', role: 'owner', rev: 1, datasetVersion: 'test', owner: { id: 1, displayName: 'Nick' }, members: [], lastImport: null,
};
const DS: Dataset = {
  version: 'test', build: 1, bounds: { minX: 0, minY: 0, maxX: 256_000, maxY: 256_000 }, mapId: 'm', podRequirementsKnown: true,
  biomes: [{ id: 'g', name: { en: 'G', de: 'G' } }], items: [], aliases: {},
};
const n = (en: string, de = en) => ({ en, de });
const RECIPES: RecipeData = {
  format: 1, source: 'test', clock: { min: 0.01, perShard: 0.5 },
  items: [
    { id: 'Desc_OreIron_C', name: n('Iron Ore', 'Eisenerz'), form: 'solid' },
    { id: 'Desc_IronIngot_C', name: n('Iron Ingot', 'Eisenbarren'), form: 'solid' },
    { id: 'Desc_IronPlate_C', name: n('Iron Plate', 'Eisenplatte'), form: 'solid' },
    { id: 'Desc_Coal_C', name: n('Coal', 'Kohle'), form: 'solid' },
    { id: 'Desc_Water_C', name: n('Water', 'Wasser'), form: 'liquid' },
  ],
  recipes: [
    { id: 'Recipe_IngotIron_C', name: n('Iron Ingot', 'Eisenbarren'), alternate: false, machine: 'Build_SmelterMk1_C', duration: 2,
      ingredients: [{ item: 'Desc_OreIron_C', amount: 1 }], products: [{ item: 'Desc_IronIngot_C', amount: 1 }] },
    { id: 'Recipe_IronPlate_C', name: n('Iron Plate', 'Eisenplatte'), alternate: false, machine: 'Build_ConstructorMk1_C', duration: 6,
      ingredients: [{ item: 'Desc_IronIngot_C', amount: 3 }], products: [{ item: 'Desc_IronPlate_C', amount: 2 }] },
  ],
  machines: [
    { id: 'Build_SmelterMk1_C', name: n('Smelter', 'Schmelzofen'), power: 4, powerExponent: 1.321929 },
    { id: 'Build_ConstructorMk1_C', name: n('Constructor', 'Konstruktor'), power: 4, powerExponent: 1.321929 },
  ],
  extractors: [
    { id: 'Build_MinerMk2_C', name: n('Miner Mk.2', 'Miner Mk.2'), kind: 'miner', tier: 2, rate: 120, power: 15, powerExponent: 1.321929, resources: ['Desc_OreIron_C'], onNode: true },
  ],
};
const entry = (id: string, category: MachineEntry['category'], stats: MachineEntry['stats'], name = n(id)): MachineEntry =>
  ({ id, category, name, description: n(''), wikiPage: id, stats, unlockedBy: [] });
const MACHINES: MachineData = {
  format: 1, source: 'test', items: {}, recipes: [],
  machines: [
    entry('Build_ConstructorMk1_C', 'production', { powerUse: 4, somersloopSlots: 1 }, n('Constructor', 'Konstruktor')),
    entry('Build_SmelterMk1_C', 'production', { powerUse: 4 }, n('Smelter', 'Schmelzofen')),
    entry('Build_GeneratorCoal_C', 'power', {
      powerProduction: 75,
      fuels: [{ item: 'Desc_Coal_C', perMinute: 15, supplement: { item: 'Desc_Water_C', amount: 45 } }],
    }, n('Coal-Powered Generator', 'Kohlekraftwerk')),
  ],
};
const box = { source: 'clearance' as const, boxes: [{ min: [-400, -500, 0] as [number, number, number], max: [400, 500, 600] as [number, number, number] }] };
const BUILDINGS: BuildingsFile = {
  version: 'test',
  buildings: {
    Build_ConstructorMk1_C: { name: n('Constructor', 'Konstruktor'), category: 'production', footprint: box },
    Build_SmelterMk1_C: { name: n('Smelter', 'Schmelzofen'), category: 'production', footprint: box },
    Build_GeneratorCoal_C: { name: n('Coal-Powered Generator', 'Kohlekraftwerk'), category: 'power-gen', footprint: box },
  },
};

const building = (id: string, cls: string, x: number, prod: SnapshotBuilding['prod']): SnapshotBuilding => ({ id, cls, x, y: 10_000, z: 0, yaw: 0, prod });
const SNAP: FactorySnapshot = {
  v: 1, meta: { sessionName: 'Alpha', saveTime: Date.UTC(2026, 10, 8, 12), build: 1 },
  buildings: [
    building('plate', 'Build_ConstructorMk1_C', 10_000, { clock: 1.5, recipe: 'Recipe_IronPlate_C', productivity: 1, powerShards: 1, producing: true }),
    building('smelter', 'Build_SmelterMk1_C', 30_000, { clock: 1, recipe: 'Recipe_IngotIron_C', productivity: 0, issues: ['starved'] }),
    building('coal', 'Build_GeneratorCoal_C', 50_000, { clock: 1, productivity: 1 }),
  ],
  lightweight: [], splines: [], powerLines: [], pathNetworks: [], stations: [], vehicles: [], markers: [], crates: [],
};

const DATA: AnalysisData = {
  recipes: indexRecipes(RECIPES),
  machines: new Map(MACHINES.machines.map(m => [m.id, m])),
};
const LABELS = factoryLabels(DATA.recipes, MACHINES, null);
const flowOf = (b: SnapshotBuilding, patch: Partial<MachineFlow> = {}): MachineFlow => ({ ...machineFlow(b, DATA), ...patch });

/** The window on its own, as both popups show it. */
function Window({ m, onClose = () => {} }: { m: MachineFlow; onClose?: () => void }) {
  const fmt = useFactoryFormat();
  return <MachineWindow m={m} data={DATA} labels={LABELS} fmt={fmt} onClose={onClose} />;
}

const slots = (el: HTMLElement) => [...el.querySelectorAll('[data-slot]')].map(li => li.textContent);

beforeEach(() => {
  initI18n(['en']);
  localStorage.clear();
  useFactoryView.getState().reset();
  useFactoryMap.setState({ ...DEFAULT_VIEW, layers: { ...DEFAULT_VIEW.layers }, selection: null, pendingFocus: false, returnFocus: null, fittedSeq: 0, fitChangesSeq: 0 });
});
afterEach(() => vi.unstubAllGlobals());

describe('machine window', () => {
  it('shows a running machine as the game does: status, recipe, inputs → cycle → outputs, clock speed with shards, power', () => {
    render(<Window m={flowOf(SNAP.buildings[0]!)} />);
    expect(screen.getByRole('heading', { level: 3, name: 'Constructor' }).nextElementSibling).toHaveTextContent('Iron Plate · 30.0/min');
    const status = screen.getByRole('region', { name: 'Status' });
    expect(status).toHaveTextContent('Productivity100 %Running');
    const recipe = screen.getByRole('region', { name: 'Recipe' });
    expect(recipe).toHaveTextContent('Iron Plate');
    const production = screen.getByRole('region', { name: 'Production' });
    // 3 ingots per 6 s at 150 %: 45/min in, 30/min out; "actual of nominal".
    expect(slots(production)).toEqual(['Iron Ingot45.0/minof 45.0/min', 'Iron Plate30.0/minof 30.0/min']);
    expect(within(production).getByText('4 s per cycle')).toBeInTheDocument();
    expect(production.querySelector('[data-cycle]')).toHaveAttribute('data-cycle', 'running');
    const clock = screen.getByRole('region', { name: 'Clock speed' });
    expect(within(clock).getByTestId('machine-clock')).toHaveTextContent('150 %');
    expect(within(clock).getByRole('img', { name: '1 of 3 Power Shard slots used' }).querySelectorAll('[data-filled="true"]')).toHaveLength(1);
    // The constructor has one Somersloop slot, empty.
    expect(within(clock).getByRole('img', { name: '0 of 1 Somersloop slots used' })).toBeInTheDocument();
    // 4 MW × 1.5^1.32 = 6.8 MW.
    const power = screen.getByRole('region', { name: 'Power' });
    expect(power).toHaveTextContent('Power consumption while runningat 150 % clock speed6.8 MW');
  });

  it('marks a starved machine: stopped, the shortage in words, the input it lacks, a still cycle', () => {
    render(<Window m={flowOf(SNAP.buildings[1]!, { starvedFor: ['Desc_OreIron_C'] })} />);
    const status = screen.getByRole('region', { name: 'Status' });
    expect(status).toHaveTextContent('0 %Stopped');
    expect(within(status).getByTestId('machine-reasons')).toHaveTextContent('ReasonShortage');
    const production = screen.getByRole('region', { name: 'Production' });
    expect(slots(production)).toEqual(['Iron Ore · missing0.0/minof 30.0/min', 'Iron Ingot0.0/minof 30.0/min']);
    expect(production.querySelector('[data-slot="Desc_OreIron_C"]')).toHaveClass('border-conflict');
    expect(production.querySelector('[data-cycle]')).toHaveAttribute('data-cycle', 'still');
  });

  it('shows an extractor\'s node with its purity and a generator\'s fuels and power', () => {
    const miner = flowOf(building('m', 'Build_MinerMk2_C', 0, { clock: 1, productivity: 0.5, issues: ['blocked'] }), {
      outputs: [{ item: 'Desc_OreIron_C', nominal: 240, actual: 120, lost: 120 }], purity: 'pure',
      hints: [{ kind: 'beltLimits', belt: 'Build_ConveyorBeltMk2_C', rate: 120 }],
    });
    const { unmount } = render(<Window m={miner} />);
    const production = screen.getByRole('region', { name: 'Production' });
    expect(slots(production)).toEqual(['Iron OrePurePurity', 'Iron Ore120.0/minof 240.0/min']);
    expect(screen.getByRole('region', { name: 'Status' })).toHaveTextContent('50 %Part loadReasonSurplus');
    expect(screen.getByTestId('machine-hints')).toHaveTextContent('Conveyor Belt Mk2 limits it to 120.0/min');
    // 15 MW at 100 %.
    expect(screen.getByRole('region', { name: 'Power' })).toHaveTextContent('15 MW');
    unmount();

    render(<Window m={flowOf(SNAP.buildings[2]!)} />);
    const gen = screen.getByRole('region', { name: 'Production' });
    expect(within(gen).getByTestId('machine-fuels')).toHaveTextContent('Coal15.0/minplus Water 45.0 m³/min');
    expect(slots(gen)).toEqual(['⚡75 MWof 75 MW']);
    expect(screen.getByRole('region', { name: 'Power' })).toHaveTextContent('Power production75 MW of 75 MW');
    expect(screen.queryByRole('region', { name: 'Recipe' })).toBeNull();
  });

  it('fills the Somersloop slots and says the output boost; the power grows with its square', () => {
    render(<Window m={flowOf(building('s', 'Build_ConstructorMk1_C', 0, { clock: 1, recipe: 'Recipe_IronPlate_C', productivity: 1, somersloops: 1 }))} />);
    const clock = screen.getByRole('region', { name: 'Clock speed' });
    expect(within(clock).getByRole('img', { name: '1 of 1 Somersloop slots used' }).querySelectorAll('[data-filled="true"]')).toHaveLength(1);
    expect(clock).toHaveTextContent('Output ×2');
    expect(slots(screen.getByRole('region', { name: 'Production' }))).toEqual(['Iron Ingot30.0/minof 30.0/min', 'Iron Plate40.0/minof 40.0/min']);
    expect(screen.getByRole('region', { name: 'Power' })).toHaveTextContent('16 MW');
  });

  it('speaks German with the game\'s words', () => {
    initI18n(['de']);
    render(<Window m={flowOf(SNAP.buildings[0]!)} />);
    expect(screen.getByRole('heading', { level: 3, name: 'Konstruktor' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Status' })).toHaveTextContent('Produktivität100 %Läuft');
    expect(screen.getByRole('region', { name: 'Taktrate' })).toHaveTextContent('Energiefragmente');
    expect(screen.getByRole('region', { name: 'Strom' })).toHaveTextContent('Stromverbrauch im Betrieb');
  });
});

describe('popup placement', () => {
  const area = { left: 0, top: 0, right: 1000, bottom: 800 };
  const at = (x: number, y: number) => ({ left: x - 10, right: x + 10, top: y - 10, bottom: y + 10 });
  it('goes right of the building, else left, else below; never out of its area', () => {
    expect(placePopup(at(100, 400), 400, 300, area, 'side')).toEqual({ left: 122, top: 300 });
    expect(placePopup(at(900, 400), 400, 300, area, 'side')).toEqual({ left: 478, top: 300 });
    expect(placePopup(at(500, 100), 600, 300, area, 'side')).toEqual({ left: 392, top: 122 });
    // Too tall for the area: from its top.
    expect(placePopup(at(500, 400), 300, 900, area, 'side').top).toBe(8);
  });
  it('goes under a row on the page, else above it', () => {
    expect(placePopup(at(100, 100), 400, 300, area, 'below')).toEqual({ left: 90, top: 122 });
    expect(placePopup(at(100, 700), 400, 300, area, 'below')).toEqual({ left: 90, top: 378 });
  });
});

function setup() {
  const stub = stubFetch({
    'GET /api/me': { body: ME },
    [`GET /api/worlds/${W}`]: { body: WORLD },
    [`GET /api/worlds/${W}/snapshots`]: { body: [makeSummary(1, SNAP.meta.saveTime, 'Alpha')] },
    [`GET /api/worlds/${W}/snapshots/1`]: { body: SNAP },
    'GET /data/test/buildings.json': { body: BUILDINGS },
    'GET /data/test/collectibles.min.json': { body: DS },
    'GET /data/test/recipes.json': { body: RECIPES },
    'GET /data/test/machines.json': { body: MACHINES },
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ctx: WorldCtx = { worldId: W, world: WORLD, me: ME, index: indexDataset(DS), queryClient: client, navigate: () => {}, toast: { show: () => {} } };
  const wrap = (node: ReactNode) => render(
    <QueryClientProvider client={client}>
      <button type="button">Outside</button>
      <MapContainer crs={L.CRS.Simple} center={[-40, 40]} zoom={3}>
        <MapMachinePopup ctx={ctx} />
      </MapContainer>
      <FactoryInfo ctx={ctx} />
      {node}
    </QueryClientProvider>,
  );
  return { ctx, wrap, stub };
}

const popup = (name: string) => screen.findByRole('dialog', { name });

describe('machine popup on the factory map', () => {
  beforeEach(() => useFactoryMap.setState({ visible: true }));

  it('opens on a click on a machine instead of the info window, with the machine\'s figures', async () => {
    setup().wrap(null);
    act(() => clickFactory({ kind: 'building', id: 'plate' }, null));
    const dialog = await popup('Constructor');
    expect(dialog).toHaveAttribute('data-placement', 'anchored');
    expect(dialog).not.toHaveAttribute('aria-modal', 'true');
    expect(within(dialog).getByRole('region', { name: 'Status' })).toHaveTextContent('100 %Running');
    expect(slots(within(dialog).getByRole('region', { name: 'Production' }))).toEqual(['Iron Ingot45.0/minof 45.0/min', 'Iron Plate30.0/minof 30.0/min']);
    expect(within(dialog).getByTestId('machine-clock')).toHaveTextContent('150 %');
    expect(screen.queryByRole('complementary')).toBeNull();
  });

  it('closes on a click outside, but not on a click inside', async () => {
    setup().wrap(null);
    const user = userEvent.setup();
    act(() => clickFactory({ kind: 'building', id: 'smelter' }, null));
    const dialog = await popup('Smelter');
    await user.click(within(dialog).getByRole('region', { name: 'Production' }));
    expect(screen.getByRole('dialog', { name: 'Smelter' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Outside' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(useFactoryMap.getState().selection).toBeNull();
  });

  it('moves to another machine; a click that opens one does not close it', async () => {
    const { wrap } = setup();
    const user = userEvent.setup();
    wrap(<button type="button" onClick={() => clickFactory({ kind: 'building', id: 'coal' }, null)}>Pick coal</button>);
    act(() => clickFactory({ kind: 'building', id: 'plate' }, null));
    await popup('Constructor');
    await user.click(screen.getByRole('button', { name: 'Pick coal' }));
    const gen = await popup('Coal-Powered Generator');
    expect(within(gen).getByTestId('machine-fuels')).toHaveTextContent('Coal15.0/min');
    expect(screen.queryByRole('dialog', { name: 'Constructor' })).toBeNull();
    // Empty ground closes it.
    act(() => clickFactory(null, null));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closes with × and with Esc, from inside and from the map', async () => {
    setup().wrap(null);
    const user = userEvent.setup();
    act(() => clickFactory({ kind: 'building', id: 'plate' }, null));
    let dialog = await popup('Constructor');
    await user.click(within(dialog).getByRole('button', { name: 'Close Constructor' }));
    expect(screen.queryByRole('dialog')).toBeNull();

    act(() => clickFactory({ kind: 'building', id: 'plate' }, null));
    dialog = await popup('Constructor');
    within(dialog).getByRole('button', { name: 'Close Constructor' }).focus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();

    act(() => clickFactory({ kind: 'building', id: 'plate' }, null));
    await popup('Constructor');
    expect(escapeStepsBack({ key: 'Escape', defaultPrevented: false, target: document.body })).toBe(true);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('takes the focus when opened from a button and gives it back on close', async () => {
    const { wrap } = setup();
    const user = userEvent.setup();
    wrap(<button type="button" onClick={e => useFactoryMap.getState().select({ kind: 'building', id: 'smelter' }, { focus: true, opener: e.currentTarget })}>Open</button>);
    const opener = screen.getByRole('button', { name: 'Open' });
    await user.click(opener);
    const dialog = await popup('Smelter');
    await waitFor(() => expect(within(dialog).getByRole('heading', { name: 'Smelter' })).toHaveFocus());
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(opener).toHaveFocus();
  });

  it('is a sheet over the lower map on phones', async () => {
    stubMatchMedia({ [MOBILE]: true });
    setup().wrap(null);
    const user = userEvent.setup();
    act(() => clickFactory({ kind: 'building', id: 'plate' }, null));
    const dialog = await popup('Constructor');
    expect(dialog).toHaveAttribute('data-placement', 'sheet');
    expect(dialog).toHaveClass('ficsmap-machine-sheet', 'bottom-[136px]');
    await user.click(screen.getByRole('button', { name: 'Outside' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
