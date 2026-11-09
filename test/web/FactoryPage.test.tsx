import { QueryClient } from '@tanstack/react-query';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MeDto, WorldDto } from '../../src/shared/api.js';
import { indexDataset, type Dataset } from '../../src/shared/dataset.js';
import type { FactorySnapshot, SnapshotBuilding } from '../../src/shared/factory/snapshot.js';
import type { RecipeData } from '../../src/shared/recipes.js';
import type { WorldCtx } from '../../src/web/app/feature.js';
import { initI18n } from '../../src/web/app/i18n/index.js';
import { factoryFeature } from '../../src/web/features/factory/index.js';
import { axisPositions, labelIndices } from '../../src/web/features/factory/Timeline.js';
import { defaultCompareId, resolveTimeline, stepId, useFactoryPage } from '../../src/web/features/factory/timeline.js';
import { useFactoryView } from '../../src/web/features/factory/view.js';
import { useImportDialog } from '../../src/web/features/import/ImportDialog.js';
import { makeSummary } from './factoryFixtures.js';
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
const RECIPES: RecipeData = {
  format: 1, source: 'test', clock: { min: 0.01, perShard: 0.5 },
  items: [
    { id: 'Desc_IronIngot_C', name: { en: 'Iron Ingot', de: 'Eisenbarren' }, form: 'solid' },
    { id: 'Desc_IronPlate_C', name: { en: 'Iron Plate', de: 'Eisenplatte' }, form: 'solid' },
  ],
  recipes: [
    { id: 'Recipe_IngotIron_C', name: { en: 'Iron Ingot', de: 'Eisenbarren' }, alternate: false, machine: 'Build_SmelterMk1_C', duration: 2,
      ingredients: [], products: [{ item: 'Desc_IronIngot_C', amount: 1 }] },
    { id: 'Recipe_IronPlate_C', name: { en: 'Iron Plate', de: 'Eisenplatte' }, alternate: false, machine: 'Build_ConstructorMk1_C', duration: 6,
      ingredients: [{ item: 'Desc_IronIngot_C', amount: 3 }], products: [{ item: 'Desc_IronPlate_C', amount: 2 }] },
  ],
  machines: [
    { id: 'Build_SmelterMk1_C', name: { en: 'Smelter', de: 'Schmelzofen' }, power: 4, powerExponent: 1.3 },
    { id: 'Build_ConstructorMk1_C', name: { en: 'Constructor', de: 'Konstruktor' }, power: 4, powerExponent: 1.3 },
  ],
  extractors: [],
};

const b = (id: string, cls: string, prod: SnapshotBuilding['prod']): SnapshotBuilding => ({ id, cls, x: 0, y: 0, z: 0, yaw: 0, prod });
const snap = (saveTime: number, buildings: SnapshotBuilding[], extra: Partial<FactorySnapshot> = {}): FactorySnapshot => ({
  v: 1, meta: { sessionName: 'Alpha', saveTime, build: 1 }, buildings, lightweight: [], splines: [], powerLines: [], pathNetworks: [],
  stations: [], vehicles: [], markers: [], crates: [], ...extra,
});
const OLD = snap(1_000, [
  b('smelter', 'Build_SmelterMk1_C', { clock: 1, recipe: 'Recipe_IngotIron_C', productivity: 1 }),
  b('plate', 'Build_ConstructorMk1_C', { clock: 1, recipe: 'Recipe_IronPlate_C', productivity: 1 }),
]);
const NEW = snap(2_000, [
  b('smelter', 'Build_SmelterMk1_C', { clock: 1, recipe: 'Recipe_IngotIron_C', productivity: 0.25, issues: ['blocked'] }),
  b('plate', 'Build_ConstructorMk1_C', { clock: 1, recipe: 'Recipe_IronPlate_C', productivity: 0, issues: ['starved'] }),
  b('plate2', 'Build_ConstructorMk1_C', { clock: 1, recipe: 'Recipe_IronPlate_C', productivity: 1 }),
  b('paused', 'Build_ConstructorMk1_C', { clock: 1, recipe: 'Recipe_IronPlate_C', productivity: 0, paused: true }),
], {
  stations: [
    { id: 'st1', cls: 'Build_TruckStation_C', x: 0, y: 0, z: 0, yaw: 0, loading: true, traffic: [{ vehicle: 'tr1', avgSecBetweenDocks: 120, avgItemsPerDock: 200, capacityStacks: 25 }],
      cargo: [{ item: 'Desc_IronPlate_C', count: 50 }] },
    { id: 'st2', cls: 'Build_TruckStation_C', x: 0, y: 0, z: 0, yaw: 0, loading: false, traffic: [] },
  ],
  vehicles: [{ id: 'tr1', cls: 'BP_Tractor_C', x: 0, y: 0, z: 0, yaw: 0, autopilot: true, route: ['st1'], fuel: { item: 'Desc_IronIngot_C', amount: 5 }, cargo: [{ item: 'Desc_IronPlate_C', count: 100 }] }],
});

