import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import L from 'leaflet';
import { MapContainer, useMap } from 'react-leaflet';
import type { MeDto, ResourceNodesDto, WorldDto } from '../../src/shared/api.js';
import { indexDataset, type Dataset } from '../../src/shared/dataset.js';
import { worldToLatLng } from '../../src/shared/geo.js';
import type { GameExtractor, RecipeData } from '../../src/shared/recipes.js';
import { PURITIES, type ResourceNodesFile } from '../../src/shared/resourceNodes.js';
import type { WorldCtx } from '../../src/web/app/feature.js';
import { initI18n } from '../../src/web/app/i18n/index.js';
import { loadResourceNodeView } from '../../src/web/app/persist.js';
import { queryKeys } from '../../src/web/app/queryKeys.js';
import {
  contrastOn, drawExtractor, drawNode, luminance, nodeRadius, nodeSize, pipOffsets, ringColor, type DrawNode, type NodePalette,
} from '../../src/web/features/resourceNodes/drawNode.js';
import { resourceNodesFeature } from '../../src/web/features/resourceNodes/index.js';
import { NodeCanvasLayer } from '../../src/web/features/resourceNodes/NodeCanvasLayer.js';
import { ToolButton } from '../../src/web/features/worlds/ToolsNav.js';
import { extractorTag, ResourceNodeLayer } from '../../src/web/features/resourceNodes/ResourceNodeLayer.js';
import { ResourceNodesPanel } from '../../src/web/features/resourceNodes/ResourceNodesPanel.js';
import { sortResources } from '../../src/web/features/resourceNodes/resourceStyle.js';
import { useNodeLayer } from '../../src/web/features/resourceNodes/useResourceNodes.js';
import { stubFetch, type StubReply } from './fetchStub.js';

const W = '6f1c2b0e-8a43-4f5e-9d1b-2c3d4e5f6a7b';
const ME: MeDto = { id: 1, displayName: 'Nick', avatarUrl: null, email: null, datasetVersion: 'test' };
const WORLD: WorldDto = {
  id: W, name: 'Alpha', isOwner: true, rev: 1, datasetVersion: 'test', owner: { id: 1, displayName: 'Nick' }, members: [], lastImport: null,
};
const BOUNDS = { minX: 0, minY: 0, maxX: 100_000, maxY: 100_000 };
const DS: Dataset = {
  version: 'test', build: 1, bounds: BOUNDS, mapId: 'm', podRequirementsKnown: true,
  biomes: [{ id: 'b', name: { en: 'B', de: 'B' } }], items: [['S1', 'somersloop', 1000, 1000, 0, 0, 1]], aliases: {},
};
const FILE: ResourceNodesFile = {
  version: 'test',
  resources: [{ id: 'Desc_OreIron_C', name: 'Iron Ore' }, { id: 'Desc_Water_C', name: 'Water' }, { id: 'Desc_Unobtainium_C', name: 'Unobtainium' }],
  nodes: [
    ['N1', 'node', 'Desc_OreIron_C', 'impure', 50_000, 50_000, 1234],
    ['N2', 'node', 'Desc_OreIron_C', 'pure', 10_000, 10_000, 0],
    ['N3', 'node', 'Desc_Unobtainium_C', 'normal', 20_000, 10_000, 0],
    ['C1', 'core', 'Desc_Water_C', null, 80_000, 80_000, 0],
    ['S1', 'satellite', 'Desc_Water_C', 'pure', 80_500, 80_000, 0, 'C1'],
  ],
};
const NO_OVERRIDES: ResourceNodesDto = { overrides: [], settings: null, extractors: [] };

/** The dataset's pictures: iron has one, the other resources do not. */
const ICONS = { format: 1, sizes: [64, 256], icons: ['Desc_OreIron_C'] };
const EXP = 1.321929;
const extractor = (id: string, en: string, de: string, kind: GameExtractor['kind'], rate: number, resources: string[], extra: Partial<GameExtractor> = {}): GameExtractor =>
  ({ id, name: { en, de }, kind, rate, power: 0, powerExponent: EXP, resources, onNode: true, ...extra });
