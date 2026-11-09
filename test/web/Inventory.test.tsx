import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import L from 'leaflet';
import type { ReactNode } from 'react';
import { MapContainer } from 'react-leaflet';
import { getI18n } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import type { MeDto, WorldDto } from '../../src/shared/api.js';
import { indexBuildings, type BuildingsFile } from '../../src/shared/buildings.js';
import { indexDataset, type Dataset } from '../../src/shared/dataset.js';
import { machineFlow, type AnalysisData } from '../../src/shared/factory/analysis.js';
import type { FactorySnapshot, SnapshotBuilding } from '../../src/shared/factory/snapshot.js';
import type { MachineData, MachineEntry } from '../../src/shared/machines.js';
import { indexRecipes, type RecipeData } from '../../src/shared/recipes.js';
import type { WorldCtx } from '../../src/web/app/feature.js';
import { initI18n } from '../../src/web/app/i18n/index.js';
import { factoryLabels } from '../../src/web/features/factory/data.js';
import { useFactoryFormat } from '../../src/web/features/factory/format.js';
import { MachineWindow } from '../../src/web/features/factory/MachineWindow.js';
import { FactoryInfo } from '../../src/web/features/factory/map/FactoryInfo.js';
import { clickFactory, escapeStepsBack } from '../../src/web/features/factory/map/FactoryMapLayer.js';
import { MapMachinePopup } from '../../src/web/features/factory/map/MapMachinePopup.js';
import { pickFactory } from '../../src/web/features/factory/map/pick.js';
import { buildScene } from '../../src/web/features/factory/map/scene.js';
import { DEFAULT_VIEW, useFactoryMap } from '../../src/web/features/factory/map/useFactoryMap.js';
import { storageEntries } from '../../src/web/features/factory/search.js';
import { StorageSection } from '../../src/web/features/factory/StorageSection.js';
import { StorageWindow } from '../../src/web/features/factory/StorageWindow.js';
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
    { id: 'Desc_IronIngot_C', name: n('Iron Ingot', 'Eisenbarren'), form: 'solid' },
    { id: 'Desc_IronPlate_C', name: n('Iron Plate', 'Eisenplatte'), form: 'solid' },
    { id: 'Desc_SteelPlate_C', name: n('Steel Beam', 'Stahlträger'), form: 'solid' },
    { id: 'Desc_Wire_C', name: n('Wire', 'Draht'), form: 'solid' },
    { id: 'Desc_CopperIngot_C', name: n('Copper Ingot', 'Kupferbarren'), form: 'solid' },
    { id: 'Desc_Coal_C', name: n('Coal', 'Kohle'), form: 'solid' },
    { id: 'Desc_Water_C', name: n('Water', 'Wasser'), form: 'liquid' },
  ],
  recipes: [
    { id: 'Recipe_IronPlate_C', name: n('Iron Plate', 'Eisenplatte'), alternate: false, machine: 'Build_ConstructorMk1_C', duration: 6,
      ingredients: [{ item: 'Desc_IronIngot_C', amount: 3 }], products: [{ item: 'Desc_IronPlate_C', amount: 2 }] },
  ],
  machines: [{ id: 'Build_ConstructorMk1_C', name: n('Constructor', 'Konstruktor'), power: 4, powerExponent: 1.321929 }],
  extractors: [],
};
const entry = (id: string, category: MachineEntry['category'], stats: MachineEntry['stats'], name = n(id)): MachineEntry =>
  ({ id, category, name, description: n(''), wikiPage: id, stats, unlockedBy: [] });
