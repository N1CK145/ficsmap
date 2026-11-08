import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import L from 'leaflet';
import { gzipSync } from 'node:zlib';
import { MapContainer, useMap } from 'react-leaflet';
import type { MeDto, WorldDto } from '../../src/shared/api.js';
import { indexDataset, type Dataset } from '../../src/shared/dataset.js';
import { worldToLatLng } from '../../src/shared/geo.js';
import { encodeHeightTile, type HeightmapMeta } from '../../src/shared/heightmap.js';
import type { WorldCtx } from '../../src/web/app/feature.js';
import { initI18n } from '../../src/web/app/i18n/index.js';
import { CoordsReadout } from '../../src/web/features/coords/CoordsReadout.js';
import { HeightLayer } from '../../src/web/features/coords/HeightLayer.js';
import { HEIGHT_LUT, HEIGHT_RAMP, paintHeights } from '../../src/web/features/coords/heightColors.js';
import { coordsFeature } from '../../src/web/features/coords/index.js';
import { wholeMetres } from '../../src/web/features/coords/metres.js';
import { useHeightLayer } from '../../src/web/features/coords/useHeights.js';
import { ToolButton } from '../../src/web/features/worlds/ToolsNav.js';
import userEvent from '@testing-library/user-event';

const W = '6f1c2b0e-8a43-4f5e-9d1b-2c3d4e5f6a7b';
const ME: MeDto = { id: 1, displayName: 'Nick', avatarUrl: null, email: null, datasetVersion: 'test' };
const WORLD: WorldDto = {
  id: W, name: 'Alpha', isOwner: true, rev: 1, datasetVersion: 'test', owner: { id: 1, displayName: 'Nick' }, members: [], lastImport: null,
};
const BOUNDS = { minX: 0, minY: 0, maxX: 100_000, maxY: 100_000 };
const DS: Dataset = {
  version: 'test', build: 1, bounds: BOUNDS, mapId: 'm', podRequirementsKnown: true,
  biomes: [{ id: 'b', name: { en: 'B', de: 'B' } }], items: [], aliases: {},
};
// 2 x 2 tiles of 2 x 2 cells of 250 m; tile (1, 0) is missing on the server
const META: HeightmapMeta = { cell: 25_000, minX: 0, minY: 0, width: 4, height: 4, tile: 2, step: 10, id: 'abc', overview: { factor: 2, width: 2, height: 2 }, range: [-1000, 5000] };

function stubHeights(withMeta: boolean) {
  const tile = gzipSync(Buffer.from(encodeHeightTile([4560, 4570, Number.NaN, -1230], 10).buffer));
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const path = new URL(String(input), 'http://localhost').pathname;
    if (withMeta && path === '/data/test/height/meta.json') return new Response(JSON.stringify(META), { headers: { 'content-type': 'application/json' } });
    if (withMeta && path === '/data/test/height/0_0.bin.gz') return new Response(tile);
    return new Response(JSON.stringify({ error: 'not_found', message: 'no' }), { status: 404, headers: { 'content-type': 'application/json' } });
  }));
}

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ctx: WorldCtx = { worldId: W, world: WORLD, me: ME, index: indexDataset(DS), queryClient: client, navigate: () => {}, toast: { show: () => {} } };
  let map: L.Map | undefined;
  const Grab = () => { map = useMap(); return null; };
  render(
    <QueryClientProvider client={client}>
      <MapContainer crs={L.CRS.Simple} center={[-128, 128]} zoom={1} style={{ width: 400, height: 400 }}>
        <Grab />
        <CoordsReadout ctx={ctx} />
      </MapContainer>
    </QueryClientProvider>,
  );
  const hover = (x: number, y: number) => act(() => { map!.fire('mousemove', { latlng: L.latLng(...worldToLatLng(x, y, BOUNDS)) }); });
  return { hover, leave: () => act(() => { map!.fire('mouseout'); }) };
}