/** The game's extractor rates (recipes.json of 1.2.5.0) for the resources of FILE. */
const RECIPES: RecipeData = {
  format: 1, source: 'test', clock: { min: 0.01, perShard: 0.5 }, recipes: [], machines: [],
  items: [
    { id: 'Desc_OreIron_C', name: { en: 'Iron Ore', de: 'Eisenerz' }, form: 'solid' },
    { id: 'Desc_Water_C', name: { en: 'Water', de: 'Wasser' }, form: 'liquid' },
    { id: 'Desc_LiquidOil_C', name: { en: 'Crude Oil', de: 'Rohöl' }, form: 'liquid' },
  ],
  extractors: [
    extractor('Build_MinerMk1_C', 'Miner Mk.1', 'Miner Mk.1', 'miner', 60, ['Desc_OreIron_C'], { tier: 1 }),
    extractor('Build_OilPump_C', 'Oil Extractor', 'Ölpumpe', 'pump', 120, ['Desc_LiquidOil_C']),
    extractor('Build_MinerMk2_C', 'Miner Mk.2', 'Miner Mk.2', 'miner', 120, ['Desc_OreIron_C'], { tier: 2 }),
    extractor('Build_MinerMk3_C', 'Miner Mk.3', 'Miner Mk.3', 'miner', 240, ['Desc_OreIron_C'], { tier: 3 }),
    extractor('Build_WaterPump_C', 'Water Extractor', 'Wasserextraktor', 'pump', 120, ['Desc_Water_C'], { onNode: false }),
    extractor('Build_FrackingExtractor_C', 'Resource Well Extractor', 'Quellenextraktor', 'well', 60, ['Desc_LiquidOil_C', 'Desc_Water_C']),
  ],
};
/** Routes for the dataset's pictures and recipe data. */
const EXTRAS = { 'GET /data/test/icons/items/index.json': { body: ICONS }, 'GET /data/test/recipes.json': { body: RECIPES } };

