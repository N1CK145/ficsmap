import { QueryClient } from '@tanstack/react-query';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MeDto, WorldDto } from '../../src/shared/api.js';
import { indexDataset, type Dataset } from '../../src/shared/dataset.js';
import type { FactorySnapshot } from '../../src/shared/factory/snapshot.js';
import type { WorldCtx } from '../../src/web/app/feature.js';
import { initI18n } from '../../src/web/app/i18n/index.js';
import { useFactoryPage } from '../../src/web/features/factory/timeline.js';
import { useFactoryView } from '../../src/web/features/factory/view.js';
import { statsFeature } from '../../src/web/features/stats/index.js';
import { makeSnapshot, makeSummary } from './factoryFixtures.js';
import { stubFetch } from './fetchStub.js';
import { renderWorldPages } from './worldPages.js';

const W = '6f1c2b0e-8a43-4f5e-9d1b-2c3d4e5f6a7b';
const ME: MeDto = { id: 1, displayName: 'Nick', avatarUrl: null, email: null, datasetVersion: 'test' };
const WORLD: WorldDto = {
  id: W, name: 'Alpha', role: 'owner', rev: 1, datasetVersion: 'test', owner: { id: 1, displayName: 'Nick' }, members: [], lastImport: null,
};
const DS: Dataset = {
  version: 'test', build: 1, bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 }, mapId: 'm', podRequirementsKnown: true,
  biomes: [{ id: 'g', name: { en: 'Grass Fields', de: 'Grasfelder' } }], items: [['Pod_1', 'hard_drive', 0, 0, 0, 0, 1]], aliases: {},
};

const P1 = 'BP_PlayerState_C_1', P2 = 'BP_PlayerState_C_2';
const WITH_STATS: FactorySnapshot = {
  ...makeSnapshot('Alpha', 2_000),
  meta: { sessionName: 'Alpha', saveTime: 2_000, build: 1, playTimeSec: 3 * 3600 + 25 * 60 },
  players: [{ id: P1, name: 'Reinsch', pos: [0.5, 0.5, 0] }, { id: P2, name: 'N1CK145' }],
  stats: {
    consumed: [['Desc_Nut_C', 212]], killed: [['Char_Hog_C', 94], ['Char_Stinger_Child_C', 42]], produced: [],
    crafted: [[P1, 'Desc_IronPlate_C', 200]], pickedUp: [[P2, 'Desc_Leaves_C', 5]],
    built: [{ cls: 'Build_ConstructorMk1_C', total: 10, dismantled: 1, current: 9, max: 10, by: [[P1, 7, 0], [P2, 3, 1]] }],
  },
};

function setup() {
  const older = { ...makeSummary(1, 1_000, 'Alpha'), deathCrates: ['BP_Crate_C_1'] };
  const newer = { ...makeSummary(2, 2_000, 'Alpha'), deathCrates: ['BP_Crate_C_1', 'BP_Crate_C_2'] };
  stubFetch({
    [`GET /api/worlds/${W}/snapshots`]: { body: [newer, older] },
    [`GET /api/worlds/${W}/snapshots/1`]: { body: makeSnapshot('Alpha', 1_000) },
    [`GET /api/worlds/${W}/snapshots/2`]: { body: WITH_STATS },
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ctx: WorldCtx = { worldId: W, world: WORLD, me: ME, index: indexDataset(DS), queryClient: client, navigate: () => {}, toast: { show: () => {} } };
  return renderWorldPages({ features: [statsFeature], ctx, url: `/w/${W}/stats` });
}

describe('statistics page', () => {
  beforeEach(() => {
    initI18n(['en']);
    useFactoryView.getState().reset();
    useFactoryPage.setState({ worldId: null });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('shows the world of the newest save: play time, deaths over the saves, kills, buildings', async () => {
    setup();
    const main = await screen.findByRole('main', { name: 'Statistics' });
    const figures = await within(main).findByLabelText('Figures');
    expect(within(figures).getByText('Play time').nextElementSibling).toHaveTextContent('3 h 25 min');
    // A lower bound: the distinct death crates over the saves up to this one.
    expect(within(figures).getByTestId('stats-deaths')).toHaveTextContent(/^≥ 2$/);
    expect(within(figures).getByText('Creatures killed').nextElementSibling).toHaveTextContent(/^136$/);
    expect(within(figures).getByText('Built').nextElementSibling).toHaveTextContent(/^10/);
    expect(within(main).getByTestId('stats-killed')).toHaveTextContent('Fluffy-Tailed Hog94Small Stinger42');
    expect(within(main).getByTestId('stats-built')).toHaveTextContent(/Constructor.*10.*1.*9.*10/);
    // The players side by side, most built first; the timeline has no comparison here.
    expect(within(main).getByTestId('stats-players')).toHaveTextContent(/Reinsch.*7.*0.*200.*0.*N1CK145.*3.*1.*0.*5/);
    expect(within(main).queryByRole('checkbox', { name: 'Compare with' })).toBeNull();
  });

  it('switches between the world and each player (kept in the URL); per player only what the game counts per player', async () => {
    const { router } = setup();
    const main = await screen.findByRole('main', { name: 'Statistics' });
    const view = await within(main).findByRole('radiogroup', { name: 'View' });
    expect(within(view).getAllByRole('radio').map(r => r.textContent)).toEqual(['World', 'Reinsch', 'N1CK145']);
    await userEvent.click(within(view).getByRole('radio', { name: 'N1CK145' }));
    expect(router.state.location.search).toBe('?p=N1CK145');
    const figures = within(main).getByLabelText('Figures');
    expect(within(figures).getByText('Built').nextElementSibling).toHaveTextContent(/^3$/);
    expect(within(figures).getByText('Dismantled').nextElementSibling).toHaveTextContent(/^1$/);
    expect(within(main).getByTestId('stats-position')).toHaveTextContent('No character in the save');
    expect(within(main).queryByTestId('stats-killed')).toBeNull();
    await userEvent.click(within(view).getByRole('radio', { name: 'Reinsch' }));
    expect(within(main).getByTestId('stats-position')).toHaveTextContent('Area: Grass Fields');
    expect(within(main).getByRole('button', { name: 'On the map' })).toBeInTheDocument();
  });

  it('says so for a save imported before statistics were read', async () => {
    setup();
    useFactoryView.getState().select(1);
    const main = await screen.findByRole('main', { name: 'Statistics' });
    expect(await within(main).findByTestId('stats-unknown')).toBeInTheDocument();
  });
});
