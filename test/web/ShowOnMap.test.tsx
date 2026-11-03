import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render } from '@testing-library/react';
import L from 'leaflet';
import { useEffect } from 'react';
import { useMap } from 'react-leaflet';
import type { MeDto, WorldDto } from '../../src/shared/api.js';
import { indexDataset, type Dataset } from '../../src/shared/dataset.js';
import { worldToLatLng } from '../../src/shared/geo.js';
import type { FeatureModule, WorldCtx } from '../../src/web/app/feature.js';
import { FeaturesProvider } from '../../src/web/app/FeaturesContext.js';
import { initI18n } from '../../src/web/app/i18n/index.js';
import { queryKeys } from '../../src/web/app/queryKeys.js';
import { useUiStore } from '../../src/web/app/store.js';
import { itemPanelFeature } from '../../src/web/features/itemPanel/index.js';
import { MapView } from '../../src/web/features/map/MapView.js';
import type { MarksCache } from '../../src/web/features/marks/useMarks.js';

const WORLD = '6f1c2b0e-8a43-4f5e-9d1b-2c3d4e5f6a7b';
const dataset: Dataset = {
  version: 'test', build: 1, bounds: { minX: 0, minY: 0, maxX: 100000, maxY: 100000 }, mapId: 'm', podRequirementsKnown: true,
  biomes: [{ id: 'swamp', name: { en: 'Swamp', de: 'Sumpf' } }],
  items: [['S1', 'somersloop', 80000, 20000, 0, 0, 1]],
  aliases: {},
};

let map: L.Map | null = null;
function Grab() {
  const m = useMap();
  useEffect(() => { map = m; }, [m]);
  return null;
}
const grabFeature: FeatureModule = { id: 'grab', mapLayers: [{ id: 'grab', order: 1, Component: Grab }] };

describe('Show on map', () => {
  beforeAll(() => { initI18n(['en']); });
  beforeEach(() => {
    localStorage.clear();
    useUiStore.getState().enterWorld(WORLD);
    vi.spyOn(Element.prototype, 'clientWidth', 'get').mockReturnValue(1000);
    vi.spyOn(Element.prototype, 'clientHeight', 'get').mockReturnValue(600);
  });
  afterEach(() => vi.restoreAllMocks());

  it('zooms in on the item and keeps it clear of the item panel', () => {
    const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
    const marks: MarksCache = { rev: 0, baseRev: 0, marks: new Map(), revs: new Map(), pending: new Map() };
    client.setQueryData(queryKeys.marks(WORLD), marks);
    const me: MeDto = { id: 1, displayName: 'Anna', avatarUrl: null, email: null, datasetVersion: 'test' };
    const index = indexDataset(dataset);
    const ctx: WorldCtx = { worldId: WORLD, world: {} as WorldDto, me, index, queryClient: client, navigate: () => {}, toast: { show: () => {} } };
    // Request made while the map is not mounted (the list view was showing): handled when it mounts.
    useUiStore.getState().focusItem('S1');
    render(<QueryClientProvider client={client}><FeaturesProvider features={[itemPanelFeature, grabFeature]}><MapView ctx={ctx} /></FeaturesProvider></QueryClientProvider>);

    const m = map!;
    expect(m.getZoom()).toBeGreaterThanOrEqual(4);
    const latlng = L.latLng(worldToLatLng(80000, 20000, dataset.bounds));
    expect(m.getBounds().contains(latlng)).toBe(true);
    // Left of the 340 px panel on the right: 1000 - 340 - margin.
    expect(m.latLngToContainerPoint(latlng).x).toBeLessThan(1000 - 340);
    expect(useUiStore.getState().focusRequest).toBeNull();
    expect(useUiStore.getState().selectedActor).toBe('S1');
    expect(useUiStore.getState().mainView).toBe('map');
    act(() => {});
  });
});