const MACHINES: MachineData = {
  format: 1, source: 'test', items: {}, recipes: [],
  machines: [
    entry('Build_ConstructorMk1_C', 'production', { powerUse: 4 }, n('Constructor', 'Konstruktor')),
    entry('Build_GeneratorCoal_C', 'power', {
      powerProduction: 75, fuels: [{ item: 'Desc_Coal_C', perMinute: 15, supplement: { item: 'Desc_Water_C', amount: 45 } }],
    }, n('Coal-Powered Generator', 'Kohlekraftwerk')),
  ],
};
const box = { source: 'clearance' as const, boxes: [{ min: [-400, -500, 0] as [number, number, number], max: [400, 500, 600] as [number, number, number] }] };
const BUILDINGS: BuildingsFile = {
  version: 'test',
  buildings: {
    Build_ConstructorMk1_C: { name: n('Constructor', 'Konstruktor'), category: 'production', footprint: box },
    Build_GeneratorCoal_C: { name: n('Coal-Powered Generator', 'Kohlekraftwerk'), category: 'power-gen', footprint: box },
    Build_StorageContainerMk2_C: { name: n('Industrial Storage Container', 'Industrieller Lagercontainer'), category: 'storage', footprint: box, icon: 'Desc_StorageContainerMk2_C' },
    Build_PipeStorageTank_C: { name: n('Fluid Buffer', 'Flüssigkeitsspeicher'), category: 'storage', footprint: box },
  },
};

const at = (id: string, cls: string, x: number, extra: Partial<SnapshotBuilding> = {}): SnapshotBuilding => ({ id, cls, x, y: 10_000, z: 0, yaw: 0, ...extra });
const SNAP: FactorySnapshot = {
  v: 1, meta: { sessionName: 'Alpha', saveTime: Date.UTC(2026, 10, 8, 12), build: 1, inventories: true },
  buildings: [
    at('plate', 'Build_ConstructorMk1_C', 10_000, {
      prod: { clock: 1, recipe: 'Recipe_IronPlate_C', productivity: 1, producing: true },
      in: { slots: 1, items: [['Desc_IronIngot_C', 47]] }, out: { slots: 1, items: [['Desc_IronPlate_C', 12]] },
    }),
    at('coal', 'Build_GeneratorCoal_C', 30_000, { prod: { clock: 1, productivity: 1 }, fuel: { slots: 2, items: [['Desc_Coal_C', 50], ['Desc_Water_C', 50_000]] } }),
    at('dry', 'Build_GeneratorCoal_C', 50_000, { prod: { clock: 1, productivity: 0, issues: ['noFuel'] } }),
    at('box', 'Build_StorageContainerMk2_C', 70_000, { inv: { slots: 48, items: [['Desc_SteelPlate_C', 200, 3], ['Desc_Wire_C', 74]] } }),
    at('box2', 'Build_StorageContainerMk2_C', 90_000, { inv: { slots: 48, items: [['Desc_Wire_C', 500, 2], ['Desc_CopperIngot_C', 3]] } }),
    at('tank', 'Build_PipeStorageTank_C', 110_000, { inv: { slots: 1, items: [['Desc_Water_C', 402_661]] } }),
  ],
  lightweight: [], splines: [], powerLines: [], pathNetworks: [], stations: [], vehicles: [], markers: [],
  crates: [{ id: 'BP_Crate_C_1', x: 130_000, y: 10_000, z: 0, kind: 'CT_DeathCrate', inv: { slots: 3, items: [['Desc_Wire_C', 20], ['Desc_IronPlate_C', 200, 2]] } }],
  depot: [['Desc_Wire_C', 1000], ['Desc_Coal_C', 3]],
};

const DATA: AnalysisData = { recipes: indexRecipes(RECIPES), machines: new Map(MACHINES.machines.map(m => [m.id, m])) };
const LABELS = factoryLabels(DATA.recipes, MACHINES, indexBuildings(BUILDINGS));
const byId = (id: string) => SNAP.buildings.find(b => b.id === id)!;

function Storage({ id, onClose = () => {} }: { id: string; onClose?: () => void }) {
  const fmt = useFactoryFormat();
  const b = byId(id);
  return <StorageWindow name={LABELS.building(b.cls, fmt.lang)} picture={LABELS.buildingPicture(b.cls)} inv={b.inv}
    capacityM3={b.cls === 'Build_PipeStorageTank_C' ? 400 : undefined} labels={LABELS} fmt={fmt} onClose={onClose} />;
}
function Machine({ id, inventories = true }: { id: string; inventories?: boolean }) {
  const fmt = useFactoryFormat();
  return <MachineWindow m={machineFlow(byId(id), DATA)} data={DATA} labels={LABELS} fmt={fmt} onClose={() => {}} building={byId(id)} inventories={inventories} />;
}
const counts = (el: HTMLElement) => [...el.querySelectorAll('[data-slot-item]')].map(li => `${li.getAttribute('data-slot-item')} ${li.querySelector('[aria-hidden="true"].absolute')?.textContent}`);