function setup(opts: { file?: boolean; overrides?: ResourceNodesDto; routes?: Record<string, StubReply> } = {}) {
  const { calls } = stubFetch({
    ...(opts.file === false ? {} : { 'GET /data/test/resource-nodes.json': { body: FILE } }),
    [`GET /api/worlds/${W}/resource-nodes`]: { body: opts.overrides ?? NO_OVERRIDES },
    ...opts.routes,
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(queryKeys.me(), ME);
  const ctx: WorldCtx = {
    worldId: W, world: WORLD, me: ME, index: indexDataset(DS), queryClient: client, navigate: () => {}, toast: { show: () => {} },
  };
  const wrap = (ui: React.ReactNode) => render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
  return { ctx, client, wrap, calls };
}

const resetLayer = (visible = false) => useNodeLayer.setState({ visible, hiddenResources: [], purities: ['impure', 'normal', 'pure'], occupancy: 'all' });
const row = (name: RegExp) => screen.getByRole('button', { name });

beforeAll(() => { initI18n(['en']); });
beforeEach(() => {
  localStorage.clear();
  resetLayer();
});
afterEach(() => vi.unstubAllGlobals());

describe('resource node switch in the tool navigation', () => {
  const tool = resourceNodesFeature.tools![0]!;
  it('toggles the layer and remembers it per device', async () => {
    const { ctx, wrap } = setup();
    wrap(<ToolButton tool={tool} ctx={ctx} />);
    const button = await screen.findByRole('button', { name: 'Resources' });
    expect(button).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(button);
    expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(loadResourceNodeView().visible).toBe(true);
  });

  it('is not shown for a dataset without resource nodes', async () => {
    const { ctx, wrap, calls } = setup({ file: false });
    const { container } = wrap(<ToolButton tool={tool} ctx={ctx} />);
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(container).toBeEmptyDOMElement();
  });
});

describe('ResourceNodesPanel', () => {
  it('lists the resources in style order with counts, unknown ones with their dataset name', async () => {
    const { wrap } = setup();
    wrap(<ResourceNodesPanel worldId={W} />);
    expect(await screen.findByRole('button', { name: /Iron Ore\s*2/ })).toHaveAttribute('aria-pressed', 'true');
    expect(row(/Water\s*1/)).toBeInTheDocument();
    expect(row(/Unobtainium\s*1/)).toBeInTheDocument();
    expect(row(/Impure\s*1/)).toBeInTheDocument();
    expect(row(/Normal\s*1/)).toBeInTheDocument();
    expect(row(/Pure\s*2/)).toBeInTheDocument();
  });

  it('filters by resource and purity with faceted counts, and remembers the filter', async () => {
    const user = userEvent.setup();
    const { wrap } = setup();
    wrap(<ResourceNodesPanel worldId={W} />);
    await user.click(await screen.findByRole('button', { name: /Iron Ore/ }));
    expect(row(/Iron Ore/)).toHaveAttribute('aria-pressed', 'false');
    // Purity counts now leave out iron; resource counts are unchanged.
    expect(row(/Impure\s*0/)).toBeInTheDocument();
    expect(row(/Pure\s*1/)).toBeInTheDocument();
    expect(row(/Iron Ore\s*2/)).toBeInTheDocument();
    await user.click(row(/Pure\s*1/));
    expect(row(/Iron Ore\s*1/)).toBeInTheDocument();
    expect(loadResourceNodeView()).toEqual({ visible: false, hiddenResources: ['Desc_OreIron_C'], purities: ['impure', 'normal'], occupancy: 'all' });
  });

  it('Alt-click shows only one resource; All and None switch every resource', async () => {
    const user = userEvent.setup();
    const { wrap } = setup();
    wrap(<ResourceNodesPanel worldId={W} />);
    await user.keyboard('{Alt>}');
    await user.click(await screen.findByRole('button', { name: /Water/ }));
    await user.keyboard('{/Alt}');
    expect(row(/Water/)).toHaveAttribute('aria-pressed', 'true');
    expect(row(/Iron Ore/)).toHaveAttribute('aria-pressed', 'false');
    await user.click(screen.getByRole('button', { name: 'None' }));
    expect(row(/Water/)).toHaveAttribute('aria-pressed', 'false');
    await user.click(screen.getByRole('button', { name: 'All' }));
    expect(row(/Iron Ore/)).toHaveAttribute('aria-pressed', 'true');
  });

  it('switches the layer like the map control', async () => {
    const { wrap } = setup();
    wrap(<ResourceNodesPanel worldId={W} />);
    await userEvent.click(await screen.findByRole('button', { name: /Show on map/ }));
    expect(useNodeLayer.getState().visible).toBe(true);
  });

  it('says what the last save import changed', async () => {
    const { wrap } = setup({ overrides: { overrides: [['N2', 'Desc_Water_C', 'impure']], settings: null, extractors: [] } });
    wrap(<ResourceNodesPanel worldId={W} />);
    expect(await screen.findByText(/1 node differs from the default map/)).toBeInTheDocument();
    expect(row(/Water\s*2/)).toBeInTheDocument();
    expect(row(/Iron Ore\s*1/)).toBeInTheDocument();
  });

  it('warns when the save says randomised but has no node data, with the game\'s names for the settings', async () => {
    const { wrap } = setup({ overrides: { overrides: [], settings: { randomization: 'NRM_BasicReach', purity: null, seed: 5 }, extractors: [] } });
    wrap(<ResourceNodesPanel worldId={W} />);
    const note = await screen.findByRole('note');
    expect(note).toHaveTextContent('randomised resource nodes (Resource Node Randomization: Basic Resource Rich)');
    expect(note.textContent).not.toMatch(/NRM_|NPS_/);
  });

  it('warns for changed purities alone, in German with the game\'s German names', async () => {
    initI18n(['de']);
    try {
      const { wrap } = setup({ overrides: { overrides: [], settings: { randomization: null, purity: 'NPS_Increase', seed: 7 }, extractors: [] } });
      wrap(<ResourceNodesPanel worldId={W} />);
      expect(await screen.findByRole('note')).toHaveTextContent('zufälligen Rohstoffvorkommen gestartet (Reinheit von Rohstoffvorkommen: „Hauptsächlich rein“)');
    } finally {
      initI18n(['en']);
    }
  });

  it('shows no randomisation note for a save that only stores a seed', async () => {
    const { wrap } = setup({ overrides: { overrides: [], settings: { randomization: null, purity: null, seed: 42 }, extractors: [] } });
    wrap(<ResourceNodesPanel worldId={W} />);
    expect(await screen.findByRole('button', { name: /Show on map/ })).toBeInTheDocument();
    expect(screen.queryByRole('note')).toBeNull();
  });

  describe('extractors from the last save import', () => {
    const WITH_EXTRACTORS: ResourceNodesDto = {
      overrides: [], settings: null,
      extractors: [['C1', 'pressurizer', 1, 0], ['N1', 'miner2', 2.25, 3], ['S1', 'well', 1.5, 1], ['Gone', 'miner1', 1, 0]],
    };

    it('filters occupied and free nodes with counts, sums up the buildings and Power Shards, and remembers the filter', async () => {
      const user = userEvent.setup();
      const { wrap } = setup({ overrides: WITH_EXTRACTORS });
      wrap(<ResourceNodesPanel worldId={W} />);
      expect(await screen.findByRole('button', { name: /Occupied\s*2/ })).toHaveAttribute('aria-pressed', 'false');
      expect(row(/^All\s*4/)).toHaveAttribute('aria-pressed', 'true');
      expect(row(/Free\s*2/)).toBeInTheDocument();
      const summary = within(screen.getByRole('region', { name: 'Extractors (last save import)' }));
      expect(summary.getByText('Miner Mk.2').nextSibling).toHaveTextContent('1');
      expect(summary.getByText('Resource Well Pressurizer')).toBeInTheDocument();
      expect(summary.getByText('Resource Well Extractor')).toBeInTheDocument();
      expect(summary.queryByText('Miner Mk.1')).toBeNull();
      expect(summary.getByText('3 nodes with an extractor')).toBeInTheDocument();
      expect(summary.getByText('Power Shards in use: 4')).toBeInTheDocument();
      await user.click(row(/Occupied/));
      expect(row(/Occupied/)).toHaveAttribute('aria-pressed', 'true');
      expect(row(/Iron Ore\s*1/)).toBeInTheDocument();
      expect(row(/Unobtainium\s*0/)).toBeInTheDocument();
      expect(row(/Water\s*1/)).toBeInTheDocument();
      expect(loadResourceNodeView().occupancy).toBe('occupied');
    });

    it('without extractors there is no occupancy filter, and a remembered one does not hide nodes', async () => {
      useNodeLayer.setState({ occupancy: 'occupied' });
      const { wrap } = setup();
      wrap(<ResourceNodesPanel worldId={W} />);
      expect(await screen.findByRole('button', { name: /Iron Ore\s*2/ })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Occupied/ })).toBeNull();
      expect(screen.queryByRole('region')).toBeNull();
    });
  });

  it('says so for a dataset without resource nodes', async () => {
    const { wrap } = setup({ file: false });
    wrap(<ResourceNodesPanel worldId={W} />);
    expect(await screen.findByText('This map dataset has no resource nodes.')).toBeInTheDocument();
  });
});

