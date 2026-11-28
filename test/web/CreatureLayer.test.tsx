import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import L from 'leaflet';
import { MapContainer } from 'react-leaflet';
import type { MeDto, WorldDto } from '../../src/shared/api.js';
import type { CreaturesFile } from '../../src/shared/creatures.js';
import { indexDataset, type Dataset } from '../../src/shared/dataset.js';
import type { FactorySnapshot } from '../../src/shared/factory/snapshot.js';
import type { WorldCtx } from '../../src/web/app/feature.js';
import { initI18n } from '../../src/web/app/i18n/index.js';
import { CreatureLayer } from '../../src/web/features/creatures/CreatureLayer.js';
import { focusOrder } from '../../src/web/features/creatures/focusOrder.js';
import { useCreatureLayer } from '../../src/web/features/creatures/useCreatures.js';
import { useFactoryPage } from '../../src/web/features/factory/timeline.js';
import { makeSnapshot, makeSummary } from './factoryFixtures.js';
import { stubFetch } from './fetchStub.js';

const W = '6f1c2b0e-8a43-4f5e-9d1b-2c3d4e5f6a7b';
const ME: MeDto = { id: 1, displayName: 'Nick', avatarUrl: null, email: null, datasetVersion: 'test' };
const WORLD: WorldDto = {
  id: W, name: 'Alpha', role: 'owner', rev: 1, datasetVersion: 'test', owner: { id: 1, displayName: 'Nick' }, members: [], lastImport: null,
};
const BOUNDS = { minX: 0, minY: 0, maxX: 100_000, maxY: 100_000 };
const DS: Dataset = {
  version: 'test', build: 1, bounds: BOUNDS, mapId: 'm', podRequirementsKnown: true,
  biomes: [{ id: 'b', name: { en: 'B', de: 'B' } }], items: [], aliases: {},
};
// Three spawners in view (the map shows the middle of the world), one far outside it.
const FILE: CreaturesFile = {
  version: 'test',
  spawners: [
    ['Spawner_B', 'Char_Hog_C', 52_000, 50_000, 0],
    ['Spawner_A', 'Char_Hog_C', 48_000, 50_000, 0],
    ['Spawner_C', 'Char_Hog_C', 50_000, 51_500, 0],
    ['Spawner_Far', 'Char_Hog_C', 1_000, 1_000, 0],
  ],
};
const SNAP: FactorySnapshot = { ...makeSnapshot('Alpha', 1_000), spawners: [['Spawner_A', 3, 1]] };

function setup() {
  stubFetch({
    'GET /data/test/creatures.json': { body: FILE },
    [`GET /api/worlds/${W}/snapshots`]: { body: [makeSummary(1, 1_000, 'Alpha')] },
    [`GET /api/worlds/${W}/snapshots/1`]: { body: SNAP },
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ctx: WorldCtx = { worldId: W, world: WORLD, me: ME, index: indexDataset(DS), queryClient: client, navigate: () => {}, toast: { show: () => {} } };
  return render(
    <QueryClientProvider client={client}>
      <MapContainer crs={L.CRS.Simple} center={[-128, 128]} zoom={4} style={{ width: 512, height: 512 }}>
        <CreatureLayer ctx={ctx} />
      </MapContainer>
    </QueryClientProvider>,
  );
}

describe('creature spawners by keyboard', () => {
  beforeAll(() => { initI18n(['en']); });
  beforeEach(() => {
    localStorage.clear();
    useFactoryPage.setState({ worldId: null });
    useCreatureLayer.setState({ visible: true, hidden: [], kill: 'all' });
    vi.spyOn(Element.prototype, 'clientWidth', 'get').mockReturnValue(512);
    vi.spyOn(Element.prototype, 'clientHeight', 'get').mockReturnValue(512);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('gives each spawner in view a focus stop in reading order; focus shows its box, Enter pins it, Escape lets go', async () => {
    setup();
    const group = await screen.findByRole('group', { name: 'Creatures' });
    await waitFor(() => expect(within(group).getByRole('button', { name: /Fluffy-Tailed Hog, killed 3 times, dead right now/i })).toBeInTheDocument());
    const buttons = within(group).getAllByRole('button');
    // Left to right within a row; the spawner below comes after; the one outside the view has none.
    expect(buttons).toHaveLength(3);
    expect(buttons[0]).toHaveAccessibleName(/killed 3 times/i);
    expect(buttons[1]).toHaveAccessibleName('Fluffy-Tailed Hog, Never killed');
    expect(buttons[2]).toHaveAccessibleName('Fluffy-Tailed Hog, Never killed');
    expect(buttons[0]).toHaveAttribute('aria-pressed', 'false');

    buttons[0]!.focus();
    expect(await screen.findByTestId('creature-info')).toHaveTextContent(/Killed 3 times/);
    await userEvent.keyboard('{Enter}');
    expect(buttons[0]).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('creature-announce')).toHaveTextContent(/Fluffy-Tailed Hog, Killed 3 times, Dead right now/);
    // Tab moves on to the next spawner; the pinned box stays.
    await userEvent.tab();
    expect(buttons[1]).toHaveFocus();
    expect(screen.getByTestId('creature-info')).toHaveTextContent(/Killed 3 times/);
    await userEvent.keyboard('{Escape}');
    expect(buttons[0]).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('creature-info')).toHaveTextContent(/Never killed/);
  });
});

describe('focusOrder', () => {
  const pts = [
    { id: 'b', x: 200, y: 110 }, { id: 'a', x: 100, y: 100 }, { id: 'c', x: 50, y: 300 }, { id: 'out', x: 5, y: 100 }, { id: 'far', x: 900, y: 100 },
  ];
  it('keeps the spawners wholly in view, row by row and left to right', () => {
    expect(focusOrder(pts, 512, 512, 10).map(p => p.id)).toEqual(['a', 'b', 'c']);
  });
  it('keeps the focused spawner when it left the view', () => {
    expect(focusOrder(pts, 512, 512, 10, 'far').map(p => p.id)).toEqual(['a', 'b', 'far', 'c']);
  });
});