beforeEach(() => {
  initI18n(['en']);
  localStorage.clear();
  useFactoryView.getState().reset();
  useFactoryMap.setState({ ...DEFAULT_VIEW, layers: { ...DEFAULT_VIEW.layers }, selection: null, pendingFocus: false, returnFocus: null, fittedSeq: 0, fitChangesSeq: 0 });
});
afterEach(() => vi.unstubAllGlobals());

describe('storage window', () => {
  it('shows the slots as a grid with picture and count, the free ones empty, the fill and a list per item', () => {
    render(<Storage id="box" />);
    expect(screen.getByRole('heading', { level: 3, name: 'Industrial Storage Container' })).toBeInTheDocument();
    expect(screen.getByTestId('inventory-fill')).toHaveTextContent('4 of 48 slots');
    const grid = screen.getByRole('list', { name: 'Slots' });
    expect(counts(grid)).toEqual(['Desc_SteelPlate_C 200', 'Desc_SteelPlate_C 200', 'Desc_SteelPlate_C 200', 'Desc_Wire_C 74']);
    expect(grid.querySelectorAll('[data-slot-free]')).toHaveLength(44);
    // the name and count of a slot for screen readers
    expect(within(grid).getAllByText('Steel Beam: 200')).toHaveLength(3);
    const summary = screen.getByTestId('inventory-summary');
    expect([...summary.querySelectorAll('li')].map(li => li.textContent)).toEqual(['Steel Beam6003 stacks', 'Wire741 stack']);
  });

  it('a fluid buffer: its fluid in m³ against its capacity, shown full when the game filled it a little over', () => {
    render(<Storage id="tank" />);
    expect(screen.getByTestId('inventory-fill')).toHaveTextContent('400 of 400 m³');
    expect(counts(screen.getByRole('list', { name: 'Slots' }))).toEqual(['Desc_Water_C 400 m³']);
    // the list names the fluid
    expect(screen.getByTestId('inventory-summary')).toHaveTextContent('Water400 m³1 stack');
  });

  it('says so when the save was imported before contents were read, and when it is empty', () => {
    const fmt = { lang: 'en' } as never;
    const { unmount } = render(<StorageWindow name="Box" inv={undefined} labels={LABELS} fmt={fmt} onClose={() => {}} />);
    expect(screen.getByTestId('inventory-unknown')).toHaveTextContent('Import it again');
    unmount();
    function Empty() {
      return <StorageWindow name="Box" inv={{ slots: 24, items: [] }} labels={LABELS} fmt={useFactoryFormat()} onClose={() => {}} />;
    }
    render(<Empty />);
    expect(screen.getByTestId('inventory-fill')).toHaveTextContent('0 of 24 slots');
    expect(screen.getByText('Empty')).toBeInTheDocument();
  });

  it('speaks German', () => {
    initI18n(['de']);
    render(<Storage id="box" />);
    expect(screen.getByTestId('inventory-fill')).toHaveTextContent('4 von 48 Plätzen');
    expect(screen.getByTestId('inventory-summary')).toHaveTextContent('Stahlträger6003 Stapel');
  });
});

describe('machine window with what lies in its slots', () => {
  it('puts the count on the input and output pictures, as in the game', () => {
    render(<Machine id="plate" />);
    const production = screen.getByRole('region', { name: 'Production' });
    expect([...production.querySelectorAll('[data-slot-count]')].map(e => e.textContent)).toEqual(['47', '12']);
    expect(within(production).getByText('47 in the slot')).toBeInTheDocument();
  });

  it('shows no counts for a snapshot without inventories', () => {
    render(<Machine id="plate" inventories={false} />);
    expect(screen.getByRole('region', { name: 'Production' }).querySelectorAll('[data-slot-count]')).toHaveLength(0);
  });

  it('a generator: the loaded fuel with its count, the water beside it; nothing loaded says so', () => {
    const { unmount } = render(<Machine id="coal" />);
    const fuels = screen.getByTestId('machine-fuels');
    expect(fuels.querySelector('[data-loaded]')).toHaveAttribute('data-fuel', 'Desc_Coal_C');
    expect(fuels).toHaveTextContent('Loaded: 50');
    expect(fuels).toHaveTextContent('plus Water 45.0 m³/min · Loaded: 50 m³');
    expect(screen.queryByTestId('machine-no-fuel')).toBeNull();
    unmount();
    render(<Machine id="dry" />);
    expect(screen.getByTestId('machine-no-fuel')).toHaveTextContent('No fuel loaded');
  });
});