describe('ResourceNodeLayer', () => {
  let map: L.Map | null = null;
  function Grab() {
    map = useMap();
    return null;
  }
  beforeEach(() => {
    vi.spyOn(Element.prototype, 'clientWidth', 'get').mockReturnValue(512);
    vi.spyOn(Element.prototype, 'clientHeight', 'get').mockReturnValue(512);
  });
  afterEach(() => vi.restoreAllMocks());

  it('draws in its own pane while switched on and shows a node on click, until Escape', async () => {
    const { ctx, wrap } = setup({ overrides: { overrides: [['N1', null, 'pure']], settings: null, extractors: [] } });
    resetLayer(true);
    const { container } = wrap(
      <MapContainer crs={L.CRS.Simple} center={[-128, 128]} zoom={4} style={{ width: 512, height: 512 }}>
        <ResourceNodeLayer ctx={ctx} />
        <Grab />
      </MapContainer>,
    );
    await waitFor(() => expect(container.querySelector('.leaflet-ficsmap-resource-nodes-pane canvas')).not.toBeNull());
    // N1 lies at the map centre, the container's (256, 256).
    await waitFor(() => {
      act(() => { map!.fire('click', { containerPoint: L.point(258, 255), latlng: L.latLng(-128, 128) }); });
      expect(screen.getByTestId('node-info')).toBeInTheDocument();
    });
    const info = within(screen.getByTestId('node-info'));
    expect(info.getByText('Iron Ore')).toBeInTheDocument();
    expect(info.getByText('Resource node')).toBeInTheDocument();
    expect(info.getByText('Pure')).toBeInTheDocument();
    expect(info.getByText('X 500 · Y 500 · Z 12')).toBeInTheDocument();
    expect(info.getByText('From the save import. Default map: Iron Ore, Impure')).toBeInTheDocument();
    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
    expect(screen.queryByTestId('node-info')).toBeNull();
    act(() => { resetLayer(false); });
    expect(container.querySelector('.leaflet-ficsmap-resource-nodes-pane canvas')).toBeNull();
  });

  it('lists the extractors on a node: building, clock speed and Power Shards, identical ones counted', async () => {
    const { ctx, wrap } = setup({
      overrides: { overrides: [], settings: null, extractors: [['N1', 'miner2', 2.25, 3], ['N1', 'portable', null, null], ['N1', 'portable', null, null]] },
    });
    resetLayer(true);
    const { container } = wrap(
      <MapContainer crs={L.CRS.Simple} center={[-128, 128]} zoom={4} style={{ width: 512, height: 512 }}>
        <ResourceNodeLayer ctx={ctx} />
        <Grab />
      </MapContainer>,
    );
    await waitFor(() => expect(container.querySelector('.leaflet-ficsmap-resource-nodes-pane canvas')).not.toBeNull());
    await waitFor(() => {
      act(() => { map!.fire('click', { containerPoint: L.point(256, 256), latlng: L.latLng(-128, 128) }); });
      expect(screen.getByTestId('node-extractors')).toBeInTheDocument();
    });
    const list = within(screen.getByTestId('node-extractors'));
    expect(list.getByText('Miner Mk.2')).toBeInTheDocument();
    expect(list.getByText('Clock speed 225%')).toBeInTheDocument();
    expect(list.getByText('3 Power Shards')).toBeInTheDocument();
    expect(list.getByText('Portable Miner × 2')).toBeInTheDocument();
    expect(list.getAllByText(/Clock speed/)).toHaveLength(1);
  });

  it('fetches nothing while switched off', () => {
    const { ctx, wrap, calls } = setup();
    wrap(
      <MapContainer crs={L.CRS.Simple} center={[-128, 128]} zoom={1} style={{ width: 512, height: 512 }}>
        <ResourceNodeLayer ctx={ctx} />
      </MapContainer>,
    );
    expect(calls).toEqual([]);
  });
});

