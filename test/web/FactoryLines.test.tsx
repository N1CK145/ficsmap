import { QueryClient } from '@tanstack/react-query';
import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MeDto, WorldDto } from '../../src/shared/api.js';
import type { BuildingsFile } from '../../src/shared/buildings.js';
import { indexDataset, type Dataset } from '../../src/shared/dataset.js';
import type { FactorySnapshot, SnapshotBuilding } from '../../src/shared/factory/snapshot.js';
import type { RecipeData } from '../../src/shared/recipes.js';
import type { WorldCtx } from '../../src/web/app/feature.js';
import { initI18n } from '../../src/web/app/i18n/index.js';
import { factoryFeature, linePath } from '../../src/web/features/factory/index.js';
import { useFactoryPage } from '../../src/web/features/factory/timeline.js';
import { useFactoryView } from '../../src/web/features/factory/view.js';
import { useImportDialog } from '../../src/web/features/import/ImportDialog.js';
import { makeSummary } from './factoryFixtures.js';
import { stubFetch } from './fetchStub.js';
import { stubMatchMedia } from './matchMedia.js';
import { renderWorldPages } from './worldPages.js';

// `buildLines` is a stub until the data branch is merged: the page gets the fixture lines for a snapshot with links.
vi.mock('../../src/shared/factory/lines.js', async importOriginal => {
  const real = await importOriginal<typeof import('../../src/shared/factory/lines.js')>();
  const { LINES } = await import('./lineFixtures.js');
  return { ...real, buildLines: (s: Pick<FactorySnapshot, 'links'>) => (s.links?.length ? LINES : { lines: [], index: new Map() }) };
});

