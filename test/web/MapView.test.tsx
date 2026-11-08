import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useEffect, useLayoutEffect, useState } from 'react';
import L from 'leaflet';
import { useMap } from 'react-leaflet';
import type { MeDto, WorldDto } from '../../src/shared/api.js';
import { indexDataset, type Dataset } from '../../src/shared/dataset.js';
import { latLngToWorld } from '../../src/shared/geo.js';
import type { FeatureModule, WorldCtx } from '../../src/web/app/feature.js';
import { FeaturesProvider } from '../../src/web/app/FeaturesContext.js';
import { initI18n } from '../../src/web/app/i18n/index.js';
import { loadView, saveView } from '../../src/web/app/persist.js';
import { queryKeys } from '../../src/web/app/queryKeys.js';
import { useUiStore } from '../../src/web/app/store.js';
import { markerClickClaims } from '../../src/web/features/map/clickClaims.js';
import { MapView } from '../../src/web/features/map/MapView.js';
import { MarkerLayer, type DrawMarker } from '../../src/web/features/map/MarkerLayer.js';
import type { MarksCache } from '../../src/web/features/marks/useMarks.js';

const WORLD = '6f1c2b0e-8a43-4f5e-9d1b-2c3d4e5f6a7b';

const dataset: Dataset = {
  version: 'test', build: 1, bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 }, mapId: 'm', podRequirementsKnown: true,
  biomes: [{ id: 'swamp', name: { en: 'Swamp', de: 'Sumpf' } }],
  items: [['S1', 'somersloop', 50, 50, 0, 0, 1]],
  aliases: {},
};

function ProbeLayer() {
  const map = useMap();
  return <span data-testid="probe-layer">{map instanceof L.Map ? 'has map' : 'no map'}</span>;
}

let probedMap: L.Map | null = null;
function MapGrabber() {
  const map = useMap();
  useEffect(() => { probedMap = map; }, [map]);
  return null;
}

const onQuickClick = vi.fn();
const onPickMarker = vi.fn();
const onPickPoint = vi.fn();
const probeFeature: FeatureModule = {
  id: 'probe',
  mapLayers: [{ id: 'probe-layer', order: 1, Component: ProbeLayer }, { id: 'grabber', order: 2, Component: MapGrabber }],
  mapControls: [{ id: 'probe-control', order: 1, Component: () => <button type="button">Probe control</button> }],
  mapModes: [
    { id: 'route', onMarkerClick: onQuickClick, Banner: () => <p>Probe banner</p> },
    // Takes points anywhere, like the vehicle calculator's pick mode.
    { id: 'vehicle-route', onMarkerClick: onPickMarker, onMapClick: onPickPoint },
  ],
};

function renderMap(worldId = WORLD) {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  const marks: MarksCache = { rev: 0, baseRev: 0, marks: new Map(), revs: new Map(), pending: new Map() };
  client.setQueryData(queryKeys.marks(worldId), marks);
  const me: MeDto = { id: 1, displayName: 'Anna', avatarUrl: null, email: null, datasetVersion: 'test' };
  const ctx: WorldCtx = {
    worldId, world: {} as WorldDto, me, index: indexDataset(dataset), queryClient: client,
    navigate: () => {}, toast: { show: () => {} },
  };
  return render(
    <QueryClientProvider client={client}>
      <FeaturesProvider features={[probeFeature]}><MapView ctx={ctx} /></FeaturesProvider>
    </QueryClientProvider>,
  );
}

describe('MapView', () => {
  beforeAll(() => { initI18n(['en']); });
  beforeEach(() => { useUiStore.getState().enterWorld(WORLD); });

  it('renders map layers inside the map, where they can use useMap()', () => {
    renderMap();
    expect(screen.getByTestId('probe-layer')).toHaveTextContent('has map');
  });

  it('renders the map controls', () => {
    renderMap();
    expect(screen.getByRole('button', { name: 'Probe control' })).toBeInTheDocument();
  });

  it('shows the banner of the active map mode only', () => {
    renderMap();
    expect(screen.queryByText('Probe banner')).not.toBeInTheDocument();
    act(() => { useUiStore.getState().setMode('route'); });
    expect(screen.getByText('Probe banner')).toBeInTheDocument();
  });
});