describe('coordinates under the mouse', () => {
  beforeAll(() => { initI18n(['en']); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('shows X, Y and the height of the highest point, in whole metres', async () => {
    stubHeights(true);
    const { hover, leave } = setup();
    expect(screen.queryByTestId('coords-readout')).toBeNull();
    hover(30_000, 10_000); // cell (1, 0) of tile (0, 0): 45.7 m
    await waitFor(() => expect(screen.getByTestId('coords-readout').textContent).toBe('X 300 · Y 100 · Z 46'));
    hover(10_000, 30_000); // cell (0, 1): no surface
    await waitFor(() => expect(screen.getByTestId('coords-readout').textContent).toBe('X 100 · Y 300 · Z –'));
    hover(60_000, 10_000); // tile (1, 0) is missing
    await waitFor(() => expect(screen.getByTestId('coords-readout').textContent).toBe('X 600 · Y 100 · Z –'));
    leave();
    await waitFor(() => expect(screen.queryByTestId('coords-readout')).toBeNull());
  });

  it('formats whole metres in the UI language without a "-0"', () => {
    expect(wholeMetres('de')(123_456)).toBe('1.235');
    expect(wholeMetres('en')(-165_700)).toBe('-1,657');
    expect(wholeMetres('en')(-40)).toBe('0');
    expect(wholeMetres('de')(-49)).toBe('0');
  });

  it('shows no height for a dataset without a height map', async () => {
    stubHeights(false);
    const { hover } = setup();
    hover(30_000, 10_000);
    await waitFor(() => expect(screen.getByTestId('coords-readout').textContent).toBe('X 300 · Y 100 · Z –'));
  });
});

describe('height layer', () => {
  beforeAll(() => { initI18n(['en']); });
  afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); useHeightLayer.setState({ visible: false }); });

  it('colours heights light to dark between the range ends, clamped, and leaves gaps transparent', () => {
    const rgba = new Uint8ClampedArray(4 * 4);
    const z = [-500, 0, 100, null];
    paintHeights(rgba, 2, (px, py) => z[py * 2 + px]!, 0, 100);
    const hex = (o: number) => '#' + [0, 1, 2].map(c => rgba[o + c]!.toString(16).padStart(2, '0')).join('');
    expect(hex(0)).toBe(HEIGHT_RAMP[0]);
    expect(hex(4)).toBe(HEIGHT_RAMP[0]);
    expect(hex(8)).toBe(HEIGHT_RAMP[HEIGHT_RAMP.length - 1]);
    expect(rgba[15]).toBe(0);
    expect(HEIGHT_LUT).toHaveLength(256 * 3);
  });

  function renderControl() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const ctx: WorldCtx = { worldId: W, world: WORLD, me: { ...ME, datasetVersion: 'test2' }, index: indexDataset(DS), queryClient: client, navigate: () => {}, toast: { show: () => {} } };
    render(<QueryClientProvider client={client}><ToolButton tool={coordsFeature.tools![0]!} ctx={ctx} /></QueryClientProvider>);
  }

  it('offers the switch when the dataset has heights, and remembers it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(META), { headers: { 'content-type': 'application/json' } })));
    renderControl();
    const button = await screen.findByRole('button', { name: 'Height map' });
    await userEvent.click(button);
    expect(useHeightLayer.getState().visible).toBe(true);
    expect(localStorage.getItem('ficsmap:heights')).toBe('1');
  });

  it('has no switch for a dataset without heights', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'not_found', message: 'no' }), { status: 404, headers: { 'content-type': 'application/json' } })));
    renderControl();
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalled());
    await new Promise(r => setTimeout(r, 20));
    expect(screen.queryByRole('button', { name: 'Height map' })).toBeNull();
  });

  it('draws the layer with its legend while switched on', async () => {
    stubHeights(true);
    useHeightLayer.setState({ visible: true });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const ctx: WorldCtx = { worldId: W, world: WORLD, me: ME, index: indexDataset(DS), queryClient: client, navigate: () => {}, toast: { show: () => {} } };
    const { container } = render(
      <QueryClientProvider client={client}>
        <MapContainer crs={L.CRS.Simple} center={[-128, 128]} zoom={1} style={{ width: 400, height: 400 }}>
          <HeightLayer ctx={ctx} />
        </MapContainer>
      </QueryClientProvider>,
    );
    const legend = await screen.findByTestId('height-legend');
    expect(legend.textContent).toContain('-10 m');
    expect(legend.textContent).toContain('50 m');
    await waitFor(() => expect(container.querySelector('.leaflet-ficsmap-heights-pane canvas')).not.toBeNull());
    act(() => { useHeightLayer.setState({ visible: false }); });
    expect(screen.queryByTestId('height-legend')).toBeNull();
    expect(container.querySelector('.leaflet-ficsmap-heights-pane canvas')).toBeNull();
  });
});