const W = '6f1c2b0e-8a43-4f5e-9d1b-2c3d4e5f6a7b';
const ME: MeDto = { id: 1, displayName: 'Nick', avatarUrl: null, email: null, datasetVersion: 'test' };
const WORLD: WorldDto = {
  id: W, name: 'Alpha', isOwner: true, rev: 1, datasetVersion: 'test', owner: { id: 1, displayName: 'Nick' }, members: [], lastImport: null,
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
const named = (en: string, de: string, category: BuildingsFile['buildings'][string]['category']) => ({ name: { en, de }, category });
const BUILDINGS: BuildingsFile = {
  version: 'test',
  buildings: {
    Build_SmelterMk1_C: named('Smelter', 'Schmelzofen', 'production'),
    Build_ConstructorMk1_C: named('Constructor', 'Konstruktor', 'production'),
    Build_ConveyorAttachmentMerger_C: named('Conveyor Merger', 'Förderband-Fusionator', 'logistics-belt'),
    Build_StorageContainerMk1_C: named('Storage Container', 'Lagercontainer', 'storage'),
    Build_ConveyorBeltMk1_C: named('Conveyor Belt Mk.1', 'Förderband Mk.1', 'logistics-belt'),
    Build_ConveyorBeltMk2_C: named('Conveyor Belt Mk.2', 'Förderband Mk.2', 'logistics-belt'),
  },
};

const b = (id: string, cls: string, prod?: SnapshotBuilding['prod']): SnapshotBuilding => ({ id, cls, x: 0, y: 0, z: 0, yaw: 0, ...(prod ? { prod } : {}) });
const SMELT = { clock: 1, recipe: 'Recipe_IngotIron_C' };
const PLATE = { clock: 1, recipe: 'Recipe_IronPlate_C' };
const snap = (links: FactorySnapshot['links']): FactorySnapshot => ({
  v: 1, meta: { sessionName: 'Alpha', saveTime: 2_000, build: 1 },
  buildings: [
    b('smelter', 'Build_SmelterMk1_C', { ...SMELT, productivity: 0.25, issues: ['blocked'] }),
    b('smelter2', 'Build_SmelterMk1_C', { ...SMELT, productivity: 1 }),
    b('merger', 'Build_ConveyorAttachmentMerger_C'),
    b('plate', 'Build_ConstructorMk1_C', { ...PLATE, productivity: 0, issues: ['starved'] }),
    b('plate2', 'Build_ConstructorMk1_C', { ...PLATE, productivity: 1 }),
    b('paused', 'Build_ConstructorMk1_C', { ...PLATE, productivity: 0, paused: true }),
    b('box', 'Build_StorageContainerMk1_C'),
    b('solo', 'Build_ConstructorMk1_C', { ...PLATE, productivity: 1 }),
  ],
  lightweight: [], splines: [], powerLines: [], pathNetworks: [], stations: [], vehicles: [], markers: [], crates: [], ...(links ? { links } : {}),
});
const LINKED = snap([{ from: 'smelter', to: 'merger', kind: 'belt', via: ['belt1'], slowest: 'Build_ConveyorBeltMk1_C' }]);

function setup({ snapshot = LINKED, url = `/w/${W}/factory`, world = WORLD } = {}) {
  stubFetch({
    [`GET /api/worlds/${W}/snapshots`]: { body: [makeSummary(2, 2_000, 'Alpha')] },
    [`GET /api/worlds/${W}/snapshots/2`]: { body: snapshot },
    'GET /data/test/recipes.json': { body: RECIPES },
    'GET /data/test/buildings.json': { body: BUILDINGS },
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ctx: WorldCtx = { worldId: W, world, me: ME, index: indexDataset(DS), queryClient: client, navigate: () => {}, toast: { show: () => {} } };
  return renderWorldPages({ features: [factoryFeature], ctx, url });
}

const user = () => userEvent.setup();
const section = () => screen.findByRole('region', { name: 'Production lines' });
const list = async () => within(await section()).getByRole('list', { name: 'Production lines' });
const diagram = (name = 'Production line Iron Plate') => screen.findByRole('group', { name });
/** A node by the start of its accessible name. */
const node = async (start: string) => within(await diagram()).getByRole('button', { name: new RegExp(`^${start.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) });

describe('production lines on the factory page', () => {
  beforeEach(() => {
    initI18n(['en']);
    useFactoryView.getState().reset();
    useFactoryPage.setState({ worldId: null, line: null, machinesOnly: null });
    useImportDialog.setState({ open: false });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('lists the lines after the figures and draws the first one like the planner', async () => {
    setup();
    const sec = await section();
    expect(sec).toHaveTextContent('2 lines · 6 machines');
    const buttons = within(await list()).getAllByRole('button');
    expect(buttons).toHaveLength(2);
    expect(buttons[0]).toHaveAttribute('aria-pressed', 'true');
    expect(buttons[0]).toHaveTextContent('Iron Plate');
    expect(buttons[0]).toHaveTextContent('5 machines');
    expect(buttons[0]).toHaveTextContent('40 %');
    expect(buttons[0]).toHaveTextContent('Bottleneck');
    expect(buttons[1]).not.toHaveTextContent('Bottleneck');

    // Nodes: the group's machines, product, rate of the nominal one, productivity, reasons with counts.
    const smelters = await node('2× Smelter');
    expect(smelters).toHaveAccessibleName('2× Smelter, Iron Ingot, 37.5/min of 60.0/min, 63 % Part load, Backed up 1');
    expect(smelters).toHaveTextContent('2× Smelter');
    expect(smelters).toHaveTextContent('37.5/min of 60.0/min');
    expect(smelters).toHaveTextContent('63 %');
    expect(smelters.querySelector('[data-picture]')).toBeInTheDocument();
    expect(smelters.querySelector('[data-pin="Desc_IronIngot_C"]')).toBeNull(); // no icons in the test dataset
    const plates = await node('3× Constructor');
    expect(plates).toHaveTextContent('Shortage');
    expect(plates).toHaveTextContent('Paused');
    // Logistics nodes are small and neutral, named by their building.
    expect(await node('Conveyor Merger')).toHaveStyle({ width: '172px' });
    expect(plates).toHaveStyle({ width: '236px' });

    // The bottleneck in a sentence above the diagram.
    expect(sec.querySelector('[data-bottleneck]')).toHaveTextContent(
      'Bottleneck: Conveyor Belt Mk.1 full between 2× Smelter (Iron Ingot) and Conveyor Merger (60.0/min of 60) – upgrade to Conveyor Belt Mk.2',
    );
    expect(await diagram()).toHaveAccessibleDescription(/^Inputs at the top, products at the bottom/);
  });

  it('draws the bottleneck belt apart by colour and glyph, the others by their load', async () => {
    setup();
    const d = await diagram();
    const full = d.querySelector('path[data-from="g-smelt"][data-to="g-merge"]')!;
    expect(full).toHaveAttribute('data-edge', 'bottleneck');
    expect(full).toHaveClass('stroke-conflict');
    const half = d.querySelector('path[data-from="g-merge"][data-to="g-plate"]')!;
    expect(half).toHaveAttribute('data-edge', 'flow');
    expect(Number(full.getAttribute('stroke-width'))).toBeGreaterThan(Number(half.getAttribute('stroke-width')));
    const label = d.querySelector('[data-label-to="g-merge"]')!;
    expect(label).toHaveTextContent('60.0/min');
    expect(label).toHaveTextContent('of 60');
    expect(label.querySelector('[data-neck]')).toBeInTheDocument();
    expect(label.querySelector('[data-full]')).toBeNull();
    expect(d.querySelector('[data-label-to="g-plate"]')).toHaveTextContent('30.0/min of 120');
    expect(d.querySelector('[data-label-to="g-plate"] [data-neck]')).toBeNull();
    const legend = within(await section()).getByRole('list', { name: 'Legend' });
    expect(legend).toHaveTextContent('Bottleneck');
    // Every band, so a node's strip can always be read off.
    expect(legend).toHaveTextContent('Part load');
    expect(legend).toHaveTextContent('Nearly full');
  });

  it('opens a group\'s machines from its node; "On the map" shows them; Escape puts the focus back', async () => {
    const { router } = setup();
    const smelters = await node('2× Smelter');
    await user().click(smelters);
    expect(smelters).toHaveAttribute('aria-expanded', 'true');
    const panel = document.getElementById(smelters.getAttribute('aria-controls')!)!;
    expect(panel).toHaveTextContent('2× Smelter');
    const members = within(panel).getByRole('list', { name: 'Buildings of this group' });
    // Worst first, each with its productivity and reasons.
    const rows = within(members).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('25 %');
    expect(rows[0]).toHaveTextContent('Backed up');
    expect(rows[1]).toHaveTextContent('100 %');
    // The selected node's edges stand out, the others fade.
    const d = await diagram();
    expect(d.querySelector('path[data-from="g-smelt"]')).toHaveAttribute('data-state', 'hot');
    expect(d.querySelector('path[data-from="g-plate"]')).toHaveAttribute('data-state', 'dim');

    fireEvent.keyDown(within(panel).getByRole('heading', { name: '2× Smelter' }), { key: 'Escape' });
    expect(document.getElementById(smelters.getAttribute('aria-controls') ?? 'none')).toBeNull();
    expect(smelters).toHaveFocus();

    await user().click(smelters);
    const again = document.getElementById(smelters.getAttribute('aria-controls')!)!;
    await user().click(within(again).getByRole('button', { name: 'Show 2× Smelter on the map' }));
    expect(useFactoryView.getState().highlight).toEqual(['smelter', 'smelter2']);
    expect(router.state.location.pathname).toBe(`/w/${W}`);
  });

  it('"Machines only" leaves out the splitters and mergers', async () => {
    setup();
    const toggle = within(await section()).getByRole('button', { name: 'Machines only' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await user().click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(useFactoryPage.getState().machinesOnly).toBe(true);
    const d = await diagram();
    expect(within(d).queryByRole('button', { name: /^Conveyor Merger/ })).toBeNull();
    expect(d.querySelector('path[data-from="g-smelt"][data-to="g-plate"]')).toBeInTheDocument();
    expect(d.querySelector('[data-label-to="g-plate"]')).toHaveTextContent('30.0/min of 120');
    // The bottleneck sentence still names the belt the diagram now leaves out.
    expect((await section()).querySelector('[data-bottleneck]')).toHaveTextContent('Bottleneck: Conveyor Belt Mk.1 full between 2× Smelter (Iron Ingot) and Conveyor Merger');
    expect(within(await section()).getByRole('list', { name: 'Legend' })).toHaveTextContent('estimated');
  });

  it('moves between the groups with the arrow keys', async () => {
    setup();
    const smelters = await node('2× Smelter');
    smelters.focus();
    fireEvent.keyDown(smelters, { key: 'ArrowDown' });
    expect(await node('Conveyor Merger')).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: 'End' });
    expect(await node('Storage Container')).toHaveFocus();
  });

  it('"Map" in the switch selects the line in the shared view and goes to the map', async () => {
    const { router } = setup();
    const sw = within(await section()).getByRole('radiogroup', { name: 'Show line as' });
    expect(within(sw).getByRole('radio', { name: 'Diagram' })).toHaveAttribute('aria-checked', 'true');
    await user().click(within(sw).getByRole('radio', { name: 'Map' }));
    expect(useFactoryView.getState().lineId).toBe('plate');
    expect(router.state.location.pathname).toBe(`/w/${W}`);
  });

  it('choosing a line shows its diagram and puts it in the address; the address opens it again', async () => {
    const { router } = setup();
    const buttons = within(await list()).getAllByRole('button');
    await user().click(buttons[1]!);
    expect(buttons[1]).toHaveAttribute('aria-pressed', 'true');
    expect(router.state.location.search).toBe('?line=solo');
    expect(useFactoryPage.getState().line).toBe('solo');
    expect(await screen.findByRole('group', { name: 'Production line Iron Plate' })).toBeInTheDocument();
    expect(screen.queryByText(/^Bottleneck:/)).toBeNull();
    expect(screen.getAllByRole('button', { name: /^1× Constructor/ })).toHaveLength(1);
  });

  it('opens the line named in the address (the map\'s "As diagram")', async () => {
    expect(linePath(W, 'solo')).toBe(`/w/${W}/factory?line=solo`);
    setup({ url: linePath(W, 'solo') });
    const buttons = within(await list()).getAllByRole('button');
    expect(buttons[1]).toHaveAttribute('aria-pressed', 'true');
    expect(useFactoryPage.getState().line).toBe('solo');
    expect(await within(await diagram()).findByRole('button', { name: /^1× Constructor/ })).toBeInTheDocument();
  });

  it('an unknown line in the address falls back to the first', async () => {
    setup({ url: linePath(W, 'gone') });
    const buttons = within(await list()).getAllByRole('button');
    expect(buttons[0]).toHaveAttribute('aria-pressed', 'true');
  });

  it('a save without connections says to import it again', async () => {
    setup({ snapshot: snap(undefined) });
    const sec = await section();
    expect(await within(sec).findByText('Connections are missing in this save. Import the save again to see the production lines.')).toBeInTheDocument();
    expect(within(sec).queryByRole('radiogroup')).toBeNull();
    await user().click(within(sec).getByRole('button', { name: 'Import save again' }));
    expect(useImportDialog.getState().open).toBe(true);
  });

  it('a member is told the owner can import it again', async () => {
    setup({ snapshot: snap([]), world: { ...WORLD, isOwner: false, owner: { id: 2, displayName: 'Ada' } } });
    const sec = await section();
    expect(await within(sec).findByText('Ada owns this world and can import it again.')).toBeInTheDocument();
    expect(within(sec).queryByRole('button', { name: 'Import save again' })).toBeNull();
  });

  it('lists the groups top down on a phone, above the diagram', async () => {
    stubMatchMedia({ '(max-width: 639px)': true });
    setup();
    const groups = within(await section()).getByRole('list', { name: 'Groups of this line' });
    const rows = within(groups).getAllByRole('button');
    // The machine groups; the logistics stay in the diagram.
    expect(rows.map(r => r.textContent)).toEqual([expect.stringContaining('2× Smelter · Iron Ingot'), expect.stringContaining('3× Constructor · Iron Plate')]);
    expect(await section()).toHaveTextContent('2 logistics buildings (splitters, storage, stations) are in the diagram below.');
    await user().click(rows[1]!);
    expect(rows[1]).toHaveAttribute('aria-expanded', 'true');
    expect(document.getElementById(rows[1]!.getAttribute('aria-controls')!)).toHaveTextContent('3× Constructor');
    // "Fit to width" on a phone too (doing nothing while the diagram fits).
    expect(within(await section()).getByRole('button', { name: 'Fit to width' })).toBeInTheDocument();
  });

  it('speaks German with the game\'s terms', async () => {
    initI18n(['de']);
    setup();
    const sec = await screen.findByRole('region', { name: 'Produktionsstränge' });
    expect(sec).toHaveTextContent('2 Stränge · 6 Maschinen');
    expect(sec.querySelector('[data-bottleneck]')).toHaveTextContent(
      'Engpass: Förderband Mk.1 voll zwischen 2× Schmelzofen (Eisenbarren) und Förderband-Fusionator (60,0/min von 60) – auf Förderband Mk.2 aufrüsten',
    );
    const sw = within(sec).getByRole('radiogroup', { name: 'Strang zeigen als' });
    expect(within(sw).getAllByRole('radio').map(r => r.textContent)).toEqual(['Diagramm', 'Karte']);
    const d = await screen.findByRole('group', { name: 'Produktionsstrang Eisenplatte' });
    expect(within(d).getByRole('button', { name: /^3× Konstruktor, Eisenplatte, 20,0\/min von 40,0\/min, 33 % Teillast, Mangel 1, Pausiert 1$/ })).toBeInTheDocument();
    expect(d.querySelector('[data-label-to="g-plate"]')).toHaveTextContent('30,0/min von 120');
    expect(within(sec).getByRole('list', { name: 'Legende' })).toHaveTextContent('Voll (≥ 95 %)');
  });
});