describe('purity colours, resource pictures and extraction rates', () => {
  let map: L.Map | null = null;
  function Grab() {
    map = useMap();
    return null;
  }
  afterEach(() => vi.restoreAllMocks());

  /** The layer on a 512 px map centred on a node, which is then clicked; resolves with the info box. */
  async function clickNode(ctx: WorldCtx, wrap: (ui: React.ReactNode) => ReturnType<typeof render>, at: [number, number], wait: string) {
    vi.spyOn(Element.prototype, 'clientWidth', 'get').mockReturnValue(512);
    vi.spyOn(Element.prototype, 'clientHeight', 'get').mockReturnValue(512);
    resetLayer(true);
    const { container } = wrap(
      <MapContainer crs={L.CRS.Simple} center={worldToLatLng(at[0], at[1], BOUNDS)} zoom={4} style={{ width: 512, height: 512 }}>
        <ResourceNodeLayer ctx={ctx} />
        <Grab />
      </MapContainer>,
    );
    await waitFor(() => expect(container.querySelector('.leaflet-ficsmap-resource-nodes-pane canvas')).not.toBeNull());
    await waitFor(() => {
      act(() => { map!.fire('click', { containerPoint: L.point(256, 256), latlng: map!.getCenter() }); });
      expect(screen.getByTestId(wait)).toBeInTheDocument();
    });
    return within(screen.getByTestId('node-info'));
  }

  it('panel: resource rows show the resource picture, or the colour swatch where the dataset has none', async () => {
    const { wrap } = setup({ routes: EXTRAS });
    wrap(<ResourceNodesPanel worldId={W} />);
    await waitFor(() => expect(row(/Iron Ore/).querySelector('img')).not.toBeNull());
    expect(row(/Iron Ore/).querySelector('img')).toHaveAttribute('src', '/data/test/icons/items/64/Desc_OreIron_C.webp');
    expect(row(/Water/).querySelector('img')).toBeNull();
    expect(row(/Water/).querySelector('span[style*="--color-res-water"]')).not.toBeNull();
  });

  it('panel: purity rows in their colour (text and pips) with the miners\' rates at 100 %', async () => {
    const user = userEvent.setup();
    const { wrap } = setup({ routes: EXTRAS });
    wrap(<ResourceNodesPanel worldId={W} />);
    const purityRow = (p: string) => screen.getByRole('button', { name: new RegExp(`^${p}`) });
    await waitFor(() => expect(within(purityRow('Impure')).getByTestId('purity-rate')).toHaveTextContent('30–120/min'));
    expect(within(purityRow('Normal')).getByTestId('purity-rate')).toHaveTextContent('60–240/min');
    expect(within(purityRow('Pure')).getByTestId('purity-rate')).toHaveTextContent('120–480/min');
    expect(purityRow('Impure')).toHaveAttribute('title', 'At 100% clock speed: Miner Mk.1 30/min, Miner Mk.2 60/min, Miner Mk.3 120/min, Oil Extractor 60 m³/min, Resource Well Extractor 30 m³/min');
    for (const [p, cls] of [['Impure', 'text-purity-impure'], ['Normal', 'text-purity-normal'], ['Pure', 'text-purity-pure']] as const) {
      expect(within(purityRow(p)).getByText(p)).toHaveClass(cls);
      expect(purityRow(p).querySelector('svg')).toHaveClass(cls);
    }
    await user.click(purityRow('Impure'));
    expect(within(purityRow('Impure')).getByText('Impure')).not.toHaveClass('text-purity-impure');
  });

  it('panel: without recipe data the purity rows show no rate, and no error', async () => {
    const { wrap, client } = setup();
    wrap(<ResourceNodesPanel worldId={W} />);
    await waitFor(() => expect(client.getQueryState(queryKeys.recipes('test'))?.status).toBe('success'));
    expect(row(/^Impure/)).toBeInTheDocument();
    expect(screen.queryByTestId('purity-rate')).toBeNull();
  });

  it('info box: picture, purity in its colour with the rates per miner, and the placed miner\'s rate at its clock speed', async () => {
    const { ctx, wrap } = setup({ routes: EXTRAS, overrides: { overrides: [['N1', null, 'pure']], settings: null, extractors: [['N1', 'miner2', 1.5, 1]] } });
    const info = await clickNode(ctx, wrap, [50_000, 50_000], 'node-rates');
    expect(info.getByTestId('node-rates')).toHaveTextContent('· 120/min (Mk.1) · 240 (Mk.2) · 480 (Mk.3)');
    expect(info.getByText('Pure')).toHaveClass('text-purity-pure');
    expect(info.getByTestId('node-purity').querySelector('svg')).toHaveClass('text-purity-pure');
    expect(info.getByTestId('extractor-rate')).toHaveTextContent('Extracts 360/min');
    await waitFor(() => expect(screen.getByTestId('node-info').querySelector('img')).toHaveAttribute('src', '/data/test/icons/items/64/Desc_OreIron_C.webp'));
  });

  it('info box: a well satellite in m³/min, its extractor at the pressurizer\'s clock speed; German', async () => {
    initI18n(['de']);
    try {
      const { ctx, wrap } = setup({
        routes: EXTRAS, overrides: { overrides: [], settings: null, extractors: [['C1', 'pressurizer', 1.5, 1], ['S1', 'well', null, null]] },
      });
      const info = await clickNode(ctx, wrap, [80_500, 80_000], 'extractor-rate');
      expect(info.getByText('Rein')).toHaveClass('text-purity-pure');
      expect(info.getByTestId('node-rates')).toHaveTextContent('· 120 m³/min (Quellenextraktor)');
      expect(info.getByTestId('extractor-rate')).toHaveTextContent('Fördert 180 m³/min (Quellenkompressor bei 150 %)');
      // Water has no picture in this dataset: the swatch instead.
      expect(screen.getByTestId('node-info').querySelector('img')).toBeNull();
    } finally {
      initI18n(['en']);
    }
  });

  it('info box: without recipe data the purity shows without rates', async () => {
    const { ctx, wrap, client } = setup({ overrides: { overrides: [], settings: null, extractors: [['N1', 'miner2', 1.5, 1]] } });
    const info = await clickNode(ctx, wrap, [50_000, 50_000], 'node-extractors');
    await waitFor(() => expect(client.getQueryState(queryKeys.recipes('test'))?.status).toBe('success'));
    expect(info.getByText('Impure')).toHaveClass('text-purity-impure');
    expect(info.queryByTestId('node-rates')).toBeNull();
    expect(info.queryByTestId('extractor-rate')).toBeNull();
  });
});