describe('storage section of the Fabrik page', () => {
  function Section({ snapshot = SNAP }: { snapshot?: FactorySnapshot }) {
    return <MemoryRouter><StorageSection worldId={W} snapshot={snapshot} labels={LABELS} fmt={useFactoryFormat()} /></MemoryRouter>;
  }
  const rows = () => [...screen.getByTestId('storage-table').querySelectorAll('tbody tr')].map(r => r.getAttribute('data-item'));

  it('totals every item across the storages, most first, with slots and storages; the Dimensional Depot apart', () => {
    render(<Section />);
    expect(screen.getByRole('heading', { name: 'Storage' }).nextElementSibling).toHaveTextContent('3 storages · 8 of 97 slots used');
    expect(rows()).toEqual(['Desc_Wire_C', 'Desc_SteelPlate_C', 'Desc_Water_C', 'Desc_CopperIngot_C']);
    const wire = screen.getByTestId('storage-table').querySelector('[data-item="Desc_Wire_C"]')!;
    expect(wire).toHaveTextContent('WireStored1,074Slots3Storages2');
    expect(within(wire as HTMLElement).getAllByRole('button', { name: 'Show Wire on the map' })[0]).toBeEnabled();
    // the fluid in m³
    expect(screen.getByTestId('storage-table').querySelector('[data-item="Desc_Water_C"]')).toHaveTextContent('403 m³');
    expect(screen.getByTestId('storage-depot')).toHaveTextContent('Wire1,000Coal3');
  });

  it('searches by name (either language, any case): the table and the depot, with a count', async () => {
    const user = userEvent.setup();
    render(<Section />);
    await user.type(screen.getByRole('searchbox', { name: 'Find a stored item' }), 'DRAHT');
    expect(rows()).toEqual(['Desc_Wire_C']);
    expect(screen.getByTestId('storage-showing')).toHaveTextContent('1 of 4 items');
    expect(screen.getByTestId('storage-depot')).not.toHaveTextContent('Coal');
    await user.clear(screen.getByRole('searchbox'));
    await user.type(screen.getByRole('searchbox'), 'nothing like it');
    expect(screen.getByTestId('storage-no-match')).toHaveTextContent('No stored item matches “nothing like it”.');
  });

  it('"On the map" marks the storages holding the item', async () => {
    const user = userEvent.setup();
    render(<Section />);
    const wire = screen.getByTestId('storage-table').querySelector('[data-item="Desc_Wire_C"]') as HTMLElement;
    await user.click(within(wire).getAllByRole('button', { name: 'Show Wire on the map' }).at(-1)!);
    expect(useFactoryView.getState().highlight).toEqual(['box2', 'box']);
  });

  it('a snapshot from before contents were read says so', () => {
    render(<Section snapshot={{ ...SNAP, meta: { ...SNAP.meta, inventories: undefined } }} />);
    expect(screen.getByTestId('storage-unknown')).toBeInTheDocument();
  });
});

describe('header search', () => {
  it('finds an item in storage by name: how much in how many storages; choosing it marks them on the map', () => {
    const entries = storageEntries(SNAP, LABELS, getI18n());
    const wire = entries.find(e => e.id === 'storage:Desc_Wire_C')!;
    expect(wire).toMatchObject({ label: 'Wire', detail: '1,074 in 2 storages', kindKey: 'factory.storage.searchKind' });
    expect(wire.terms).toEqual(['Wire', 'Draht', 'Desc_Wire_C']);
    expect(entries.find(e => e.id === 'storage:Desc_Water_C')!.detail).toBe('403 m³ in 1 storage');
    const navigate = vi.fn();
    wire.onSelect!({ worldId: W, navigate } as unknown as WorldCtx);
    expect(useFactoryView.getState().highlight).toEqual(['box2', 'box']);
    expect(navigate).toHaveBeenCalledWith(`/w/${W}`);
    initI18n(['de']);
    expect(storageEntries(SNAP, LABELS, getI18n()).find(e => e.id === 'storage:Desc_Wire_C')).toMatchObject({ label: 'Draht', detail: '1.074 in 2 Lagern' });
  });
});