describe('MapView clicks', () => {
  beforeAll(() => { initI18n(['en']); });
  beforeEach(() => {
    localStorage.clear();
    useUiStore.getState().enterWorld(WORLD);
    onQuickClick.mockClear();
    onPickMarker.mockClear();
    onPickPoint.mockClear();
    probedMap = null;
    // A 512 px map fits the 256-unit image at zoom 1; the item (world 50, 50) sits at the centre.
    vi.spyOn(Element.prototype, 'clientWidth', 'get').mockReturnValue(512);
    vi.spyOn(Element.prototype, 'clientHeight', 'get').mockReturnValue(512);
  });
  afterEach(() => { vi.restoreAllMocks(); });

  const clickAt = (map: L.Map, x: number, y: number) => {
    const containerPoint = L.point(x, y);
    act(() => { map.fire('click', { containerPoint, latlng: map.containerPointToLatLng(containerPoint), originalEvent: new MouseEvent('click') }); });
  };

  it('zooms in by two around the click when markers are dots', () => {
    renderMap();
    const map = probedMap!;
    expect(map.getZoom()).toBe(1);
    clickAt(map, 258, 255);
    expect(map.getZoom()).toBe(3);
    expect(useUiStore.getState().selectedActor).toBeNull();
  });

  it('selects the item when no map mode handles the click', () => {
    renderMap();
    const map = probedMap!;
    act(() => { map.setZoom(3); });
    clickAt(map, 256, 256);
    expect(useUiStore.getState().selectedActor).toBe('S1');
    expect(onQuickClick).not.toHaveBeenCalled();
  });

  it('hands the item to the active map mode', () => {
    renderMap();
    const map = probedMap!;
    act(() => { map.setZoom(3); useUiStore.getState().setMode('route'); });
    clickAt(map, 256, 256);
    expect(onQuickClick).toHaveBeenCalledWith(expect.objectContaining({ name: 'S1' }), expect.objectContaining({ worldId: WORLD }));
    expect(useUiStore.getState().selectedActor).toBeNull();
  });

  it('gives a mode that takes points anywhere the marker under an icon, else the world position', () => {
    const { container } = renderMap();
    const map = probedMap!;
    act(() => { map.setZoom(3); useUiStore.getState().setMode('vehicle-route'); });
    expect(container.querySelector('.ficsmap-map-root')).toHaveClass('ficsmap-map-pick');
    clickAt(map, 256, 256);
    expect(onPickMarker).toHaveBeenCalledWith(expect.objectContaining({ name: 'S1' }), expect.objectContaining({ worldId: WORLD }));
    expect(onPickPoint).not.toHaveBeenCalled();
    clickAt(map, 50, 50);
    const ll = map.containerPointToLatLng([50, 50]);
    expect(onPickPoint).toHaveBeenCalledWith(latLngToWorld(ll.lat, ll.lng, dataset.bounds), expect.objectContaining({ worldId: WORLD }));
    expect(useUiStore.getState().selectedActor).toBeNull();
  });

  it('gives such a mode the position of a click on a dot, without zooming in', () => {
    renderMap();
    const map = probedMap!;
    act(() => { useUiStore.getState().setMode('vehicle-route'); });
    clickAt(map, 258, 255);
    expect(map.getZoom()).toBe(1);
    expect(onPickMarker).not.toHaveBeenCalled();
    const ll = map.containerPointToLatLng([258, 255]);
    expect(onPickPoint).toHaveBeenCalledWith(latLngToWorld(ll.lat, ll.lng, dataset.bounds), expect.anything());
  });

  it('ignores a click away from every marker', () => {
    renderMap();
    const map = probedMap!;
    act(() => { map.setZoom(3); });
    clickAt(map, 50, 50);
    expect(useUiStore.getState().selectedActor).toBeNull();
    expect(map.getZoom()).toBe(3);
  });

  it('keeps clicks on map controls away from the map', () => {
    renderMap();
    const onMapClick = vi.fn();
    probedMap!.on('click', onMapClick);
    fireEvent.click(screen.getByRole('button', { name: 'Probe control' }));
    expect(onMapClick).not.toHaveBeenCalled();
  });

  it('renders the controls outside the Leaflet container', () => {
    renderMap();
    expect(probedMap!.getContainer().contains(screen.getByRole('button', { name: 'Probe control' }))).toBe(false);
  });

  it('fades the markers like non-matches of a search while a mode takes points anywhere', () => {
    renderMap();
    let layer: MarkerLayer | undefined;
    probedMap!.eachLayer(l => { if (l instanceof MarkerLayer) layer = l; });
    // The canvas layer's data, as it draws it.
    const drawn = () => (layer as unknown as { getMarkers(): readonly DrawMarker[] }).getMarkers();
    expect(drawn()[0]!.visual.opacity).toBe(1);
    act(() => { useUiStore.getState().setMode('vehicle-route'); });
    expect(drawn()[0]!.visual).toMatchObject({ opacity: 0.2, highlight: false });
    // A mode that only takes markers (the route editor) leaves them as they are.
    act(() => { useUiStore.getState().setMode('route'); });
    expect(drawn()[0]!.visual.opacity).toBe(1);
    // A search match stays highlighted while picking.
    act(() => { useUiStore.getState().setMode('vehicle-route'); useUiStore.getState().setSearchHighlight(new Set(['S1'])); });
    expect(drawn()[0]!.visual).toMatchObject({ opacity: 1, highlight: true });
    act(() => { useUiStore.getState().setSearchHighlight(null); });
  });

  it('leaves a click to a layer above the markers that claims it, while just looking around', () => {
    renderMap();
    const map = probedMap!;
    act(() => { map.setZoom(3); });
    const claim = (x: number, y: number) => Math.hypot(x - 256, y - 256) < 10;
    markerClickClaims.add(claim);
    try {
      clickAt(map, 256, 256);
      expect(useUiStore.getState().selectedActor).toBeNull();
      // Modes still get their markers.
      act(() => { useUiStore.getState().setMode('route'); });
      clickAt(map, 256, 256);
      expect(onQuickClick).toHaveBeenCalledWith(expect.objectContaining({ name: 'S1' }), expect.anything());
    } finally {
      markerClickClaims.delete(claim);
    }
    act(() => { useUiStore.getState().setMode('route'); });
    clickAt(map, 256, 256);
    expect(useUiStore.getState().selectedActor).toBe('S1');
  });
});

