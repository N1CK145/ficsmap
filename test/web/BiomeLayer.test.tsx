import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, waitFor } from '@testing-library/react';
import L from 'leaflet';
import { MapContainer } from 'react-leaflet';
import { indexDataset, type Dataset } from '../../src/shared/dataset.js';
import type { WorldCtx } from '../../src/web/app/feature.js';
import { initI18n } from '../../src/web/app/i18n/index.js';
import { queryKeys } from '../../src/web/app/queryKeys.js';
import { useUiStore } from '../../src/web/app/store.js';
import { BiomeLayer } from '../../src/web/features/biomes/BiomeLayer.js';

const DS: Dataset = {
  version: 'test', build: 1, bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 }, mapId: 'm', podRequirementsKnown: true,
  biomes: [{ id: 'swamp', name: { en: 'Swamp', de: 'Swamp' } }],
  items: [['S1', 'somersloop', 10, 10, 0, 0, 1]],
  aliases: {},
};
const GEO = {
  type: 'FeatureCollection',
  features: [{ type: 'Feature', properties: { idx: 0, id: 'swamp', name: 'Swamp' }, geometry: { type: 'Polygon', coordinates: [[[0, 0], [50, 0], [50, 50], [0, 0]]] } }],
};

function renderLayer() {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  const index = indexDataset(DS);
  client.setQueryData(queryKeys.dataset('test'), index);
  client.setQueryData(queryKeys.biomes('test'), GEO);
  const ctx = { index, me: { datasetVersion: 'test' } } as unknown as WorldCtx;
  return render(
    <QueryClientProvider client={client}>
      <MapContainer crs={L.CRS.Simple} center={[-128, 128]} zoom={1} style={{ width: 400, height: 400 }}>
        <BiomeLayer ctx={ctx} />
      </MapContainer>
    </QueryClientProvider>,
  );
}

describe('biome layer', () => {
  beforeAll(() => { initI18n(['en']); });

  it('drops a remembered scope the dataset has no biome for', async () => {
    useUiStore.setState({ biomeScope: 20 });
    renderLayer();
    await waitFor(() => expect(useUiStore.getState().biomeScope).toBeNull());
  });

  it('keeps a scope the dataset has', async () => {
    useUiStore.setState({ biomeScope: 0 });
    const { container } = renderLayer();
    await waitFor(() => expect(container.querySelector('.ficsmap-biome-label')).not.toBeNull());
    expect(useUiStore.getState().biomeScope).toBe(0);
  });
});