function setup({ list = [makeSummary(2, 2_000, 'Alpha'), makeSummary(1, 1_000, 'Alpha')], world = WORLD } = {}) {
  stubFetch({
    [`GET /api/worlds/${W}/snapshots`]: { body: list },
    [`GET /api/worlds/${W}/snapshots/1`]: { body: OLD },
    [`GET /api/worlds/${W}/snapshots/2`]: { body: NEW },
    'GET /data/test/recipes.json': { body: RECIPES },
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ctx: WorldCtx = { worldId: W, world, me: ME, index: indexDataset(DS), queryClient: client, navigate: () => {}, toast: { show: () => {} } };
  return renderWorldPages({ features: [factoryFeature], ctx, url: `/w/${W}/factory` });
}

const user = () => userEvent.setup();
const page = () => screen.findByRole('main', { name: 'Factory' });

describe('factory page', () => {
  beforeEach(() => {
    initI18n(['en']);
    useFactoryView.getState().reset();
    useFactoryPage.setState({ worldId: null });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('is a section after the map, and shows the newest save with its figures', async () => {
    setup();
    const main = await page();
    const timeline = await within(main).findByRole('region', { name: 'Timeline' });
    const points = within(timeline).getAllByRole('radio');
    expect(points).toHaveLength(2);
    expect(points[1]).toHaveAttribute('aria-checked', 'true');
    const kpis = await within(main).findByLabelText('Factory figures');
    expect(within(kpis).getByText('Machines').nextElementSibling).toHaveTextContent(/^4$/);
    expect(kpis).toHaveTextContent('2 inefficient, 1 paused');
    // Paused machines are not "stopped".
    expect(within(kpis).getByText('Stopped').nextElementSibling).toHaveTextContent(/^1 25 %$/);
    // The plain mean of the machines, as on the timeline: (0.25 + 0 + 1 + 0) / 4
    expect(within(kpis).getByText('Ø Productivity').nextElementSibling).toHaveTextContent('31 %');
  });

  it('lists shortages first, unfolds an item into its cause and machines; "On the map" highlights them and goes to the map', async () => {
    const { router } = setup();
    const main = await page();
    const items = await within(main).findByRole('region', { name: 'Inefficient items' });
    const rows = within(items).getAllByRole('row').slice(1);
    // Group heading, Iron Plate (40 nominal, 20 actual, 20 lost; the paused one is not counted), group heading, Iron Ingot.
    expect(rows[0]).toHaveTextContent('Shortage: too few ingredients');
    expect(rows[1]).toHaveTextContent('Iron Plate');
    expect(rows[1]).toHaveTextContent('40.0/min');
    expect(rows[1]).toHaveTextContent('Shortage');
    expect(rows[1]).not.toHaveTextContent('no consumer'); // it waits at a loading station
    expect(rows[2]).toHaveTextContent('Backed up and other losses');
    // Iron Ingot: 30/min nominal, 7.5 actual, 22.5 lost
    expect(rows[3]).toHaveTextContent('Iron Ingot');
    expect(rows[3]).toHaveTextContent('30.0/min');
    expect(rows[3]).toHaveTextContent('7.5/min');
    expect(rows[3]).toHaveTextContent('22.5/min');
    expect(rows[3]).toHaveTextContent('Backed up');

    const toggle = within(rows[3]!).getByRole('button', { name: /Iron Ingot/ });
    await user().click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const machines = document.getElementById(toggle.getAttribute('aria-controls')!)!;
    // The cause across the chain: its makers back up while the plate constructors starve.
    expect(machines).toHaveTextContent('Transport in between is the limit');
    expect(machines).toHaveTextContent('Iron Plate 3 (1 Paused, 1 Shortage, 1 full)');
    expect(machines).toHaveTextContent('Smelter');
    expect(machines).toHaveTextContent('25 %');
    await user().click(within(machines).getByRole('button', { name: 'Show Smelter on the map' }));
    expect(useFactoryView.getState().highlight).toEqual(['smelter']);
    expect(useFactoryView.getState().highlightSeq).toBe(1);
    expect(router.state.location.pathname).toBe(`/w/${W}`);
  });

  it('steps through the timeline with the arrow keys and the older/newer buttons', async () => {
    setup();
    const main = await page();
    const group = await within(main).findByRole('radiogroup', { name: 'Saves' });
    fireEvent.keyDown(group, { key: 'ArrowLeft' });
    expect(useFactoryView.getState().selectedId).toBe(1);
    // The old save: everything ran fully.
    expect(await within(main).findByText('Every machine makes what it should. Nothing is lost.')).toBeInTheDocument();
    expect(within(main).getByRole('button', { name: 'Older save' })).toBeDisabled();
    await user().click(within(main).getByRole('button', { name: 'Newer save' }));
    // The newest is "null" (follows new saves).
    expect(useFactoryView.getState().selectedId).toBeNull();
  });

  it('compares with the save before: figures with their change, and what was built and got worse', async () => {
    setup();
    const main = await page();
    await within(main).findByRole('region', { name: 'Inefficient items' });
    await user().click(within(main).getByRole('checkbox', { name: 'Compare with' }));
    expect(useFactoryView.getState().compareId).toBe(1);
    const changes = await within(main).findByRole('region', { name: 'Changes' });
    expect(changes).toHaveTextContent('2 built, 0 torn down');
    expect(within(changes).getByRole('heading', { name: 'Worse (2)' })).toBeInTheDocument();
    expect(within(main).getByLabelText('Factory figures')).toHaveTextContent('+1 since');
    await user().click(within(main).getByRole('checkbox', { name: 'Compare with' }));
    expect(useFactoryView.getState().compareId).toBeNull();
    expect(within(main).queryByRole('region', { name: 'Changes' })).toBeNull();
  });

  it('filters the inefficient machines by reason and class', async () => {
    setup();
    const main = await page();
    const machines = await within(main).findByRole('region', { name: 'Machines' });
    const list = () => within(machines).getByRole('region', { name: /^(Inefficient machines|Machines: )/ });
    expect(within(list()).getAllByRole('listitem')).toHaveLength(2);
    const filters = () => within(machines).getByRole('group', { name: 'Filter' });
    await user().click(within(filters()).getByRole('button', { name: /Shortage/ }));
    expect(within(list()).getAllByRole('listitem')).toHaveLength(1);
    expect(list()).toHaveTextContent('Constructor');
    await user().click(within(machines).getByRole('button', { name: 'Clear filter' }));
    // Paused is a state of its own, not inefficient.
    await user().click(within(filters()).getByRole('button', { name: /Paused\s*1/ }));
    expect(within(list()).getAllByRole('listitem')).toHaveLength(1);
    await user().click(within(machines).getByRole('button', { name: 'Clear filter' }));
    // The class filter (a toggle), not the machine's row, which opens its window.
    await user().click(within(machines).getByRole('button', { name: /^Smelter/, pressed: false }));
    expect(useFactoryPage.getState().cls).toBe('Build_SmelterMk1_C');
    expect(within(list()).getAllByRole('listitem')).toHaveLength(1);
    expect(list()).toHaveTextContent('Smelter');
    // The chips count within the class.
    expect(within(filters()).getByRole('button', { name: /Backed up\s*1/ })).toBeInTheDocument();
    expect(within(filters()).queryByRole('button', { name: /Shortage/ })).toBeNull();
  });

  it('opens a machine of the lists as the game\'s machine window in a popup; outside, Esc and × close it', async () => {
    setup();
    const u = user();
    const main = await page();
    const machines = await within(main).findByRole('region', { name: 'Machines' });
    const row = (name: RegExp) => within(machines).getAllByTestId('machine-open').find(b => name.test(b.textContent ?? ''))!;
    await u.click(row(/^Constructor/));
    const dialog = await screen.findByRole('dialog', { name: 'Constructor' });
    expect(row(/^Constructor/)).toHaveAttribute('aria-haspopup', 'dialog');
    expect(within(dialog).getByRole('region', { name: 'Status' })).toHaveTextContent('0 %StoppedReasonShortage');
    expect(within(dialog).getByRole('region', { name: 'Recipe' })).toHaveTextContent('Iron Plate');
    const production = within(dialog).getByRole('region', { name: 'Production' });
    expect([...production.querySelectorAll('[data-slot]')].map(li => li.textContent)).toEqual(['Iron Ingot0.0/minof 30.0/min', 'Iron Plate0.0/minof 20.0/min']);
    // Opened with the mouse: the focus stays on the row.
    expect(row(/^Constructor/)).toHaveFocus();

    // Inside: stays. Another machine: moves there.
    await u.click(production);
    expect(screen.getByRole('dialog', { name: 'Constructor' })).toBeInTheDocument();
    await u.click(row(/^Smelter/));
    expect(await screen.findByRole('dialog', { name: 'Smelter' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Constructor' })).toBeNull();
    // Outside closes it.
    await u.click(within(main).getByRole('region', { name: 'Timeline' }));
    expect(screen.queryByRole('dialog')).toBeNull();

    // From the keyboard the focus moves into it; Esc closes it and gives the focus back.
    row(/^Smelter/).focus();
    await u.keyboard('{Enter}');
    const smelter = await screen.findByRole('dialog', { name: 'Smelter' });
    await waitFor(() => expect(within(smelter).getByRole('heading', { name: 'Smelter' })).toHaveFocus());
    await u.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(row(/^Smelter/)).toHaveFocus();

    await u.click(row(/^Smelter/));
    await u.click(within(await screen.findByRole('dialog', { name: 'Smelter' })).getByRole('button', { name: 'Close Smelter' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows stations (problems first) with their throughput and vehicles with their cargo and route', async () => {
    setup();
    const main = await page();
    const routes = await within(main).findByRole('region', { name: 'Stations and vehicles' });
    const rows = within(routes).getAllByRole('row');
    expect(rows[1]).toHaveTextContent('Truck Station 2');
    expect(rows[1]).toHaveTextContent('No vehicle stops here');
    const row = rows[2]!;
    expect(row).toHaveTextContent('Truck Station 1');
    expect(row).toHaveTextContent('near Grass Fields');
    expect(row).toHaveTextContent('Loading');
    expect(row).toHaveTextContent('100.0/min'); // 200 per dock every 120 s
    expect(row).toHaveTextContent('2 min 0 s');
    expect(within(row).getAllByRole('cell')[2]).toHaveTextContent('Iron Plate');
    expect(within(routes).getByRole('list', { name: 'Stops of Tractor 1' })).toHaveTextContent('Truck Station 1');
    expect(routes).toHaveTextContent('Iron Ingot: 5 in the tank');
    expect(routes).toHaveTextContent(/Carries:\s*Iron Plate 100/);
  });

  it('without snapshots explains how to get them and opens the import dialog (owner)', async () => {
    setup({ list: [] });
    const main = await page();
    expect(await within(main).findByRole('region', { name: 'No factory data yet' })).toBeInTheDocument();
    await user().click(within(main).getByRole('button', { name: 'Add older saves' }));
    expect(useImportDialog.getState()).toMatchObject({ open: true, mode: 'older' });
    useImportDialog.getState().hide();
  });

  it('a member is told the owner imports', async () => {
    setup({ list: [], world: { ...WORLD, role: 'member', owner: { id: 2, displayName: 'Ada' } } });
    const main = await page();
    expect(await within(main).findByText(/Ada owns this world/)).toBeInTheDocument();
    expect(within(main).queryByRole('button', { name: 'Import save' })).toBeNull();
  });

  it('speaks German with the game\'s terms', async () => {
    initI18n(['de']);
    setup();
    const main = await screen.findByRole('main', { name: 'Fabrik' });
    const items = await within(main).findByRole('region', { name: 'Ineffiziente Gegenstände' });
    expect(within(items).getByRole('columnheader', { name: 'Gegenstand' })).toBeInTheDocument();
    expect(items).toHaveTextContent('Eisenbarren');
    expect(items).toHaveTextContent('Stau');
    expect(items).toHaveTextContent('Mangel');
    expect(within(main).getByRole('checkbox', { name: 'Vergleichen mit' })).toBeInTheDocument();
  });
});

describe('timeline helpers', () => {
  const list = [makeSummary(3, 3_000), makeSummary(1, 1_000), makeSummary(2, 2_000)];

  it('resolves the selection: newest by default, a chosen one, the compared one never the selected', () => {
    const sel = resolveTimeline(list, null, null);
    expect(sel.ordered.map(s => s.id)).toEqual([1, 2, 3]);
    expect(sel.selected?.id).toBe(3);
    expect(stepId(sel, -1)).toBe(2);
    expect(stepId(sel, 1)).toBeNull();
    expect(defaultCompareId(sel)).toBe(2);
    expect(resolveTimeline(list, 1, 1).compared).toBeNull();
    expect(resolveTimeline(list, 1, 3).compared?.id).toBe(3);
    expect(defaultCompareId(resolveTimeline(list, 1, null))).toBe(2);
    expect(resolveTimeline(list, 99, null).selected?.id).toBe(3); // a deleted snapshot: back to the newest
    expect(resolveTimeline(undefined, null, null)).toMatchObject({ ordered: [], selected: null, index: -1 });
  });

  it('places points by time, pushed apart where saves are close, and labels points that do not collide', () => {
    expect(axisPositions([5])).toEqual([50]);
    expect(axisPositions([0, 50, 100])).toEqual([0, 50, 100]);
    const close = axisPositions([0, 1, 2, 100]);
    expect(close[1]! - close[0]!).toBeGreaterThanOrEqual(3.9);
    expect(close[3]).toBeCloseTo(100);
    expect(labelIndices([0, 3, 50, 100], 1, -1)).toEqual([1, 2, 3]);
  });
});