describe('MapView view persistence', () => {
  const B = '7f1c2b0e-8a43-4f5e-9d1b-2c3d4e5f6a7b';
  beforeAll(() => { initI18n(['en']); });
  beforeEach(() => { localStorage.clear(); });

  /** Like WorldLayout: the store enters the world in a layout effect before the map renders. */
  function Host({ id }: { id: string }) {
    const [entered, setEntered] = useState<string | null>(null);
    useLayoutEffect(() => {
      useUiStore.getState().enterWorld(id, loadView(id) ?? undefined);
      setEntered(id);
    }, [id]);
    if (entered !== id) return <p>loading</p>;
    return <MapView ctx={ctxFor(id)} />;
  }

  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  const index = indexDataset(dataset);
  function ctxFor(worldId: string): WorldCtx {
    client.setQueryData(queryKeys.marks(worldId), { rev: 0, baseRev: 0, marks: new Map(), revs: new Map(), pending: new Map() } satisfies MarksCache);
    const me: MeDto = { id: 1, displayName: 'Anna', avatarUrl: null, email: null, datasetVersion: 'test' };
    return { worldId, world: {} as WorldDto, me, index, queryClient: client, navigate: () => {}, toast: { show: () => {} } };
  }
  const tree = (id: string) => (
    <QueryClientProvider client={client}><FeaturesProvider features={[]}><Host id={id} /></FeaturesProvider></QueryClientProvider>
  );

  it('does not write the next world\'s filters into the previous world on a switch', () => {
    saveView(B, { center: [-100, 100], zoom: 2, typeFilter: ['hard_drive'], visibility: 'hide', biomeScope: null });
    const r = render(tree(WORLD));
    expect(loadView(WORLD)).toBeNull();
    act(() => { r.rerender(tree(B)); });
    expect(loadView(WORLD)?.typeFilter).toBeUndefined();
    expect(loadView(B)?.typeFilter).toEqual(['hard_drive']);
  });

  it('saves a filter change of the current world', () => {
    vi.useFakeTimers();
    try {
      render(tree(WORLD));
      act(() => { useUiStore.getState().setVisibility('hide'); });
      act(() => { vi.advanceTimersByTime(300); });
      expect(loadView(WORLD)?.visibility).toBe('hide');
    } finally {
      vi.useRealTimers();
    }
  });
});
