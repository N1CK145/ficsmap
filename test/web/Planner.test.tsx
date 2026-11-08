import { QueryClient } from '@tanstack/react-query';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MeDto, WorldDto } from '../../src/shared/api.js';
import { indexDataset } from '../../src/shared/dataset.js';
import { indexRecipes } from '../../src/shared/recipes.js';
import { collect, type WorldCtx } from '../../src/web/app/feature.js';
import { initI18n } from '../../src/web/app/i18n/index.js';
import type { ToastInput } from '../../src/web/components/Toast.js';
import { FEATURES } from '../../src/web/features/index.js';
import { matchItems } from '../../src/web/features/planner/ItemPicker.js';
import { plannerFeature, plannerTool } from '../../src/web/features/planner/index.js';
import { EXAMPLE } from '../../src/web/features/planner/Planner.js';
import { loadPlanner, usePlanner } from '../../src/web/features/planner/usePlanner.js';
import { useNodeLayer } from '../../src/web/features/resourceNodes/useResourceNodes.js';
import { useUiStore } from '../../src/web/app/store.js';
import { RECIPE_DATA } from '../fixtures/recipeData.js';
import { stubFetch, type StubRoute } from './fetchStub.js';
import { MOBILE, stubMatchMedia } from './matchMedia.js';
import { renderWorldPages } from './worldPages.js';

const W = '6f1c2b0e-8a43-4f5e-9d1b-2c3d4e5f6a7b';
const ME: MeDto = { id: 1, displayName: 'Nick', avatarUrl: null, email: null, datasetVersion: 'test' };
const WORLD: WorldDto = {
  id: W, name: 'Alpha', isOwner: true, rev: 1, datasetVersion: 'test', owner: { id: 1, displayName: 'Nick' }, members: [], lastImport: null,
};

function setup(recipes: 'present' | 'missing' = 'present', worldVersion = WORLD.datasetVersion, more: Record<string, StubRoute> = {}) {
  const { calls } = stubFetch({ ...(recipes === 'present' ? { 'GET /data/test/recipes.json': { body: RECIPE_DATA } } : {}), ...more });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const index = indexDataset({ version: 'test', build: 1, bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 }, mapId: 'm', podRequirementsKnown: true, biomes: [], items: [], aliases: {} });
  const toast = { show: vi.fn<(t: ToastInput) => void>() };
  const ctx: WorldCtx = { worldId: W, world: { ...WORLD, datasetVersion: worldVersion }, me: ME, index, queryClient: client, navigate: () => {}, toast };
  const { router } = renderWorldPages({ features: [plannerFeature], ctx, url: `/w/${W}` });
  return { calls, router, toast };
}

/** A step's row in the list view: its row header starts with the item. */
const stepOf = (name: string) => screen.getByRole('rowheader', { name: new RegExp(`^${name}(\\s|$)`) }).closest('tr')!;
/** A step's buildings cell in the list view ("3× Constructor"; on a phone it moves under the rate). */
const built = (name: string) => within(stepOf(name).cells[2]!);
/** Opens a step's panel from its row (list view) and returns the panel. */
async function openStep(name: string, panel = `Edit ${name}`) {
  await userEvent.click(within(stepOf(name)).getByRole('button'));
  return screen.getByRole('region', { name: panel });
}
/** Replaces a step's clock speed in its panel. */
async function setClock(editor: HTMLElement, value: string, label = 'Clock speed') {
  const field = within(editor).getByRole('spinbutton', { name: label });
  await userEvent.clear(field);
  await userEvent.type(field, value);
}
/** A big figure of the totals by its label: its value. */
const tile = (totals: HTMLElement, label: string) => within(totals).getByText(label, { selector: 'dt' }).nextElementSibling!.textContent;
/** The rows of a totals list: label (with its second line) and value. */
const rows = (list: HTMLElement) => within(list).getAllByRole('term').map(dt => [dt.textContent, dt.nextElementSibling!.textContent]);
/** The totals' folded list of buildings (a `details`). */
const buildingsFold = (totals: HTMLElement, label = 'Buildings') => within(totals).getByText(label, { selector: 'summary *' }).closest('details')!;

/** Picks an item into the first row of an already open planner. */
async function openAndPickAgain(query: string) {
  await userEvent.type(screen.getByRole('combobox', { name: 'Item 1' }), query);
  await userEvent.keyboard('{Enter}');
}

/** Replaces the item in the first row of an already open planner. */
async function openAndPickAgainClear(query: string) {
  await userEvent.clear(screen.getByRole('combobox', { name: 'Item 1' }));
  await openAndPickAgain(query);
}

async function openAndPick(query: string) {
  await userEvent.click(screen.getByRole('link', { name: 'Planner' }));
  const box = await screen.findByRole('combobox', { name: 'Item 1' });
  await userEvent.type(box, query);
  await userEvent.keyboard('{Enter}');
}

