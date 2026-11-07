import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import L from 'leaflet';
import { MapContainer, useMap } from 'react-leaflet';
import type { MeDto, ResourceNodesDto, WorldDto } from '../../src/shared/api.js';
import { indexDataset, type Dataset } from '../../src/shared/dataset.js';
import type { ResourceNodesFile } from '../../src/shared/resourceNodes.js';
import type { WorldCtx } from '../../src/web/app/feature.js';
import { initI18n } from '../../src/web/app/i18n/index.js';
import { loadResourceNodeView } from '../../src/web/app/persist.js';
import { queryKeys } from '../../src/web/app/queryKeys.js';
import {
  contrastOn, drawExtractor, drawNode, luminance, nodeRadius, nodeSize, pipOffsets, type DrawNode, type NodePalette,
} from '../../src/web/features/resourceNodes/drawNode.js';
import { resourceNodesFeature } from '../../src/web/features/resourceNodes/index.js';
import { NodeCanvasLayer } from '../../src/web/features/resourceNodes/NodeCanvasLayer.js';
import { ToolButton } from '../../src/web/features/worlds/ToolsNav.js';
import { extractorTag, ResourceNodeLayer } from '../../src/web/features/resourceNodes/ResourceNodeLayer.js';
import { ResourceNodesPanel } from '../../src/web/features/resourceNodes/ResourceNodesPanel.js';
import { sortResources } from '../../src/web/features/resourceNodes/resourceStyle.js';
import { useNodeLayer } from '../../src/web/features/resourceNodes/useResourceNodes.js';
import { stubFetch } from './fetchStub.js';

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

function setup(opts: { file?: boolean; overrides?: ResourceNodesDto } = {}) {
  const { calls } = stubFetch({
    ...(opts.file === false ? {} : { 'GET /data/test/resource-nodes.json': { body: FILE } }),
    [`GET /api/worlds/${W}/resource-nodes`]: { body: opts.overrides ?? NO_OVERRIDES },
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
  const palette: NodePalette = { bg: '#15171A', fg: '#E8E6E3', accent: '#F28C28', shard: '#7FD4FF', resources: { 'res-iron': '#A9B6C6', 'res-oil': '#2A2430' } };
  function stubCtx() {
    const arcs: number[][] = [];
    const texts: string[] = [];
    const ctx: Record<string, unknown> = { globalAlpha: 1 };
    for (const m of ['beginPath', 'stroke', 'fill']) ctx[m] = () => {};
    ctx.arc = (...a: number[]) => arcs.push(a);
    ctx.fillText = (s: string) => texts.push(s);
    return { ctx: ctx as unknown as CanvasRenderingContext2D, arcs, texts };
  }
  const n = (o: Partial<DrawNode> = {}): DrawNode => ({ id: 'n', lat: 0, lng: 0, kind: 'node', purity: 'pure', token: 'res-iron', label: 'Fe', changed: false, ...o });

  it('shows the purity as 1, 2 or 3 pips and the label from zoom 4', () => {
    for (const [purity, pips] of [['impure', 1], ['normal', 2], ['pure', 3]] as const) {
      const { ctx, arcs, texts } = stubCtx();
      drawNode(ctx, 0, 0, n({ purity }), 'full', palette);
      expect(arcs).toHaveLength(1 + pips);
      expect(texts).toEqual(['Fe']);
    }
    const small = stubCtx();
    drawNode(small.ctx, 0, 0, n(), 'small', palette);
    expect(small.texts).toEqual([]);
    expect(small.arcs).toHaveLength(4);
  });

  it('dots grow with purity; cores are rings without pips and skipped as dots; changed nodes get a badge', () => {
    expect(nodeRadius(n({ purity: 'impure' }), 'dot')).toBeLessThan(nodeRadius(n({ purity: 'pure' }), 'dot'));
    expect(nodeRadius(n({ kind: 'core', purity: null }), 'dot')).toBe(0);
    expect(nodeRadius(n({ kind: 'satellite' }), 'full')).toBeLessThan(nodeRadius(n(), 'full'));
    const core = stubCtx();
    drawNode(core.ctx, 0, 0, n({ kind: 'core', purity: null }), 'full', palette);
    expect(core.arcs).toHaveLength(1);
    const changed = stubCtx();
    drawNode(changed.ctx, 0, 0, n({ purity: 'impure', changed: true }), 'small', palette, true);
    expect(changed.arcs).toHaveLength(4); // highlight ring, disk, 1 pip, badge
  });

  it('tags a node with an extractor: a square when small, the building and one diamond per shard from zoom 4', () => {
    const ops = () => {
      const { ctx, arcs, texts } = stubCtx();
      const rects: number[][] = [];
      const c = ctx as unknown as Record<string, unknown>;
      c.rect = (...a: number[]) => rects.push(a);
      let closed = 0;
      c.closePath = () => { closed++; };
      c.moveTo = c.lineTo = () => {};
      c.measureText = (t: string) => ({ width: t.length * 4 });
      return { ctx, arcs, texts, rects, diamonds: () => closed };
    };
    const full = ops();
    drawNode(full.ctx, 0, 0, n({ extractor: { label: 'Mk.2', shards: 3 } }), 'full', palette);
    expect(full.texts).toEqual(['Fe', 'Mk.2']);
    expect(full.rects).toHaveLength(1);
    expect(full.diamonds()).toBe(3);
    const small = ops();
    drawNode(small.ctx, 0, 0, n({ extractor: { label: 'Mk.2', shards: 3 } }), 'small', palette);
    expect(small.texts).toEqual([]);
    expect(small.rects).toHaveLength(1);
    expect(small.diamonds()).toBe(0);
    const dot = ops();
    drawNode(dot.ctx, 0, 0, n({ extractor: { label: 'Mk.2', shards: 3 } }), 'dot', palette);
    expect(dot.rects).toHaveLength(0);
    const none = ops();
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

  it('picks a light ring for dark fills and a dark one for light fills', () => {
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
