import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { killsByName, readCreatures } from '../../src/shared/creatures.js';
import { indexDataset, type Dataset } from '../../src/shared/dataset.js';
import { initI18n } from '../../src/web/app/i18n/index.js';
import { queryKeys } from '../../src/web/app/queryKeys.js';
import { useUiStore } from '../../src/web/app/store.js';
import { CreatureBiomes } from '../../src/web/features/creatures/CreatureBiomes.js';
import { useCreatureLayer, type CreatureData } from '../../src/web/features/creatures/useCreatures.js';

const W = '6f1c2b0e-8a43-4f5e-9d1b-2c3d4e5f6a7b';
const DS: Dataset = {
  version: 'test', build: 1, bounds: { minX: 0, minY: 0, maxX: 100_000, maxY: 100_000 }, mapId: 'm', podRequirementsKnown: true,
  biomes: [{ id: 'grass', name: { en: 'Grass Fields', de: 'Grasfelder' } }, { id: 'desert', name: { en: 'Rocky Desert', de: 'Felswüste' } }],
  items: [], aliases: {},
};
const square = (x: number, y: number, s: number) => ({ type: 'Polygon', coordinates: [[[x, y], [x + s, y], [x + s, y + s], [x, y + s], [x, y]]] });
const BIOMES = { type: 'FeatureCollection', features: [
  { type: 'Feature', properties: { idx: 0, id: 'grass', name: 'Grass Fields' }, geometry: square(0, 0, 40_000) },
  { type: 'Feature', properties: { idx: 1, id: 'desert', name: 'Rocky Desert' }, geometry: square(50_000, 0, 40_000) },
] };
// Grass: three hogs, one dead now; desert: two spitters, both dead now; one stinger far outside every biome.
const DATA: CreatureData = {
  spawners: readCreatures({ version: 'test', spawners: [
    ['H1', 'Char_Hog_C', 1_000, 1_000, 0], ['H2', 'Char_Hog_C', 2_000, 1_000, 0], ['H3', 'Char_Hog_C', 3_000, 1_000, 0],
    ['S1', 'Char_SpitterDesertSmall_C', 60_000, 1_000, 0], ['S2', 'Char_SpitterDesertSmall_C', 61_000, 1_000, 0],
    ['X1', 'Char_Stinger_C', 30_000, 90_000, 0],
  ] }),
  kills: killsByName([['H1', 1, 1], ['S1', 2, 1], ['S2', 1, 1]]),
  hasKills: true,
  saveTime: 1,
};

function renderList(hidden: string[] = [], data: CreatureData = DATA) {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  client.setQueryData(queryKeys.biomes('test'), BIOMES);
  client.setQueryData(queryKeys.dataset('test'), indexDataset(DS));
  render(<QueryClientProvider client={client}><CreatureBiomes version="test" data={data} hidden={hidden as never} /></QueryClientProvider>);
}
const rows = (name = 'Where creatures still live') => within(screen.getByRole('list', { name })).getAllByRole('listitem').map(li => li.textContent);

describe('creatures per biome', () => {
  beforeEach(() => {
    initI18n(['en']);
    localStorage.clear();
    useUiStore.getState().enterWorld(W);
    useCreatureLayer.setState({ visible: false });
  });

  it('lists per biome the spawn points with living creatures of all, most first; cleared ones say so', async () => {
    renderList();
    await userEvent.click(screen.getByText('Where creatures still live'));
    expect(screen.getByText('1 biome not cleared')).toBeInTheDocument();
    expect(rows()).toEqual(['Grass Fields2 of 3', 'Outside the biomes1 of 1', 'Rocky Desertcleared']);
  });

  it('counts only the kinds shown', () => {
    renderList(['hog']);
    expect(rows()).toEqual(['Outside the biomes1 of 1', 'Rocky Desertcleared']);
  });

  it('a click shows the creatures and scopes the map to the biome; a second click clears the scope', async () => {
    renderList();
    const grass = screen.getByRole('button', { name: /Grass Fields/ });
    await userEvent.click(grass);
    expect(useCreatureLayer.getState().visible).toBe(true);
    expect(useUiStore.getState().biomeScope).toBe(0);
    expect(grass).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(grass);
    expect(useUiStore.getState().biomeScope).toBeNull();
    // Outside every biome there is nothing to scope to.
    expect(screen.queryByRole('button', { name: /Outside the biomes/ })).toBeNull();
  });

  it('speaks German', async () => {
    initI18n(['de']);
    renderList();
    expect(screen.getByText('Wo noch Kreaturen leben')).toBeInTheDocument();
    expect(screen.getByText('1 Biom nicht geräumt')).toBeInTheDocument();
    expect(rows('Wo noch Kreaturen leben')).toEqual(['Grasfelder2 von 3', 'Außerhalb der Biome1 von 1', 'Felswüstegeräumt']);
  });
});
