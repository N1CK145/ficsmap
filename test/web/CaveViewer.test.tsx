import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import L from 'leaflet';
import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { MapContainer } from 'react-leaflet';
import type { MeDto, WorldDto } from '../../src/shared/api.js';
import { indexDataset, type Dataset } from '../../src/shared/dataset.js';
import type { WorldCtx } from '../../src/web/app/feature.js';
import { initI18n } from '../../src/web/app/i18n/index.js';
import { CaveInfo } from '../../src/web/features/caves/CaveInfo.js';
import { CaveLayer } from '../../src/web/features/caves/CaveLayer.js';
import { caveAt, caveContents, caveNumber, cutHeight, ueToModel, useCaveViewer } from '../../src/web/features/caves/caveModels.js';
import type { CaveViewer3dProps } from '../../src/web/features/caves/CaveViewer3d.js';
import { InCave } from '../../src/web/features/caves/InCave.js';
import { toShapes, useCaveLayer } from '../../src/web/features/caves/useCaves.js';
import { backgroundClicks } from '../../src/web/features/map/clickClaims.js';
import { stubFetch } from './fetchStub.js';

// The three.js view needs WebGL: replaced by a stub that reports itself ready and shows what it was given.
const viewerProps: CaveViewer3dProps[] = [];
vi.mock('../../src/web/features/caves/CaveViewer3d.js', () => ({
  default: function StubViewer(props: CaveViewer3dProps) {
    viewerProps.push(props);
    const { onStatus } = props;
    useEffect(() => onStatus({ kind: 'ready' }), [onStatus]);
    return <div data-testid="stub-viewer" data-url={props.url} data-cut={props.cut} data-surface={String(props.surface)} />;
  },
}));

const W = '6f1c2b0e-8a43-4f5e-9d1b-2c3d4e5f6a7b';
const ME: MeDto = { id: 1, displayName: 'Nick', avatarUrl: null, email: null, datasetVersion: 'test' };
const WORLD: WorldDto = {
  id: W, name: 'Alpha', role: 'owner', rev: 1, datasetVersion: 'test', owner: { id: 1, displayName: 'Nick' }, members: [], lastImport: null,
};
const BOUNDS = { minX: 0, minY: 0, maxX: 100_000, maxY: 100_000 };
const DS: Dataset = {
  version: 'test', build: 1, bounds: BOUNDS, mapId: 'm', podRequirementsKnown: true,
  biomes: [{ id: 'b', name: { en: 'B', de: 'B' } }],
  items: [
    ['S1', 'somersloop', 1000, 1000, -800, 0, 1, { cave: true }],
    ['S2', 'somersloop', 5000, 5000, 0, 0, 2],
    ['P1', 'slug_purple', 30_000, 30_000, 0, 0, 1, { cave: true }],
  ],
  aliases: {},
};
const GEOJSON = {
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', properties: { kind: 'cave', id: 'cave-001' }, geometry: { type: 'Polygon', coordinates: [[[0, 0], [2000, 0], [2000, 2000], [0, 2000], [0, 0]]] } },
    { type: 'Feature', properties: { kind: 'cave', id: 'cave-002' }, geometry: { type: 'Polygon', coordinates: [[[29_000, 29_000], [31_000, 29_000], [31_000, 31_000], [29_000, 29_000]]] } },
    { type: 'Feature', properties: { kind: 'entrance', cave: 'cave-001', z: -950 }, geometry: { type: 'Point', coordinates: [1000, 0] } },
    { type: 'Feature', properties: { kind: 'entrance', cave: 'cave-001', z: 120 }, geometry: { type: 'Point', coordinates: [2000, 1000] } },
  ],
};
const MODELS = { maxError: 0.3, caves: [{ id: 'cave-001', file: 'cave-001.glb', hash: 'abc123', triangles: 10, bytes: 100 }] };