describe('NodeCanvasLayer.pick', () => {
  const node = (id: string, lat: number, lng: number, kind: DrawNode['kind'] = 'node'): DrawNode =>
    ({ id, lat, lng, kind, purity: kind === 'core' ? null : 'normal', token: 'res-iron', label: 'Fe', changed: false });
  let map: L.Map;
  beforeEach(() => {
    vi.spyOn(Element.prototype, 'clientWidth', 'get').mockReturnValue(512);
    vi.spyOn(Element.prototype, 'clientHeight', 'get').mockReturnValue(512);
    const el = document.createElement('div');
    document.body.append(el);
    map = L.map(el, { crs: L.CRS.Simple, center: [-128, 128], zoom: 1 });
  });
  afterEach(() => {
    map.remove();
    vi.restoreAllMocks();
  });

  it('hits the nearest node within its dot plus slack; cores have no dot at low zoom', () => {
    const layer = new NodeCanvasLayer(() => [node('a', -128, 128), node('b', -128, 130), node('c', -64, 64, 'core')], () => null).addTo(map);
    expect(layer.pick(257, 256)).toBe('a');
    expect(layer.pick(263, 256)).toBe('b');
    expect(layer.pick(128, 128)).toBeNull();
    expect(layer.pick(400, 400)).toBeNull();
    map.setZoom(4);
    // Zoom 4: centre unchanged, the core (64 units up-left of the centre at 16 px/unit) is far off-screen.
    expect(layer.pick(256, 256)).toBe('a');
  });
});

