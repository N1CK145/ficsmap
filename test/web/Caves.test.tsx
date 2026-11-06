import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import L from 'leaflet';
import { MapContainer } from 'react-leaflet';
import userEvent from '@testing-library/user-event';
import type { MeDto, WorldDto } from '../../src/shared/api.js';
import { indexDataset, type Dataset } from '../../src/shared/dataset.js';
import type { WorldCtx } from '../../src/web/app/feature.js';
import { initI18n } from '../../src/web/app/i18n/index.js';
import { queryKeys } from '../../src/web/app/queryKeys.js';
import { CaveControl } from '../../src/web/features/caves/CaveControl.js';
import { CaveLayer } from '../../src/web/features/caves/CaveLayer.js';
import { cavesFeature } from '../../src/web/features/caves/index.js';
import { InCave } from '../../src/web/features/caves/InCave.js';
import { nearestEntrance, toShapes, useCaveLayer } from '../../src/web/features/caves/useCaves.js';
import { stubFetch } from './fetchStub.js';

const W = '6f1c2b0e-8a43-4f5e-9d1b-2c3d4e5f6a7b';
const ME: MeDto = { id: 1, displayName: 'Nick', avatarUrl: null, email: null, datasetVersion: 'test' };
const WORLD: WorldDto = {
  id: W, name: 'Alpha', isOwner: true, rev: 1, datasetVersion: 'test', owner: { id: 1, displayName: 'Nick' }, members: [], lastImport: null,
};
const BOUNDS = { minX: 0, minY: 0, maxX: 100_000, maxY: 100_000 };
const DS: Dataset = {
  version: 'test', build: 1, bounds: BOUNDS, mapId: 'm', podRequirementsKnown: true,
  biomes: [{ id: 'b', name: { en: 'B', de: 'B' } }],
  items: [
    ['S1', 'somersloop', 1000, 1000, 0, 0, 1, { cave: true }],
    ['S2', 'somersloop', 5000, 5000, 0, 0, 2],
  ],
  aliases: {},
};
const GEOJSON = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature', properties: { kind: 'cave', id: 'cave-001' },
      geometry: { type: 'Polygon', coordinates: [[[0, 0], [2000, 0], [2000, 2000], [0, 0]], [[500, 200], [800, 200], [800, 400], [500, 200]]] },
    },
    { type: 'Feature', properties: { kind: 'entrance', cave: 'cave-001', z: -950 }, geometry: { type: 'Point', coordinates: [1000, 9000] } },
    { type: 'Feature', properties: { kind: 'entrance', cave: 'cave-001', z: 120 }, geometry: { type: 'Point', coordinates: [4000, 5000] } },
  ],
};

function setup(caves: 'present' | 'missing') {
  const { calls } = stubFetch(caves === 'present' ? { 'GET /data/test/caves.geojson': { body: GEOJSON } } : {});
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // A dataset built without caves has no item with extra.cave.
  const index = indexDataset(caves === 'present' ? DS : { ...DS, items: DS.items.map(i => i.slice(0, 7) as typeof i) });
  const ctx: WorldCtx = { worldId: W, world: WORLD, me: ME, index, queryClient: client, navigate: () => {}, toast: { show: () => {} } };
  const wrap = (ui: React.ReactNode) => render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
  client.setQueryData(queryKeys.me(), ME);
  return { ctx, index, wrap, calls };
}

describe('caves', () => {
  beforeAll(() => { initI18n(['en']); });
  beforeEach(() => {
    localStorage.clear();
    useCaveLayer.setState({ visible: false });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('converts the GeoJSON into map rings and entrance points', () => {
    const shapes = toShapes(GEOJSON as Parameters<typeof toShapes>[0], BOUNDS);
    expect(shapes.caves).toHaveLength(1);
    expect(shapes.caves[0]).toHaveLength(2); // outer ring and hole
    expect(shapes.caves[0]![0]![1]).toEqual([0, 2000 / 100_000 * 256]);
    expect(shapes.entrances.map(e => e.z)).toEqual([-950, 120]);
    expect(nearestEntrance(1000, 1000, shapes.entrances)).toBe(5000);
    expect(nearestEntrance(0, 0, [])).toBeNull();
  });

  it('shows the control only when the dataset has caves, and toggles and remembers the layer', async () => {
    const { ctx, wrap, calls } = setup('present');
    wrap(<CaveControl ctx={ctx} />);
    const button = await screen.findByRole('button', { name: 'Caves' });
    expect(calls).toEqual([]); // the large caves.geojson is not loaded just for the button
    expect(button).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(button);
    expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(localStorage.getItem('ficsmap:caves')).toBe('1');
  });

  it('has no control for a dataset built without caves', () => {
    const { ctx, wrap } = setup('missing');
    const { container } = wrap(<CaveControl ctx={ctx} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('notes in the item panel that an item lies in a cave, with the nearest entrance', async () => {
    const { ctx, index, wrap } = setup('present');
    const section = cavesFeature.itemDetailSections![0]!;
    expect(section.applies(index.byName.get('S1')!)).toBe(true);
    expect(section.applies(index.byName.get('S2')!)).toBe(false);
    wrap(<InCave item={index.byName.get('S1')!} ctx={ctx} />);
    expect(screen.getByRole('heading', { name: 'Cave' })).toBeInTheDocument();
    expect(screen.getByText('Lies in a cave.')).toBeInTheDocument();
    expect(await screen.findByText('Nearest cave entrance: 50 m (straight line)')).toBeInTheDocument();
  });
});

describe('CaveLayer', () => {
  beforeAll(() => { initI18n(['en']); });
  afterEach(() => vi.unstubAllGlobals());

  it('draws the caves and entrances in their own panes while switched on, and nothing while off', async () => {
    const { ctx, wrap } = setup('present');
    useCaveLayer.setState({ visible: true });
    const { container } = wrap(
      <MapContainer crs={L.CRS.Simple} center={[-128, 128]} zoom={1} style={{ width: 400, height: 400 }}>
        <CaveLayer ctx={ctx} />
      </MapContainer>,
    );
    await waitFor(() => expect(container.querySelector('.leaflet-ficsmap-caves-pane path')).not.toBeNull());
    expect(container.querySelectorAll('.leaflet-ficsmap-cave-entrances-pane path')).toHaveLength(2);
    act(() => { useCaveLayer.setState({ visible: false }); });
    expect(container.querySelector('.leaflet-ficsmap-caves-pane path')).toBeNull();
  });
});