describe('production planner', () => {
  beforeEach(() => {
    initI18n(['en']);
    localStorage.clear();
    // The step tests below use the list view; the diagram has its own tests.
    usePlanner.setState({ targets: [{ key: 1, item: null, rate: '60' }], choices: {}, steps: {}, settings: { miner: null, clock: '100', purity: 'normal' }, view: 'list' });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('is a tool that leads to its own page, /w/:id/planner', () => {
    expect(collect(FEATURES, 'tools').filter(tl => tl.id === 'planner')).toEqual([plannerTool]);
    expect(plannerTool).toMatchObject({ action: true, page: 'planner' });
    expect(collect(FEATURES, 'pages').filter(p => p.id === 'planner')).toEqual(plannerFeature.pages);
    expect(plannerFeature.pages?.[0]).toMatchObject({ titleKey: 'planner.title' });
    expect(plannerFeature.headerItems).toBeUndefined();
    // The menu shows it with the flow icon.
    expect(plannerTool.icon).toBeDefined();
  });

  it('starts with a short note, the game mode and an example to try; Start over in the title bar can be undone', async () => {
    // The example needs its item in the dataset; this one has it.
    const withExample = {
      ...RECIPE_DATA,
      items: [...RECIPE_DATA.items, { id: EXAMPLE.item, name: { en: 'Reinforced Iron Plate', de: 'Verstärkte Eisenplatte' }, form: 'solid' as const }],
      recipes: [...RECIPE_DATA.recipes, {
        id: 'R_Rip', name: { en: 'R_Rip', de: 'R_Rip' }, alternate: false, machine: 'assembler', duration: 12,
        ingredients: [{ item: 'plate', amount: 6 }], products: [{ item: EXAMPLE.item, amount: 1 }],
      }],
    };
    const { toast } = setup('present', undefined, { 'GET /data/test/recipes.json': { body: withExample } });
    await userEvent.click(screen.getByRole('link', { name: 'Planner' }));
    const empty = await screen.findByRole('region', { name: 'Totals' });
    expect(empty).toHaveTextContent('Pick an item and how many per minute');
    expect(empty).toHaveTextContent(/The numbers are for the default game mode/);
    // Nothing to switch or clear yet.
    const needs = screen.getByRole('region', { name: 'What do you need?' });
    expect(screen.queryByRole('radiogroup', { name: 'View' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Start over' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Remove/ })).toBeNull();

    await userEvent.click(within(empty).getByRole('button', { name: 'Example: Reinforced Iron Plate, 5/min' }));
    expect(screen.getByRole('combobox', { name: 'Item 1' })).toHaveValue('Reinforced Iron Plate');
    expect(screen.getByRole('spinbutton', { name: 'Per minute of Reinforced Iron Plate' })).toHaveValue(5);
    expect(buildingsFold(screen.getByRole('region', { name: 'Totals' })).querySelector('summary')).toHaveTextContent('Buildings6');
    // The view switch is in the steps' title bar, Start over in the title bar of what it clears.
    const steps = screen.getByRole('region', { name: 'Production steps' });
    expect(within(steps.firstElementChild as HTMLElement).getByRole('radiogroup', { name: 'View' })).toBeInTheDocument();
    await userEvent.click(within(needs.firstElementChild as HTMLElement).getByRole('button', { name: 'Start over' }));
    expect(usePlanner.getState().targets.map(t => t.item)).toEqual([null]);
    expect(screen.getByRole('region', { name: 'Totals' })).toHaveTextContent('Pick an item');

    // The toast takes the focus to its Undo, which puts the plan back and the focus on the first item.
    expect(toast.show).toHaveBeenCalledTimes(1);
    const shown = toast.show.mock.calls[0]![0];
    expect(shown).toMatchObject({ message: 'Plan cleared.', focusAction: true, action: { label: 'Undo' } });
    act(() => shown.action!.run());
    expect(usePlanner.getState().targets.map(t => [t.item, t.rate])).toEqual([[EXAMPLE.item, EXAMPLE.rate]]);
    expect(screen.getByRole('combobox', { name: 'Item 1' })).toHaveValue('Reinforced Iron Plate');
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Item 1' })).toHaveFocus());
  });

  it('leaves the example out when the dataset does not have its item', async () => {
    setup();
    await userEvent.click(screen.getByRole('link', { name: 'Planner' }));
    const empty = await screen.findByRole('region', { name: 'Totals' });
    expect(within(empty).queryByRole('button')).toBeNull();
  });

  it('opens its page from the tool, loads the recipes only then, and keeps the plan when left', async () => {
    const { calls, router } = setup();
    const link = screen.getByRole('link', { name: 'Planner' });
    expect(link).toHaveAttribute('href', `/w/${W}/planner`);
    expect(link).not.toHaveAttribute('aria-current');
    expect(calls).toEqual([]);
    await userEvent.click(link);
    expect(router.state.location.pathname).toBe(`/w/${W}/planner`);
    expect(await screen.findByRole('heading', { name: 'Planner' })).toHaveFocus();
    expect(screen.getByRole('main', { name: 'Planner' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Planner' })).toHaveAttribute('aria-current', 'page');
    await userEvent.type(await screen.findByRole('combobox', { name: 'Item 1' }), 'plate');
    await userEvent.keyboard('{Enter}');
    // The recipes, the index of the game's pictures and, for a resource mined on nodes, the resource nodes.
    expect(calls.map(c => c.path).sort()).toEqual(['/data/test/icons/items/index.json', '/data/test/recipes.json', '/data/test/resource-nodes.json']);

    await userEvent.click(screen.getByRole('link', { name: 'Map' }));
    expect(router.state.location.pathname).toBe(`/w/${W}`);
    expect(screen.queryByRole('heading', { name: 'Planner' })).toBeNull();
    await userEvent.click(screen.getByRole('link', { name: 'Planner' }));
    expect(await screen.findByRole('combobox', { name: 'Item 1' })).toHaveValue('plate');
    expect(stepOf('plate')).toBeInTheDocument();
  });

  it('opens at its URL', async () => {
    stubFetch({ 'GET /data/test/recipes.json': { body: RECIPE_DATA } });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const index = indexDataset({ version: 'test', build: 1, bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 }, mapId: 'm', podRequirementsKnown: true, biomes: [], items: [], aliases: {} });
    renderWorldPages({
      features: [plannerFeature], url: `/w/${W}/planner`,
      ctx: { worldId: W, world: WORLD, me: ME, index, queryClient: client, navigate: () => {}, toast: { show: () => {} } },
    });
    expect(await screen.findByRole('combobox', { name: 'Item 1' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Planner' })).toHaveFocus();
  });

  it('uses the dataset the server serves, also for a world created with an older one', async () => {
    const { calls } = setup('present', '1.2.4.1');
    await userEvent.click(screen.getByRole('link', { name: 'Planner' }));
    await screen.findByRole('combobox', { name: 'Item 1' });
    expect(calls.map(c => c.path).sort()).toEqual(['/data/test/icons/items/index.json', '/data/test/recipes.json']);
  });

  it('says so when the dataset has no recipe data', async () => {
    setup('missing');
    await userEvent.click(screen.getByRole('link', { name: 'Planner' }));
    expect(await screen.findByText(/This dataset has no recipe data/)).toBeInTheDocument();
  });

  it('resolves a picked item down to the miner: a table of the steps, compact totals, the buildings folded away', async () => {
    setup();
    await openAndPick('plate');
    expect(screen.getByRole('combobox', { name: 'Item 1' })).toHaveValue('plate');

    // One row per step under one header: item (with its inputs), rate, buildings, power.
    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('columnheader').map(h => h.textContent)).toEqual(['Item', 'Per minute', 'Buildings', 'Power']);
    expect(within(table).getAllByRole('rowheader').map(h => h.querySelector('button')!.textContent)).toEqual(['plate', 'ingot', 'ore']);
    const plate = stepOf('plate');
    expect(within(plate.cells[1]!).getByText('60/min')).toBeInTheDocument();
    expect(built('plate').getByText('3× Constructor')).toBeInTheDocument();
    // On a phone the buildings show under the rate (the cell of their own is hidden by CSS then).
    expect(within(plate.cells[1]!).getByText('3× Constructor')).toHaveClass('sm:hidden');
    expect(within(plate).getByText('12 MW')).toBeInTheDocument();
    // The inputs as chips with the item's name and rate.
    expect(within(within(plate).getByRole('list', { name: 'Input' })).getAllByRole('listitem').map(li => li.textContent)).toEqual(['ingot90/min']);
    expect(built('ore').getByText('2× Miner Mk.1').parentElement).toHaveAttribute('title', 'exact 1.5');
    // No editor in the list: a row opens the step panel.
    expect(within(table).queryByRole('combobox')).toBeNull();
    expect(within(table).queryByRole('spinbutton')).toBeNull();
    const editor = await openStep('plate');
    expect(within(stepOf('plate')).getByRole('button')).toHaveAttribute('aria-expanded', 'true');
    expect(within(stepOf('plate')).getByRole('button')).toHaveAttribute('aria-controls', editor.id);
    expect(within(editor).getByLabelText('Made by')).toHaveDisplayValue('R_Plate (Constructor)');

    // The answer: power as the big figure, raw resources with their extractors, the buildings by kind folded away.
    const totals = screen.getByRole('region', { name: 'Totals' });
    expect(tile(totals, 'Power')).toBe('31.5 MW'); // 3x4 + 3x4 + 1.5x5
    expect(within(totals).queryByText('Power Shards', { selector: 'dt' })).toBeNull();
    expect(rows(within(totals).getByRole('region', { name: 'Raw resources' }))).toEqual([['ore2× Miner Mk.1', '90/min']]);
    // Without the dataset's resource nodes there is no map to show them on.
    expect(within(totals).queryByRole('link')).toBeNull();
    const fold = buildingsFold(totals);
    expect(fold).not.toHaveAttribute('open');
    expect(fold.querySelector('summary')).toHaveTextContent('Buildings8');
    expect(rows(fold)).toEqual([['Constructor', '3'], ['Smelter', '3'], ['Miner Mk.1', '2']]);
    // Exact counts and footnotes are not in the totals.
    expect(totals).not.toHaveTextContent(/exact|rounded/);
    // Screen readers hear the totals in one sentence, a moment after they change.
    expect(await screen.findByText('31.5 MW, 8 buildings')).toHaveAttribute('role', 'status');
  });

  it('switches to an alternate recipe, and to another miner for all steps or one', async () => {
    setup();
    await openAndPick('plate');
    let editor = await openStep('plate');
    await userEvent.selectOptions(within(editor).getByLabelText('Made by'), 'R_PlateAlt (Assembler)');
    expect(built('plate').getByText('4× Assembler')).toBeInTheDocument();
    expect(within(stepOf('plate')).getByText('Alternate').parentElement).toHaveAttribute('title', 'R_PlateAlt (alternate recipe)');
    expect(usePlanner.getState().choices).toEqual({ plate: { kind: 'recipe', recipe: 'R_PlateAlt' } });
    expect(stepOf('water')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('radio', { name: 'Miner Mk.2' }));
    expect(built('ore').getByText('1× Miner Mk.2')).toBeInTheDocument();

    // Each miner is an option of its own; the step follows the setting until another one is picked.
    editor = await openStep('ore');
    const madeBy = within(editor).getByLabelText('Made by');
    expect(within(madeBy).getAllByRole('option').map(o => o.textContent)).toEqual(['Miner Mk.1', 'Miner Mk.2', 'Supplied from outside']);
    expect(madeBy).toHaveDisplayValue('Miner Mk.2');
    await userEvent.selectOptions(madeBy, 'Miner Mk.1');
    expect(usePlanner.getState().choices.ore).toEqual({ kind: 'extract', extractor: 'mk1' });
    // 40 ore/min for the alternate: two thirds of a Mk.1
    expect(built('ore').getByText('1× Miner Mk.1').parentElement).toHaveAttribute('title', 'exact 0.667');
    // Picking the setting's miner again drops the choice.
    await userEvent.selectOptions(madeBy, 'Miner Mk.2');
    expect(usePlanner.getState().choices.ore).toBeUndefined();

    // Back to the default recipe: the choice is dropped
    editor = await openStep('plate');
    await userEvent.selectOptions(within(editor).getByLabelText('Made by'), 'R_Plate (Constructor)');
    expect(usePlanner.getState().choices).toEqual({});
  });

  it('applies extractor clock speed and purity, per step too, and reports invalid clock speeds', async () => {
    setup();
    await openAndPick('ore');
    // Folded away, with the values in effect.
    const extractors = screen.getByText('Extractors', { selector: 'summary *' }).closest('details')!;
    expect(extractors).not.toHaveAttribute('open');
    expect(extractors.querySelector('summary')).toHaveTextContent('ExtractorsMiner Mk.1 · Normal · 100 %');
    await userEvent.click(screen.getByText('Extractors', { selector: 'summary *' }));
    expect(extractors).toHaveAttribute('open');
    const clock = screen.getByLabelText('Extractor clock speed');
    await userEvent.clear(clock);
    await userEvent.type(clock, '50');
    expect(built('ore').getByText('2× Miner Mk.1')).toBeInTheDocument();
    expect(extractors.querySelector('summary')).toHaveTextContent('Miner Mk.1 · Normal · 50 %');
    // The purities by the game's words; their factors in the hint.
    expect(within(extractors).getAllByRole('radio').map(r => r.textContent)).toContain('Impure');
    expect(screen.getByText(/^Impure ×0\.5, normal ×1, pure ×2: factors from the Satisfactory wiki/)).toBeInTheDocument();
    expect(clock).toHaveAccessibleDescription(/^% 1 % to 250 %\. Above 100 % each building needs a Power Shard per 50 % \(up to 3\)\./);
    await userEvent.click(screen.getByRole('radio', { name: 'Pure' }));
    expect(built('ore').getByText('1× Miner Mk.1')).toBeInTheDocument();
    const editor = await openStep('ore');
    expect(within(editor).getByLabelText('Purity')).toHaveValue('pure');
    expect(within(within(editor).getByLabelText('Purity')).getAllByRole('option').map(o => o.textContent)).toEqual(['Impure', 'Normal', 'Pure']);
    // The field shows the clock speed in effect.
    expect(within(editor).getByRole('spinbutton', { name: 'Clock speed' })).toHaveValue(50);

    // Per step: 200 % on an impure node = 60/min per miner, 2 shards each
    await setClock(editor, '200');
    await userEvent.selectOptions(within(editor).getByLabelText('Purity'), 'impure');
    expect(built('ore').getByText('1× Miner Mk.1')).toBeInTheDocument();
    expect(within(stepOf('ore')).getByText('200 %').parentElement).toHaveAttribute('title', 'Clock speed 200 % · 2 Power Shards per building');
    expect(within(stepOf('ore')).getByText('Impure').parentElement).toHaveAttribute('title', 'Purity: Impure');
    expect(within(editor).getByRole('img', { name: '2 of 3 Power Shard slots used' })).toBeInTheDocument();
    expect(usePlanner.getState().steps).toEqual({ ore: { clock: '200', purity: 'impure' } });
    // The Power Shards of all buildings in the totals.
    expect(tile(screen.getByRole('region', { name: 'Totals' }), 'Power Shards')).toBe('2');

    await setClock(editor, '300');
    expect(screen.getByRole('alert')).toHaveTextContent('The clock speed for ore must be a number from 1 to 250.');
    // The last working plan stays, so the field can be corrected right there.
    expect(screen.getByText(/last plan that worked/)).toBeInTheDocument();
    expect(within(editor).getByRole('spinbutton', { name: 'Clock speed' })).toHaveValue(300);
    await setClock(editor, '200');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(/last plan that worked/)).toBeNull();
  });

  it('runs a resource well at its pressurizer\'s clock speed, with its shards and power', async () => {
    setup();
    await openAndPick('gas');
    expect(built('gas').getByText('1× Well')).toBeInTheDocument();
    const editor = await openStep('gas');
    expect(within(editor).getByText(/clock speed is set at the Pressurizer and applies to all extractors/)).toBeInTheDocument();
    const totals = screen.getByRole('region', { name: 'Totals' });
    expect(within(totals).getByText('gas: one Pressurizer per resource well, 150 MW at 100 %; not included in the power.')).toBeInTheDocument();
    expect(totals).not.toHaveTextContent(/default game mode/);

    // 200 %: 120 m³/min per extractor, the pressurizer takes 2 shards and 150 MW x 2^1.321929 = 375 MW
    await setClock(editor, '200');
    expect(within(stepOf('gas')).getByText('200 %').parentElement).toHaveAttribute('title', 'Clock speed 200 % · 2 Power Shards per Pressurizer');
    expect(within(editor).getByText('Power Shards (Pressurizer)')).toBeInTheDocument();
    expect(within(totals).getByText('gas: one Pressurizer per resource well, 375 MW at 200 %, 2 Power Shards; not included in the power.')).toBeInTheDocument();
    expect(tile(totals, 'Power')).toBe('0 MW');
    // The pressurizers' shards are in the note, not in the count for all buildings.
    expect(within(totals).queryByText('Power Shards', { selector: 'dt' })).toBeNull();
  });

  it('links a resource mined on nodes to the map, showing only its nodes of the step\'s purity', async () => {
    const nodes = { version: 'test', resources: [{ id: 'ore', name: 'Ore' }, { id: 'water', name: 'Water' }, { id: 'Geyser', name: 'Geyser' }], nodes: [] };
    useNodeLayer.setState({ visible: false, hiddenResources: [], purities: ['impure', 'normal', 'pure'] });
    useUiStore.setState({ mainView: 'list' });
    const { router } = setup('present', undefined, { 'GET /data/test/resource-nodes.json': { body: nodes } });
    await openAndPick('plate');
    await openStep('ore');
    await userEvent.selectOptions(within(screen.getByRole('region', { name: 'Production' })).getByLabelText('Purity'), 'pure');
    const raw = within(screen.getByRole('region', { name: 'Totals' })).getByRole('region', { name: 'Raw resources' });
    const link = await within(raw).findByRole('link', { name: 'Show on map: ore (Pure)' });
    expect(link).toHaveAttribute('href', `/w/${W}`);
    await userEvent.click(link);
    expect(router.state.location.pathname).toBe(`/w/${W}`);
    expect(useNodeLayer.getState()).toMatchObject({ visible: true, hiddenResources: ['water', 'Geyser'], purities: ['pure'] });
    expect(useUiStore.getState().mainView).toBe('map');
  });

  it('links no resource that is not mined on a node, nor any without the dataset\'s resource nodes', async () => {
    const nodes = { version: 'test', resources: [{ id: 'ore', name: 'Ore' }, { id: 'water', name: 'Water' }], nodes: [] };
    usePlanner.setState({ choices: { water: { kind: 'extract', extractor: 'pump' } } });
    setup('present', undefined, { 'GET /data/test/resource-nodes.json': { body: nodes } });
    await openAndPick('water');
    const raw = within(screen.getByRole('region', { name: 'Totals' })).getByRole('region', { name: 'Raw resources' });
    expect(rows(raw)).toEqual([['water1× Water Extractor', '60 m³/min']]);
    expect(within(raw).queryByRole('link')).toBeNull();
  });

  it('runs production buildings at a set clock speed', async () => {
    setup();
    await openAndPick('plate');
    const editor = await openStep('plate');
    await setClock(editor, '150');
    // 30 plates/min per constructor at 150 %
    expect(built('plate').getByText('2× Constructor')).toBeInTheDocument();
    expect(within(stepOf('plate')).getByText('150 %').parentElement).toHaveAttribute('title', 'Clock speed 150 % · 1 Power Shard per building');
    expect(built('ingot').getByText('3× Smelter')).toBeInTheDocument();
    expect(tile(screen.getByRole('region', { name: 'Totals' }), 'Power Shards')).toBe('2');
  });

  it('uses by-products for other steps and lists the rest as surplus', async () => {
    usePlanner.setState({ choices: { fuel: { kind: 'recipe', recipe: 'R_ResFuel' } } });
    setup();
    await openAndPick('plastic');
    await userEvent.click(screen.getByRole('button', { name: '+ Add item' }));
    await userEvent.type(screen.getByRole('combobox', { name: 'Item 2' }), 'fuel');
    await userEvent.keyboard('{Enter}');
    const rate = screen.getByRole('spinbutton', { name: 'Per minute of fuel' });
    await userEvent.clear(rate);
    await userEvent.type(rate, '4');
    // 60 plastic make 30 residue; 4 fuel need 6
    expect(built('residue').getByText('From by-products')).toBeInTheDocument();
    const editor = await openStep('residue');
    expect(within(editor).getByText(/no buildings needed/)).toBeInTheDocument();
    const totals = screen.getByRole('region', { name: 'Totals' });
    expect(within(totals).getByRole('heading', { name: 'Surplus' })).toBeInTheDocument();
    expect(rows(within(totals).getByRole('region', { name: 'Surplus' }))).toEqual([['residue', '24 m³/min']]);
  });

  it('supplies the packaged item from outside for a picked unpacking recipe', async () => {
    usePlanner.setState({ choices: { fuel: { kind: 'recipe', recipe: 'R_Unpack' } } });
    setup();
    await openAndPick('fuel');
    expect(built('pfuel').getByText('Supplied from outside')).toBeInTheDocument();
    expect(within(await openStep('pfuel')).getByText(/Supplied from outside automatically/)).toBeInTheDocument();
  });

  it('marks loops and reports loops that cannot work', async () => {
    usePlanner.setState({ choices: { rubber: { kind: 'recipe', recipe: 'R_RecRubber' }, plastic: { kind: 'recipe', recipe: 'R_RecPlastic' } } });
    setup();
    await openAndPick('rubber');
    expect(within(stepOf('rubber')).getByText('Loop')).toBeInTheDocument();
    expect(within(stepOf('plastic')).getByText('Loop')).toBeInTheDocument();
    expect(within(await openStep('rubber')).getByText(/60\/min of it for you/)).toBeInTheDocument();

    const box = screen.getByRole('combobox', { name: 'Item 1' });
    await userEvent.clear(box);
    await userEvent.type(box, 'a');
    await userEvent.keyboard('{Enter}');
    expect(screen.getByRole('combobox', { name: 'Item 1' })).toHaveValue('a');
    expect(screen.getByRole('alert')).toHaveTextContent('These recipes form a loop that uses up at least as much as it makes: a, b. Choose another recipe for one of them, or have one supplied from outside.');
  });

  it('adds and removes targets, and remembers the plan on the device', async () => {
    setup();
    await openAndPick('plate');
    await userEvent.click(screen.getByRole('button', { name: '+ Add item' }));
    const second = screen.getByRole('combobox', { name: 'Item 2' });
    await userEvent.type(second, 'ingot');
    await userEvent.keyboard('{Enter}');
    const rate = screen.getByRole('spinbutton', { name: 'Per minute of ingot' });
    await userEvent.clear(rate);
    await userEvent.type(rate, '30');
    expect(within(stepOf('ingot').cells[1]!).getByText('120/min')).toBeInTheDocument();
    expect(loadPlanner()?.targets.map(t => [t.item, t.rate])).toEqual([['plate', '60'], ['ingot', '30']]);
    await userEvent.click(screen.getByRole('button', { name: 'Remove plate' }));
    expect(usePlanner.getState().targets.map(t => t.item)).toEqual(['ingot']);
  });

  it('shows names and labels in German, with the game\'s terms', async () => {
    initI18n(['de']);
    setup();
    await userEvent.click(screen.getByRole('link', { name: 'Planer' }));
    const box = await screen.findByRole('combobox', { name: 'Gegenstand 1' });
    await userEvent.type(box, 'plate-de');
    await userEvent.keyboard('{Enter}');
    expect(within(screen.getByRole('table')).getAllByRole('columnheader').map(h => h.textContent)).toEqual(['Gegenstand', 'Pro Minute', 'Gebäude', 'Strom']);
    expect(built('plate-de').getByText('3× Konstruktor')).toBeInTheDocument();
    const plate = await openStep('plate-de', 'plate-de bearbeiten');
    expect(within(plate).getByLabelText('Hergestellt mit')).toBeInTheDocument();
    await setClock(plate, '150', 'Taktrate');
    expect(within(stepOf('plate-de')).getByText('150 %').parentElement).toHaveAttribute('title', 'Taktrate 150 % · 1 Energiefragment je Gebäude');
    expect(tile(screen.getByRole('region', { name: 'Summen' }), 'Energiefragmente')).toBe('2');

    const ore = await openStep('ore-de', 'ore-de bearbeiten');
    expect(within(ore).getByLabelText('Hergestellt mit')).toHaveDisplayValue('Miner Mk.1');
    expect(within(within(ore).getByLabelText('Reinheit')).getAllByRole('option').map(o => o.textContent)).toEqual(['Unrein', 'Normal', 'Rein']);
    expect(within(ore).getByText('Extraktionsrate')).toBeInTheDocument();
    expect(within(ore).getByText('genau 1,5 · 2× bei 75 %')).toBeInTheDocument();
  });

  it('shows a resource well\'s pressurizer in German', async () => {
    initI18n(['de']);
    setup();
    await userEvent.click(screen.getByRole('link', { name: 'Planer' }));
    await userEvent.type(await screen.findByRole('combobox', { name: 'Gegenstand 1' }), 'gas-de');
    await userEvent.keyboard('{Enter}');
    await setClock(await openStep('gas-de', 'gas-de bearbeiten'), '250', 'Taktrate');
    expect(within(stepOf('gas-de')).getByText('250 %').parentElement).toHaveAttribute('title', 'Taktrate 250 % · 3 Energiefragmente je Kompressor');
    const totals = screen.getByRole('region', { name: 'Summen' });
    expect(within(totals).getByText(/^gas-de: ein Kompressor je Rohstoffquelle, .* MW bei 250 %, 3 Energiefragmente; nicht im Strom eingerechnet\.$/)).toBeInTheDocument();
    expect(tile(totals, 'Strom')).toMatch(/ MW$/);
    expect(await screen.findByText(/^0 MW, 1 Gebäude$/)).toHaveAttribute('role', 'status');
  });

  it('picks items with the keyboard and closes only the list on Escape', async () => {
    setup();
    await userEvent.click(screen.getByRole('link', { name: 'Planner' }));
    const box = await screen.findByRole('combobox', { name: 'Item 1' });
    await userEvent.type(box, 'pla');
    expect(box).toHaveAttribute('aria-expanded', 'true');
    const options = screen.getAllByRole('option');
    expect(options.map(o => o.textContent)).toEqual(['plasticplastic-de', 'plateplate-de']);
    await userEvent.keyboard('{ArrowDown}');
    expect(box).toHaveAttribute('aria-activedescendant', options[1]!.id);
    await userEvent.keyboard('{Escape}');
    expect(box).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('heading', { name: 'Planner' })).toBeInTheDocument();
    await waitFor(() => expect(usePlanner.getState().targets[0]!.item).toBeNull());
  });
});

// The dataset's pictures (part `icons`): some buildings and items, not the miner and the ore (placeholders there).
const ICONS = { format: 1, sizes: [64, 256], icons: ['Desc_CrystalShard_C', 'assembler', 'constructor', 'ingot', 'pfuel', 'plate', 'smelter'] };
const ICON = (cls: string, size: number) => `/data/test/icons/items/${size}/${cls}.webp`;
const withPictures = (): Record<string, StubRoute> => ({ 'GET /data/test/icons/items/index.json': { body: ICONS } });

describe('production planner diagram', () => {
  beforeEach(() => {
    initI18n(['en']);
    localStorage.clear();
    usePlanner.setState({ targets: [{ key: 1, item: null, rate: '60' }], choices: {}, steps: {}, settings: { miner: null, clock: '100', purity: 'normal' }, view: 'diagram' });
  });
  afterEach(() => vi.unstubAllGlobals());

  const diagram = (name = 'Production chain') => screen.getByRole('group', { name });
  /** A node's button: its accessible name starts with the item. */
  const node = (item: string, name?: string) => within(diagram(name)).getByRole('button', { name: new RegExp(`^${item}[ ;]`) });
  const edges = () => [...diagram().querySelectorAll('path[data-edge]')].map(p => `${p.getAttribute('data-from')}>${p.getAttribute('data-to')}:${p.getAttribute('data-edge')}`);
  const edgeState = (from: string, to: string) => diagram().querySelector(`path[data-from="${from}"][data-to="${to}"]`)!.getAttribute('data-state');
  const top = (el: HTMLElement) => parseFloat(el.style.top);
  /** The texts of a panel section's slots (picture, name, rate, rate per building). */
  const slots = (section: HTMLElement) => within(section).getAllByRole('listitem').map(li => li.textContent);

  it('shows the plan from top to bottom: compact nodes with pictures, "3× Constructor", item and rate, rates with pictures on the edges', async () => {
    const { calls } = setup('present', undefined, withPictures());
    await openAndPick('plate');
    expect(screen.getByRole('radio', { name: 'Diagram' })).toHaveAttribute('aria-checked', 'true');
    const [plate, ingot, ore] = [node('plate'), node('ingot'), node('ore')];
    // Raw resource at the top, the wanted item at the bottom.
    expect(top(ore)).toBeLessThan(top(ingot));
    expect(top(ingot)).toBeLessThan(top(plate));
    expect(plate).toHaveAccessibleName('plate (wanted: 60/min); 3× Constructor; makes 60/min; R_Plate; needs 90/min ingot');
    expect(plate).toHaveTextContent(/^3× Constructorplate60\/minWanted$/);
    expect(within(plate).getByText('Wanted')).toHaveAttribute('title', 'wanted: 60/min');
    expect(within(ingot).queryByText('Wanted')).not.toBeInTheDocument();
    // The building's picture from the dataset, the product pinned to its corner; without one an empty tile of the same size.
    await waitFor(() => expect(plate.querySelector('[data-picture="constructor"] img')).toHaveAttribute('src', ICON('constructor', 64)));
    expect(plate.querySelector('[data-picture="constructor"] img')).toHaveAttribute('srcset', `${ICON('constructor', 64)} 64w, ${ICON('constructor', 256)} 256w`);
    expect(plate.querySelector('[data-pin="plate"] img')).toHaveAttribute('src', ICON('plate', 64));
    expect(ingot.querySelector('[data-picture="smelter"] img')).toHaveAttribute('src', ICON('smelter', 64));
    expect(ore.querySelector('img')).toBeNull();
    expect(ore.querySelector('[data-pin]')).toBeNull();
    expect(within(ore).getByTestId('icon-placeholder')).toBeInTheDocument();
    expect(ore.querySelector('[data-picture="mk1"]')).toHaveStyle({ width: '56px', height: '56px' });
    expect(calls.map(c => c.path)).toContain('/data/test/icons/items/index.json');

    expect(within(ore).getByText('2× Miner Mk.1')).toHaveAttribute('title', 'exact 1.5');
    // The node purity of the settings goes without saying; a node shows only one that differs.
    expect(within(ore).queryByText('Normal')).not.toBeInTheDocument();
    expect(edges()).toEqual(['ingot>plate:input', 'ore>ingot:input']);
    // Rate labels with the item's picture.
    expect(within(diagram()).getAllByText('90/min', { selector: 'span[aria-hidden]' })).toHaveLength(2);
    expect(diagram().querySelector('[data-label-to="plate"] img')).toHaveAttribute('src', ICON('ingot', 64));
    // The keyboard help is the diagram's description, not a line on screen; no legend for plain material lines.
    expect(diagram()).toHaveAccessibleDescription(/^Raw resources at the top, your items at the bottom/);
    expect(screen.getByText(/^Raw resources at the top/)).toHaveClass('sr-only');
    expect(screen.queryByRole('list', { name: 'Legend' })).toBeNull();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Totals' })).toBeInTheDocument();
  });

  it('highlights the edges of the hovered and the selected step and fades the others', async () => {
    setup();
    await openAndPick('plate');
    expect([edgeState('ingot', 'plate'), edgeState('ore', 'ingot')]).toEqual(['plain', 'plain']);
    fireEvent.pointerEnter(node('ore'));
    expect([edgeState('ingot', 'plate'), edgeState('ore', 'ingot')]).toEqual(['plain', 'hot']);
    fireEvent.pointerLeave(node('ore'));
    await userEvent.click(node('plate'));
    fireEvent.pointerLeave(node('plate'));
    expect([edgeState('ingot', 'plate'), edgeState('ore', 'ingot')]).toEqual(['hot', 'dim']);
    expect(diagram().querySelector('path[data-state="dim"]')).toHaveClass('opacity-50');
    expect(diagram().querySelector('[data-label-to="ingot"]')).toHaveClass('opacity-50');
  });

  it('opens a selected step like the game\'s machine window: made by, inputs and outputs, cycle, clock speed, shards, power', async () => {
    const { calls } = setup('present', undefined, withPictures());
    await openAndPick('plate');
    await userEvent.click(node('plate'));
    expect(node('plate')).toHaveAttribute('aria-expanded', 'true');
    const editor = screen.getByRole('region', { name: 'Edit plate' });
    expect(node('plate')).toHaveAttribute('aria-controls', editor.id);
    expect(within(editor).getByRole('heading', { level: 3, name: '3× Constructor' })).toBeInTheDocument();
    expect(within(editor).getByRole('heading', { level: 3, name: '3× Constructor' }).nextElementSibling).toHaveTextContent(/^plate · 60\/min$/);
    expect(within(editor).getByText('Wanted')).toBeInTheDocument();
    await waitFor(() => expect(editor.querySelector('[data-picture="constructor"] img')).toHaveAttribute('src', ICON('constructor', 64)));

    const recipe = within(editor).getByRole('region', { name: 'Recipe' });
    // The recipe is in the picker; no line repeating it.
    expect(within(recipe).getByLabelText('Made by')).toHaveDisplayValue('R_Plate (Constructor)');
    expect(within(recipe).queryByText('R_Plate')).toBeNull();
    const production = within(editor).getByRole('region', { name: 'Production' });
    expect(within(production).getByText('Input')).toBeInTheDocument();
    expect(slots(production)).toEqual(['ingot90/min30/min per building', 'plate60/min20/min per building']);
    expect(within(production).getByText('6 s per cycle')).toBeInTheDocument();
    expect(production.querySelector('[data-picture="ingot"] img')).toHaveAttribute('src', ICON('ingot', 64));

    const clock = within(editor).getByRole('region', { name: 'Clock speed' });
    const slider = within(clock).getByRole('slider', { name: 'Clock speed slider (%)' });
    expect(slider).toHaveValue('100');
    expect(slider).toHaveAttribute('min', '1');
    expect(slider).toHaveAttribute('max', '250');
    // The field holds the clock speed in effect as its value.
    expect(within(clock).getByRole('spinbutton', { name: 'Clock speed' })).toHaveValue(100);
    expect(within(clock).getByRole('img', { name: '0 of 3 Power Shard slots used' })).toBeInTheDocument();
    expect(within(clock).getByText('12 MW')).toBeInTheDocument();
    expect(within(clock).getByText(/4 MW per building/)).toBeInTheDocument();
    // No Somersloop slots (the plan does not use them), so no machine data either.
    expect(within(editor).queryByText(/Somersloop/)).toBeNull();
    expect(calls.map(c => c.path)).not.toContain('/data/test/machines.json');

    // The slider sets the clock speed: the shard slots fill, the node shows it.
    fireEvent.change(slider, { target: { value: '150' } });
    expect(usePlanner.getState().steps).toEqual({ plate: { clock: '150' } });
    expect(within(clock).getByRole('spinbutton', { name: 'Clock speed' })).toHaveValue(150);
    expect(within(clock).getByRole('img', { name: '1 of 3 Power Shard slots used' }).querySelectorAll('[data-filled="true"] img')).toHaveLength(1);
    expect(within(node('plate')).getByText('150 %').parentElement).toHaveAttribute('title', 'Clock speed 150 % · 1 Power Shard per building');
    expect(within(editor).getByRole('heading', { level: 3, name: '2× Constructor' })).toBeInTheDocument();
    expect(within(production).getByText('4 s per cycle')).toBeInTheDocument();

    // Another recipe: the node and the panel follow.
    await userEvent.selectOptions(within(recipe).getByLabelText('Made by'), 'R_PlateAlt (Assembler)');
    expect(within(node('plate')).getByText('3× Assembler')).toBeInTheDocument();
    expect(within(node('plate')).getByText('Alternate').parentElement).toHaveAttribute('title', 'R_PlateAlt (alternate recipe)');
    expect(node('plate')).toHaveAccessibleName(/; R_PlateAlt \(alternate recipe\);/);
    // Still at 150 %: 22.5 plates per assembler.
    expect(slots(production)).toEqual([
      'ingot40/min15/min per building', 'water20 m³/min7.5 m³/min per building', 'plate60/min22.5/min per building',
    ]);
    expect(within(production).getByText('8 s per cycle')).toBeInTheDocument();
    expect(edges()).toContain('water>plate:input');
  });

  it('moves between the steps with the arrow keys and closes the panel with ×, Escape or another click', async () => {
    setup();
    await openAndPick('plate');
    // One tab stop; up goes to the nearest step of the row above.
    node('plate').focus();
    await userEvent.keyboard('{ArrowUp}');
    expect(node('ingot')).toHaveFocus();
    expect(node('ingot')).toHaveAttribute('tabindex', '0');
    expect(node('plate')).toHaveAttribute('tabindex', '-1');
    await userEvent.keyboard('{ArrowUp}');
    expect(node('ore')).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}{ArrowDown}');
    expect(node('plate')).toHaveFocus();
    await userEvent.keyboard('{Home}');
    expect(node('ore')).toHaveFocus();
    await userEvent.keyboard('{End}');
    expect(node('plate')).toHaveFocus();
    await userEvent.keyboard('{ArrowUp}{Enter}');
    const editor = screen.getByRole('region', { name: 'Edit ingot' });
    await setClock(editor, '200');
    expect(within(node('ingot')).getByText('200 %').parentElement).toHaveAttribute('title', 'Clock speed 200 % · 2 Power Shards per building');
    expect(within(editor).getByRole('img', { name: '2 of 3 Power Shard slots used' }).querySelectorAll('[data-filled="true"]')).toHaveLength(2);
    expect(node('ingot')).toHaveAccessibleName(/; Clock speed 200 %; 2 Power Shards per building;/);

    await userEvent.click(within(editor).getByRole('button', { name: 'Stop editing ingot' }));
    expect(screen.queryByRole('region', { name: 'Edit ingot' })).not.toBeInTheDocument();
    expect(node('ingot')).toHaveFocus();
    // Escape inside the panel closes it and puts the focus back on its node; on a node it closes the panel too.
    await userEvent.click(node('ore'));
    await userEvent.click(within(screen.getByRole('region', { name: 'Edit ore' })).getByLabelText('Made by'));
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('region', { name: 'Edit ore' })).not.toBeInTheDocument();
    expect(node('ore')).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(screen.getByRole('region', { name: 'Edit ore' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('region', { name: 'Edit ore' })).not.toBeInTheDocument();
    // Clicking the selected node again closes its panel too.
    await userEvent.click(node('ore'));
    await userEvent.click(node('ore'));
    expect(screen.queryByRole('region', { name: 'Edit ore' })).not.toBeInTheDocument();
  });

  it('shows an extractor\'s node purity and extraction rate, the clock speed for whole buildings, and a resource well\'s pressurizer', async () => {
    setup();
    await openAndPick('plate');
    await userEvent.click(node('ore'));
    const editor = screen.getByRole('region', { name: 'Edit ore' });
    expect(within(editor).getByRole('heading', { level: 3, name: '2× Miner Mk.1' })).toBeInTheDocument();
    expect(within(editor).getByRole('heading', { level: 3, name: '2× Miner Mk.1' }).nextElementSibling).toHaveTextContent(/^ore · 90\/min$/);
    expect(within(editor).getByLabelText('Made by')).toHaveDisplayValue('Miner Mk.1');
    // 1.5 miners at 100 % make as much as 2 at 75 %.
    expect(within(editor).getByText('exact 1.5 · 2× at 75 %')).toBeInTheDocument();
    const production = within(editor).getByRole('region', { name: 'Production' });
    expect(within(production).getByText('Resource node')).toBeInTheDocument();
    expect(within(production).getByText('Extraction rate')).toBeInTheDocument();
    expect(slots(production)).toEqual(['ore90/min60/min per building']);
    await userEvent.selectOptions(within(production).getByLabelText('Purity'), 'pure');
    expect(usePlanner.getState().steps).toEqual({ ore: { purity: 'pure' } });
    expect(within(editor).getByRole('heading', { level: 3, name: '1× Miner Mk.1' })).toBeInTheDocument();
    expect(within(editor).getByText('exact 0.75 · 1× at 75 %')).toBeInTheDocument();
    expect(within(node('ore')).getByText('Pure')).toBeInTheDocument();
    expect(within(editor).getByText(/5 MW per building/)).toBeInTheDocument();

    await openAndPickAgainClear('gas');
    await userEvent.click(node('gas'));
    const well = screen.getByRole('region', { name: 'Edit gas' });
    expect(within(well).getByRole('heading', { level: 3, name: '1× Well' })).toBeInTheDocument();
    expect(within(well).queryByText('Resource node')).toBeInTheDocument();
    expect(within(well).getByText('Power Shards (Pressurizer)')).toBeInTheDocument();
    expect(within(well).getByText('Pressurizer: 150 MW per resource well, not included in the totals')).toBeInTheDocument();
    expect(within(well).getByText(/clock speed is set at the Pressurizer/)).toBeInTheDocument();
    expect(within(well).queryByText(/^exact/)).toBeNull();
  });

  it('switches between diagram and list, remembers the view, and keeps the selected step open', async () => {
    setup();
    await openAndPick('plate');
    await userEvent.click(node('ingot'));
    await userEvent.click(screen.getByRole('radio', { name: 'List' }));
    expect(screen.queryByRole('group', { name: 'Production chain' })).not.toBeInTheDocument();
    expect(built('plate').getByText('3× Constructor')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Edit ingot' })).toBeInTheDocument();
    expect(within(stepOf('ingot')).getByRole('button')).toHaveAttribute('aria-expanded', 'true');
    expect(usePlanner.getState().view).toBe('list');
    expect(loadPlanner()?.view).toBe('list');
    // Starting over keeps the view.
    await userEvent.click(screen.getByRole('button', { name: 'Start over' }));
    expect(usePlanner.getState().view).toBe('list');

    await openAndPickAgain('plate');
    await userEvent.click(screen.getByRole('radio', { name: 'Diagram' }));
    expect(node('plate')).toBeInTheDocument();
    expect(loadPlanner()?.view).toBe('diagram');
  });

  it('shows the list on a phone and the diagram on a wider screen until a view is picked', async () => {
    const media = stubMatchMedia({ [MOBILE]: true });
    usePlanner.setState({ view: null });
    setup();
    await openAndPick('plate');
    expect(screen.getByRole('radio', { name: 'List' })).toHaveAttribute('aria-checked', 'true');
    expect(stepOf('plate')).toBeInTheDocument();
    act(() => media.set(MOBILE, false));
    expect(screen.getByRole('radio', { name: 'Diagram' })).toHaveAttribute('aria-checked', 'true');
    expect(node('plate')).toBeInTheDocument();
    expect(loadPlanner()?.view).toBeNull();
    // Once picked, the view stays on every screen.
    await userEvent.click(screen.getByRole('radio', { name: 'Diagram' }));
    act(() => media.set(MOBILE, true));
    expect(node('plate')).toBeInTheDocument();
    expect(loadPlanner()?.view).toBe('diagram');
  });

  it('explains the Power Shard mark in the legend when a step needs shards', async () => {
    usePlanner.setState({ steps: { ingot: { clock: '200' } } });
    setup();
    await openAndPick('plate');
    expect(within(screen.getByRole('list', { name: 'Legend' })).getAllByRole('listitem').map(li => li.textContent)).toEqual(['Material per minute', '◆Power Shard']);
  });

  it('scrolls a selected step\'s window into view only where it is not docked beside the steps', async () => {
    const media = stubMatchMedia({ '(min-width: 1280px)': true });
    const scroll = vi.fn();
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scroll;
    try {
      setup();
      await openAndPick('plate');
      await userEvent.click(node('ingot'));
      const docked = screen.getByRole('region', { name: 'Edit ingot' });
      expect(scroll.mock.contexts).not.toContain(docked);
      act(() => media.set('(min-width: 1280px)', false));
      await userEvent.click(node('ore'));
      expect(scroll.mock.contexts).toContain(screen.getByRole('region', { name: 'Edit ore' }));
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });

  it('draws by-products and steps covered by them, with a legend', async () => {
    usePlanner.setState({ choices: { fuel: { kind: 'recipe', recipe: 'R_ResFuel' } } });
    setup();
    await openAndPick('plastic');
    await userEvent.click(screen.getByRole('button', { name: '+ Add item' }));
    await userEvent.type(screen.getByRole('combobox', { name: 'Item 2' }), 'fuel');
    await userEvent.keyboard('{Enter}');
    const rate = screen.getByRole('spinbutton', { name: 'Per minute of fuel' });
    await userEvent.clear(rate);
    await userEvent.type(rate, '4');
    expect(edges()).toContain('plastic>residue:byproduct');
    // The by-product as the card's small line, and in its accessible name.
    expect(within(node('plastic')).getByText('+ residue · 30 m³/min')).toBeInTheDocument();
    expect(node('plastic')).toHaveAccessibleName(/; makes 60\/min; By-products: 30 m³\/min residue;/);
    // Covered by by-products: no buildings, the item's own picture.
    const residue = node('residue');
    expect(within(residue).getByText('From by-products')).toBeInTheDocument();
    expect(within(residue).getByText('30 m³/min')).toBeInTheDocument();
    expect(residue.querySelector('[data-picture="residue"]')).not.toBeNull();
    const legend = screen.getByRole('list', { name: 'Legend' });
    expect(within(legend).getAllByRole('listitem').map(li => li.textContent)).toEqual(['Material per minute', 'By-product']);
    await userEvent.click(residue);
    const editor = screen.getByRole('region', { name: 'Edit residue' });
    expect(within(editor).queryByRole('region', { name: 'Production' })).not.toBeInTheDocument();
    expect(within(editor).getByText(/no buildings needed/)).toBeInTheDocument();
  });

  it('dashes the edges of a loop and marks its steps', async () => {
    usePlanner.setState({ choices: { rubber: { kind: 'recipe', recipe: 'R_RecRubber' }, plastic: { kind: 'recipe', recipe: 'R_RecPlastic' } } });
    setup();
    await openAndPick('rubber');
    expect(edges().filter(e => e.endsWith(':loop')).sort()).toEqual(['plastic>rubber:loop', 'rubber>plastic:loop']);
    expect(within(node('rubber')).getByText('Loop')).toHaveAttribute('title', 'Part of a loop: these steps feed each other.');
    expect(node('plastic').style.top).toBe(node('rubber').style.top);
    expect(screen.getByRole('list', { name: 'Legend' })).toHaveTextContent('Loop');
  });

  it('marks an item supplied from outside with its picture in a dashed frame', async () => {
    usePlanner.setState({ choices: { fuel: { kind: 'recipe', recipe: 'R_Unpack' } } });
    setup('present', undefined, withPictures());
    await openAndPick('fuel');
    const pfuel = node('pfuel');
    expect(within(pfuel).getByText('Supplied from outside')).toBeInTheDocument();
    expect(within(pfuel).getByText('Automatically, avoids a loop')).toBeInTheDocument();
    expect(pfuel.className).toContain('border-dashed');
    const frame = pfuel.querySelector('[data-picture="pfuel"]')!;
    expect(frame.className).toContain('border-dashed');
    await waitFor(() => expect(frame.querySelector('img')).toHaveAttribute('src', ICON('pfuel', 64)));
    // Its own picture: nothing pinned to it.
    expect(pfuel.querySelector('[data-pin]')).toBeNull();
    expect(screen.getByRole('list', { name: 'Legend' })).toHaveTextContent('Supplied from outside');
    await userEvent.click(pfuel);
    const editor = screen.getByRole('region', { name: 'Edit pfuel' });
    expect(within(editor).getByRole('heading', { level: 3, name: 'Supplied from outside' })).toBeInTheDocument();
    expect(within(editor).queryByRole('region', { name: 'Clock speed' })).not.toBeInTheDocument();
    expect(within(editor).getByText(/Supplied from outside automatically/)).toBeInTheDocument();
  });

  it('shows the diagram and the step panel in German', async () => {
    initI18n(['de']);
    setup();
    await userEvent.click(screen.getByRole('link', { name: 'Planer' }));
    await userEvent.type(await screen.findByRole('combobox', { name: 'Gegenstand 1' }), 'plate-de');
    await userEvent.keyboard('{Enter}');
    expect(screen.getByRole('radiogroup', { name: 'Ansicht' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Diagramm' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'Liste' })).toBeInTheDocument();
    const plate = node('plate-de', 'Produktionskette');
    expect(plate).toHaveAccessibleName('plate-de (gewünscht: 60/min); 3× Konstruktor; stellt 60/min her; R_Plate; braucht 90/min ingot-de');
    expect(within(plate).getByText('Gewünscht')).toBeInTheDocument();
    expect(diagram('Produktionskette')).toHaveAccessibleDescription(/^Rohstoffe oben, deine Gegenstände unten/);
    expect(screen.queryByRole('list', { name: 'Legende' })).toBeNull();
    await userEvent.click(plate);
    const editor = screen.getByRole('region', { name: 'plate-de bearbeiten' });
    expect(within(editor).getByRole('heading', { level: 3, name: '3× Konstruktor' })).toBeInTheDocument();
    expect(within(editor).getByLabelText('Hergestellt mit')).toBeInTheDocument();
    const production = within(editor).getByRole('region', { name: 'Produktion' });
    expect(within(production).getByText('Eingang')).toBeInTheDocument();
    expect(within(production).getByText('Ausgang')).toBeInTheDocument();
    expect(slots(production)).toEqual(['ingot-de90/min30/min je Gebäude', 'plate-de60/min20/min je Gebäude']);
    expect(within(production).getByText('6 s je Zyklus')).toBeInTheDocument();
    const clock = within(editor).getByRole('region', { name: 'Taktrate' });
    expect(within(clock).getByRole('slider', { name: 'Taktrate-Regler (%)' })).toBeInTheDocument();
    await setClock(editor, '150', 'Taktrate');
    expect(within(clock).getByRole('img', { name: '1 von 3 Plätzen für Energiefragmente belegt' })).toBeInTheDocument();
    expect(within(node('plate-de', 'Produktionskette')).getByText('150 %').parentElement).toHaveAttribute('title', 'Taktrate 150 % · 1 Energiefragment je Gebäude');
    expect(node('plate-de', 'Produktionskette')).toHaveAccessibleName(/; Taktrate 150 %; 1 Energiefragment je Gebäude;/);
    expect(within(editor).getByRole('button', { name: 'Bearbeitung von plate-de schließen' })).toBeInTheDocument();
  });
});

describe('matchItems', () => {
  const idx = indexRecipes(RECIPE_DATA);
  it('matches both languages, own-language prefix first', () => {
    expect(matchItems(idx.plannable, 'plate-de', 'en').map(i => i.id)).toEqual(['plate']);
    expect(matchItems(idx.plannable, 'pla', 'en').map(i => i.id)).toEqual(['plastic', 'plate']);
    expect(matchItems(idx.plannable, 'xyz', 'en')).toEqual([]);
    // Every word has to match somewhere
    expect(matchItems(idx.plannable, 'ing de', 'en').map(i => i.id)).toEqual(['ingot']);
  });
});