function setup(models: 'present' | 'missing' = 'present') {
  const { calls } = stubFetch({
    'GET /data/test/caves.geojson': { body: GEOJSON },
    ...(models === 'present' ? { 'GET /data/test/cave-models/index.json': { body: MODELS } } : {}),
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const index = indexDataset(DS);
  const ctx: WorldCtx = { worldId: W, world: WORLD, me: ME, index, queryClient: client, navigate: () => {}, toast: { show: () => {} } };
  const wrap = (ui: React.ReactNode) => render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
  return { ctx, index, wrap, calls };
}

/** Inside a map; like MapView's overlays, portalled out of the Leaflet container (its DOM events never reach Leaflet). */
const inMap = (ui: React.ReactNode) => (
  <MapContainer crs={L.CRS.Simple} center={[-128, 128]} zoom={1} style={{ width: 400, height: 400 }}>{createPortal(ui, document.body)}</MapContainer>
);

beforeAll(() => { initI18n(['en']); });
beforeEach(() => {
  localStorage.clear();
  viewerProps.length = 0;
  useCaveLayer.setState({ visible: true });
  useCaveViewer.setState({ popup: null, viewing: null });
});
afterEach(() => vi.unstubAllGlobals());

describe('cave helpers', () => {
  const shapes = toShapes(GEOJSON as Parameters<typeof toShapes>[0], BOUNDS);

  it('finds the cave under a map point', () => {
    expect(caveAt(-1000 / 100_000 * 256, 1000 / 100_000 * 256, shapes)).toBe('cave-001');
    expect(caveAt(-50, 50, shapes)).toBeNull();
  });

  it('lists the collectibles in a cave and its entrances', () => {
    const c = caveContents('cave-001', shapes, indexDataset(DS));
    expect(c.items.map(i => i.name)).toEqual(['S1']);
    expect(c.entrances.map(e => e.z)).toEqual([-950, 120]);
    expect(caveContents('cave-404', shapes, indexDataset(DS))).toEqual({ items: [], entrances: [] });
  });

  it('numbers caves, converts world points into model space and cuts from above', () => {
    expect(caveNumber('cave-012')).toBe(12);
    expect(caveNumber('odd', 3)).toBe(3);
    expect(ueToModel(100, 200, 300)).toEqual([1, 3, 2]);
    expect(cutHeight(1, -10, 30)).toBe(31);
    expect(cutHeight(0.5, -10, 30)).toBe(10);
    expect(cutHeight(-1, -10, 30)).toBe(-10);
  });
});

describe('cave box and 3D view', () => {
  it('names a cave by its map number and opens the 3D model of the geometry cave it lies in', async () => {
    const { ctx, wrap } = setup();
    const geojson = {
      ...GEOJSON,
      features: [
        { type: 'Feature', properties: { kind: 'cave', id: 'sc-007', n: 7, model: 'cave-001' }, geometry: GEOJSON.features[0]!.geometry },
        { type: 'Feature', properties: { kind: 'entrance', cave: 'sc-007', z: 5 }, geometry: { type: 'Point', coordinates: [1000, 0] } },
      ],
    };
    stubFetch({ 'GET /data/test/caves.geojson': { body: geojson }, 'GET /data/test/cave-models/index.json': { body: MODELS } });
    useCaveViewer.setState({ popup: { id: 'sc-007', lat: -2, lng: 2 } });
    wrap(inMap(<CaveInfo ctx={ctx} />));
    const box = await screen.findByRole('region', { name: 'Cave 7' });
    await waitFor(() => expect(box).toHaveTextContent('1 item · 1 entrance'));
    await userEvent.click(await screen.findByRole('button', { name: '3D view' }));
    await screen.findByRole('dialog', { name: 'Cave 7 in 3D' });
    expect(await screen.findByTestId('stub-viewer')).toHaveAttribute('data-url', '/data/test/cave-models/cave-001.glb?v=abc123');
  });

  it('opens the box of the cave clicked on the layer and closes it on a click outside every cave', async () => {
    const { ctx, wrap } = setup();
    const { container } = wrap(inMap(<CaveLayer ctx={ctx} />));
    await waitFor(() => expect(container.querySelector('.leaflet-ficsmap-caves-pane path')).not.toBeNull());
    expect(backgroundClicks.size).toBe(1);
    const [click] = [...backgroundClicks];
    act(() => click!({ lat: -2, lng: 2, x: 0, y: 0 }));
    expect(useCaveViewer.getState().popup).toEqual({ id: 'cave-001', lat: -2, lng: 2 });
    act(() => click!({ lat: -200, lng: 200, x: 0, y: 0 }));
    expect(useCaveViewer.getState().popup).toBeNull();
    act(() => { useCaveLayer.setState({ visible: false }); });
    expect(backgroundClicks.size).toBe(0);
  });

  it('shows the cave with its contents and opens the 3D view with the controls', async () => {
    const { ctx, wrap, calls } = setup();
    useCaveViewer.setState({ popup: { id: 'cave-001', lat: -2, lng: 2 } });
    wrap(inMap(<CaveInfo ctx={ctx} />));
    const box = await screen.findByRole('region', { name: 'Cave 1' });
    await waitFor(() => expect(box).toHaveTextContent('1 item · 2 entrances'));
    await userEvent.click(await screen.findByRole('button', { name: '3D view' }));
    expect(useCaveViewer.getState()).toMatchObject({ popup: null, viewing: 'cave-001' });
    expect(screen.queryByRole('region', { name: 'Cave 1' })).toBeNull();

    const dialog = await screen.findByRole('dialog', { name: 'Cave 1 in 3D' });
    const viewer = await screen.findByTestId('stub-viewer');
    expect(viewer).toHaveAttribute('data-url', '/data/test/cave-models/cave-001.glb?v=abc123');
    expect(calls.map(c => c.path)).toContain('/data/test/cave-models/index.json');
    // The entrances and the Somersloop as dots, in their colours; a legend names them.
    const last = viewerProps.at(-1)!;
    expect(last.markers.map(m => [m.kind, m.x, m.z])).toEqual([['entrance', 1000, -950], ['entrance', 2000, 120], ['item', 1000, -800]]);
    expect(dialog).toHaveTextContent('Entrance');
    expect(dialog).toHaveTextContent('Somersloop');

    await userEvent.click(screen.getByRole('checkbox', { name: 'Landscape' }));
    expect(viewer).toHaveAttribute('data-surface', 'false');
    const slider = screen.getByRole('slider', { name: 'Cut from above' });
    fireEvent.change(slider, { target: { value: '40' } });
    expect(viewer).toHaveAttribute('data-cut', '0.4');
    const resetBefore = viewerProps.at(-1)!.resetKey;
    await userEvent.click(screen.getByRole('button', { name: 'Reset view' }));
    expect(viewerProps.at(-1)!.resetKey).toBe(resetBefore + 1);

    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(useCaveViewer.getState().viewing).toBeNull();
  });

  it('offers no 3D view for a dataset without cave models', async () => {
    const { ctx, wrap, calls } = setup('missing');
    useCaveViewer.setState({ popup: { id: 'cave-001', lat: -2, lng: 2 } });
    wrap(inMap(<CaveInfo ctx={ctx} />));
    await screen.findByText('1 item · 2 entrances');
    await waitFor(() => expect(calls.map(c => c.path)).toContain('/data/test/cave-models/index.json'));
    expect(screen.queryByRole('button', { name: '3D view' })).toBeNull();
  });

  it('says so when the cave has no model, and closes the box when the layer is switched off', async () => {
    const { ctx, wrap } = setup();
    useCaveViewer.setState({ viewing: 'cave-002', popup: { id: 'cave-002', lat: -2, lng: 2 } });
    wrap(inMap(<CaveInfo ctx={ctx} />));
    expect(await screen.findByText('This dataset has no 3D model of this cave.')).toBeInTheDocument();
    expect(screen.queryByTestId('stub-viewer')).toBeNull();
    act(() => { useCaveLayer.setState({ visible: false }); });
    expect(useCaveViewer.getState().popup).toBeNull();
  });

  it('opens the 3D view of the cave an item lies in from the item panel', async () => {
    const { ctx, index, wrap } = setup();
    wrap(<InCave item={index.byName.get('S1')!} ctx={ctx} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Show cave in 3D' }));
    expect(useCaveViewer.getState().viewing).toBe('cave-001');
  });

  it('has no 3D button for an item in a cave without a model', async () => {
    const { ctx, index, wrap } = setup();
    wrap(<InCave item={index.byName.get('P1')!} ctx={ctx} />);
    await screen.findByText(/Nearest cave entrance/);
    expect(screen.queryByRole('button', { name: 'Show cave in 3D' })).toBeNull();
  });
});