describe('drawNode', () => {
  const palette: NodePalette = {
    bg: '#15171A', fg: '#E8E6E3', accent: '#F28C28', shard: '#7FD4FF',
    purity: { impure: '#FF5C5C', normal: '#FFA94D', pure: '#4ADE80' },
    resources: { 'res-iron': '#A9B6C6', 'res-oil': '#2A2430' },
  };
  /** A 2D context that records what is drawn: arcs (x, y, r), fill and stroke colours, texts, pictures, dashes. */
  function stubCtx() {
    const arcs: number[][] = [];
    const texts: string[] = [];
    const fills: string[] = [];
    const strokes: string[] = [];
    const images: number[][] = [];
    const dashes: number[][] = [];
    const rects: number[][] = [];
    const fonts: string[] = [];
    let diamonds = 0;
    const ctx: Record<string, unknown> = { globalAlpha: 1 };
    for (const m of ['beginPath', 'moveTo', 'lineTo']) ctx[m] = () => {};
    ctx.arc = (...a: number[]) => arcs.push(a.slice(0, 3));
    ctx.fill = () => fills.push(ctx.fillStyle as string);
    ctx.stroke = () => strokes.push(ctx.strokeStyle as string);
    ctx.fillText = (s: string) => { texts.push(s); fonts.push(ctx.font as string); };
    ctx.drawImage = (_img: unknown, ...a: number[]) => images.push(a);
    ctx.setLineDash = (d: number[]) => dashes.push(d);
    ctx.rect = (...a: number[]) => rects.push(a);
    ctx.closePath = () => { diamonds++; };
    ctx.measureText = (t: string) => ({ width: t.length * 6 });
    return { ctx: ctx as unknown as CanvasRenderingContext2D, arcs, texts, fills, strokes, images, dashes, rects, fonts, diamonds: () => diamonds };
  }
  const n = (o: Partial<DrawNode> = {}): DrawNode => ({ id: 'n', lat: 0, lng: 0, kind: 'node', purity: 'pure', token: 'res-iron', label: 'Fe', changed: false, ...o });
  const img = {} as CanvasImageSource;
  /** Arcs with the pip radius at full size. */
  const pips = (arcs: number[][]) => arcs.filter(a => a[2] === 2.4).length;

  it('rings a node in its purity colour: impure red, normal orange, pure green', () => {
    for (const purity of ['impure', 'normal', 'pure'] as const) {
      for (const size of ['small', 'full'] as const) {
        const { ctx, strokes } = stubCtx();
        drawNode(ctx, 0, 0, n({ purity }), size, palette, false, img);
        expect(strokes, `${purity} ${size}`).toContain(palette.purity[purity]);
        for (const other of PURITIES.filter(q => q !== purity)) expect(strokes).not.toContain(palette.purity[other]);
      }
    }
    expect(ringColor(n({ purity: 'impure' }), palette)).toBe(palette.purity.impure);
    expect(ringColor(n({ kind: 'core', purity: null }), palette)).toBe(palette.fg);
  });

  it('zoomed out, draws a dot in the purity colour that grows with the purity', () => {
    for (const purity of ['impure', 'normal', 'pure'] as const) {
      const { ctx, fills, images } = stubCtx();
      drawNode(ctx, 0, 0, n({ purity }), 'dot', palette, false, img);
      expect(fills).toEqual([palette.purity[purity]]);
      expect(images).toEqual([]);
    }
    expect(nodeRadius(n({ purity: 'impure' }), 'dot')).toBeLessThan(nodeRadius(n({ purity: 'normal' }), 'dot'));
    expect(nodeRadius(n({ purity: 'normal' }), 'dot')).toBeLessThan(nodeRadius(n({ purity: 'pure' }), 'dot'));
  });

  it('keeps 1, 2 or 3 pips under the node, so purity is not told by colour alone', () => {
    for (const [purity, count] of [['impure', 1], ['normal', 2], ['pure', 3]] as const) {
      const { ctx, arcs } = stubCtx();
      drawNode(ctx, 0, 0, n({ purity }), 'full', palette, false, img);
      expect(pips(arcs)).toBe(count);
    }
  });

  it('draws the resource picture centred inside the ring, with no disk or label', () => {
    const { ctx, images, fills, texts } = stubCtx();
    drawNode(ctx, 100, 50, n(), 'full', palette, false, img);
    expect(images).toHaveLength(1);
    const [x, y, w, h] = images[0]!;
    expect(w).toBe(h);
    expect(x! + w! / 2).toBe(100);
    expect(y! + h! / 2).toBe(50);
    // Inside the marker, which is larger than the old 10 px disk.
    expect(w! / 2).toBeLessThanOrEqual(nodeRadius(n(), 'full'));
    expect(w).toBeGreaterThanOrEqual(20);
    expect(fills).not.toContain(palette.resources['res-iron']);
    expect(texts).toEqual([]);
  });

  it('without a picture (still loading, or none in the dataset) falls back to the disk in the resource colour', () => {
    const full = stubCtx();
    drawNode(full.ctx, 0, 0, n(), 'full', palette);
    expect(full.images).toEqual([]);
    expect(full.fills).toContain(palette.resources['res-iron']);
    expect(full.strokes).toContain(palette.purity.pure);
    expect(full.texts).toEqual(['Fe']);
    const small = stubCtx();
    drawNode(small.ctx, 0, 0, n({ token: 'res-oil', label: 'Oil' }), 'small', palette);
    expect(small.fills).toContain(palette.resources['res-oil']);
    expect(small.texts).toEqual([]);
  });

  it('draws a core with a dashed neutral ring and no pips, and skips it as a dot; satellites are smaller', () => {
    const core = stubCtx();
    drawNode(core.ctx, 0, 0, n({ kind: 'core', purity: null }), 'full', palette, false, img);
    expect(core.images).toHaveLength(1);
    expect(core.dashes[0]!.length).toBeGreaterThan(0);
    expect(core.dashes.at(-1)).toEqual([]);
    expect(core.strokes).toContain(palette.fg);
    expect(pips(core.arcs)).toBe(0);
    expect(nodeRadius(n({ kind: 'core', purity: null }), 'dot')).toBe(0);
    expect(nodeRadius(n({ kind: 'satellite' }), 'full')).toBeLessThan(nodeRadius(n(), 'full'));
    const node = stubCtx();
    drawNode(node.ctx, 0, 0, n(), 'full', palette, false, img);
    expect(node.dashes).toEqual([]);
  });

  it('marks a changed node with a light badge and the highlighted one with an accent ring', () => {
    const plain = stubCtx();
    drawNode(plain.ctx, 0, 0, n({ purity: 'normal' }), 'small', palette, false, img);
    const marked = stubCtx();
    drawNode(marked.ctx, 0, 0, n({ purity: 'normal', changed: true }), 'small', palette, true, img);
    expect(marked.arcs).toHaveLength(plain.arcs.length + 2); // highlight ring and badge
    expect(marked.strokes[0]).toBe(palette.accent);
    expect(marked.fills.at(-1)).toBe(palette.fg);
    expect(marked.fills).not.toContain(palette.accent);
  });

  it('tags a node with an extractor: a square when small, the building and one diamond per shard from zoom 4, in a larger font', () => {
    const full = stubCtx();
    drawNode(full.ctx, 0, 0, n({ extractor: { label: 'Mk.2', shards: 3 } }), 'full', palette, false, img);
    expect(full.texts).toEqual(['Mk.2']);
    expect(full.rects).toHaveLength(1);
    expect(full.rects[0]![3]).toBeGreaterThanOrEqual(15);
    expect(Number(/(\d+)px/.exec(full.fonts[0]!)![1])).toBeGreaterThanOrEqual(11);
    expect(full.diamonds()).toBe(3);
    // The tag sits above the marker.
    expect(full.rects[0]![1]! + full.rects[0]![3]!).toBeLessThanOrEqual(-nodeRadius(n(), 'full'));
    const small = stubCtx();
    drawNode(small.ctx, 0, 0, n({ extractor: { label: 'Mk.2', shards: 3 } }), 'small', palette, false, img);
    expect(small.texts).toEqual([]);
    expect(small.rects).toHaveLength(1);
    expect(small.diamonds()).toBe(0);
    const dot = stubCtx();
    drawNode(dot.ctx, 0, 0, n({ extractor: { label: 'Mk.2', shards: 3 } }), 'dot', palette);
    expect(dot.rects).toHaveLength(0);
    const none = stubCtx();
    drawExtractor(none.ctx, 0, 0, { label: 'Oil', shards: 0 }, 'full', palette);
    expect(none.diamonds()).toBe(0);
  });

  it('names the first building on a node, counting the same kind and marking others', () => {
    const short = (k: string) => k.toUpperCase();
    expect(extractorTag([{ kind: 'miner2', clock: 2, shards: 2 }], short)).toEqual({ label: 'MINER2', shards: 2 });
    expect(extractorTag([{ kind: 'portable', clock: null, shards: null }, { kind: 'portable', clock: null, shards: null }], short)).toEqual({ label: 'PORTABLE×2', shards: 0 });
    expect(extractorTag([{ kind: 'miner1', clock: 1, shards: 1 }, { kind: 'portable', clock: null, shards: null }], short)).toEqual({ label: 'MINER1+', shards: 1 });
  });

  it('sizes by zoom and centres the pips', () => {
    expect([0, 1, 2, 3, 4, 7].map(nodeSize)).toEqual(['dot', 'dot', 'small', 'small', 'full', 'full']);
    expect(pipOffsets('normal', 6)).toEqual([-3, 3]);
    expect(pipOffsets('pure', 6)).toEqual([-6, 0, 6]);
  });

  it('picks a light label for dark fills and a dark one for light fills', () => {
    expect(luminance('#000000')).toBe(0);
    expect(luminance('#FFFFFF')).toBeCloseTo(1);
    expect(contrastOn('#2A2430', palette)).toBe(palette.fg);
    expect(contrastOn('#A9B6C6', palette)).toBe(palette.bg);
  });
});

describe('resource order and the feature module', () => {
  it('orders known resources by style, unknown ones last', () => {
    expect(sortResources(['Zeta_C', 'Geyser', 'Desc_Water_C', 'Desc_OreIron_C', 'Alpha_C'])).toEqual(['Desc_OreIron_C', 'Desc_Water_C', 'Geyser', 'Alpha_C', 'Zeta_C']);
  });

  it('refetches the world node data on an import event', () => {
    const { ctx, client } = setup();
    const spy = vi.spyOn(client, 'invalidateQueries');
    resourceNodesFeature.sseHandlers!.import!({ type: 'import', rev: 2 }, ctx);
    expect(spy).toHaveBeenCalledWith({ queryKey: queryKeys.nodeOverrides(W) });
  });
});