describe('crates and storage on the factory map', () => {
  beforeEach(() => useFactoryMap.setState({ visible: true }));

  function setup() {
    stubFetch({
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
    return (node: ReactNode = null) => render(
      <QueryClientProvider client={client}>
        <button type="button">Outside</button>
        <MapContainer crs={L.CRS.Simple} center={[-40, 40]} zoom={3}>
          <MapMachinePopup ctx={ctx} />
        </MapContainer>
        <FactoryInfo ctx={ctx} />
        {node}
      </QueryClientProvider>,
    );
  }
  const popup = (name: string) => screen.findByRole('dialog', { name });

  it('a crate is picked on the map where it lies', () => {
    const scene = buildScene(SNAP, indexBuildings(BUILDINGS), DS.bounds);
    const c = scene.crateById.get('BP_Crate_C_1')!;
    expect(pickFactory(scene, DEFAULT_VIEW.layers, c.cx, c.cy, 64, 6)).toEqual({ kind: 'crate', id: 'BP_Crate_C_1' });
    expect(pickFactory(scene, { ...DEFAULT_VIEW.layers, crates: false }, c.cx, c.cy, 64, 6)).toBeNull();
  });

  it('a death crate opens as a popup like a machine and closes on a click outside, × and Esc', async () => {
    const wrap = setup();
    wrap();
    const user = userEvent.setup();
    act(() => clickFactory({ kind: 'crate', id: 'BP_Crate_C_1' }, null, null, true));
    let dialog = await popup('Death crate');
    expect(dialog).toHaveAttribute('data-placement', 'anchored');
    expect(within(dialog).getByTestId('inventory-fill')).toHaveTextContent('3 of 3 slots');
    expect(screen.queryByRole('complementary')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Outside' }));
    expect(screen.queryByRole('dialog')).toBeNull();

    act(() => clickFactory({ kind: 'crate', id: 'BP_Crate_C_1' }, null, null, true));
    dialog = await popup('Death crate');
    await user.click(within(dialog).getByRole('button', { name: 'Close Death crate' }));
    expect(screen.queryByRole('dialog')).toBeNull();

    act(() => clickFactory({ kind: 'crate', id: 'BP_Crate_C_1' }, null, null, true));
    await popup('Death crate');
    expect(escapeStepsBack({ key: 'Escape', defaultPrevented: false, target: document.body })).toBe(true);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('a storage container opens its contents in the popup, not in the info window; another click moves it', async () => {
    const wrap = setup();
    wrap();
    act(() => clickFactory({ kind: 'building', id: 'box' }, null, null, true));
    const dialog = await popup('Industrial Storage Container');
    expect(within(dialog).getByTestId('inventory-fill')).toHaveTextContent('4 of 48 slots');
    expect(screen.queryByRole('complementary')).toBeNull();
    act(() => clickFactory({ kind: 'building', id: 'plate' }, null, null, true));
    const machine = await popup('Constructor');
    expect([...machine.querySelectorAll('[data-slot-count]')].map(e => e.textContent)).toEqual(['47', '12']);
  });

  it('is a sheet on phones', async () => {
    stubMatchMedia({ [MOBILE]: true });
    setup()();
    act(() => clickFactory({ kind: 'crate', id: 'BP_Crate_C_1' }, null, null, true));
    const dialog = await popup('Death crate');
    expect(dialog).toHaveAttribute('data-placement', 'sheet');
    expect(dialog).toHaveClass('ficsmap-machine-sheet');
  });

  it('German: "Todeskiste"', async () => {
    initI18n(['de']);
    setup()();
    act(() => clickFactory({ kind: 'crate', id: 'BP_Crate_C_1' }, null, null, true));
    const dialog = await popup('Todeskiste');
    expect(within(dialog).getByTestId('inventory-fill')).toHaveTextContent('3 von 3 Plätzen');
  });
});
