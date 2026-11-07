import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MeDto, WorldDto } from '../../src/shared/api.js';
import { indexDataset } from '../../src/shared/dataset.js';
import { indexRecipes } from '../../src/shared/recipes.js';
import { collect, type WorldCtx } from '../../src/web/app/feature.js';
import { initI18n } from '../../src/web/app/i18n/index.js';
import { FEATURES } from '../../src/web/features/index.js';
import { matchItems } from '../../src/web/features/planner/ItemPicker.js';
import { PlannerDialog } from '../../src/web/features/planner/PlannerHost.js';
import { plannerTool } from '../../src/web/features/planner/index.js';
import { ToolButton } from '../../src/web/features/worlds/ToolsNav.js';
import { loadPlanner, usePlanner } from '../../src/web/features/planner/usePlanner.js';
import { RECIPE_DATA } from '../fixtures/recipeData.js';
import { stubFetch } from './fetchStub.js';

const W = '6f1c2b0e-8a43-4f5e-9d1b-2c3d4e5f6a7b';
const ME: MeDto = { id: 1, displayName: 'Nick', avatarUrl: null, email: null, datasetVersion: 'test' };
const WORLD: WorldDto = {
  id: W, name: 'Alpha', isOwner: true, rev: 1, datasetVersion: 'test', owner: { id: 1, displayName: 'Nick' }, members: [], lastImport: null,
};

function setup(recipes: 'present' | 'missing' = 'present', worldVersion = WORLD.datasetVersion) {
  const { calls } = stubFetch(recipes === 'present' ? { 'GET /data/test/recipes.json': { body: RECIPE_DATA } } : {});
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const index = indexDataset({ version: 'test', build: 1, bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 }, mapId: 'm', podRequirementsKnown: true, biomes: [], items: [], aliases: {} });
  const ctx: WorldCtx = { worldId: W, world: { ...WORLD, datasetVersion: worldVersion }, me: ME, index, queryClient: client, navigate: () => {}, toast: { show: () => {} } };
  render(
    <QueryClientProvider client={client}>
      <ToolButton tool={plannerTool} ctx={ctx} />
      <PlannerDialog ctx={ctx} />
    </QueryClientProvider>,
  );
  return { calls };
}

const stepOf = (name: string) => screen.getByRole('heading', { level: 4, name: new RegExp(`^${name}`) }).closest('li')!;

/** Picks an item into the first row of an already open planner. */
async function openAndPickAgain(query: string) {
  await userEvent.type(screen.getByRole('combobox', { name: 'Item 1' }), query);
  await userEvent.keyboard('{Enter}');
}

async function openAndPick(query: string) {
  await userEvent.click(screen.getByRole('button', { name: 'Planner' }));
  const box = await screen.findByRole('combobox', { name: 'Item 1' });
  await userEvent.type(box, query);
  await userEvent.keyboard('{Enter}');
}

describe('production planner', () => {
  beforeEach(() => {
    initI18n(['en']);
    localStorage.clear();
    // The step tests below use the list view; the diagram has its own tests.
    usePlanner.setState({ visible: false, targets: [{ key: 1, item: null, rate: '60' }], choices: {}, steps: {}, settings: { miner: null, clock: '100', purity: 'normal' }, view: 'list' });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('is a tool that opens a dialog, and the dialog is a header item', () => {
    expect(collect(FEATURES, 'tools').filter(tl => tl.id === 'planner')).toEqual([plannerTool]);
    expect(plannerTool.action).toBe(true);
    expect(collect(FEATURES, 'headerItems').filter(h => h.id.startsWith('planner')).map(h => h.id)).toEqual(['planner-dialog']);
  });

  it('opens from its tool, closes, and loads the recipes only when opened', async () => {
    const { calls } = setup();
    const button = screen.getByRole('button', { name: 'Planner' });
    expect(calls).toEqual([]);
    await userEvent.click(button);
    expect(usePlanner.getState().visible).toBe(true);
    expect(await screen.findByRole('heading', { name: 'Production planner' })).toBeInTheDocument();
    await screen.findByRole('combobox', { name: 'Item 1' });
    expect(calls.map(c => c.path)).toEqual(['/data/test/recipes.json']);
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(usePlanner.getState().visible).toBe(false);
  });

  it('uses the dataset the server serves, also for a world created with an older one', async () => {
    const { calls } = setup('present', '1.2.4.1');
    await userEvent.click(screen.getByRole('button', { name: 'Planner' }));
    await screen.findByRole('combobox', { name: 'Item 1' });
    expect(calls.map(c => c.path)).toEqual(['/data/test/recipes.json']);
  });

  it('says so when the dataset has no recipe data', async () => {
    setup('missing');
    await userEvent.click(screen.getByRole('button', { name: 'Planner' }));
    expect(await screen.findByText(/This dataset has no recipe data/)).toBeInTheDocument();
  });

  it('resolves a picked item down to the miner, with machines, recipes and totals', async () => {
    setup();
    await openAndPick('plate');
    expect(screen.getByRole('combobox', { name: 'Item 1' })).toHaveValue('plate');

    const plate = stepOf('plate');
    expect(within(plate).getByText('60/min')).toBeInTheDocument();
    expect(within(plate).getByText('3 × Constructor')).toBeInTheDocument();
    expect(within(plate).getByLabelText('Made by')).toHaveDisplayValue('R_Plate (Constructor)');
    expect(within(plate).getByText(/90\/min ingot/)).toBeInTheDocument();
    expect(within(stepOf('ore')).getByText('2 × Miner Mk.1')).toBeInTheDocument();
    expect(within(stepOf('ore')).getByText(/exact 1\.5/)).toBeInTheDocument();

    const totals = screen.getByRole('region', { name: 'Totals' });
    expect(within(totals).getByText(/Power:/).parentElement).toHaveTextContent('Power: 31.5 MW'); // 3x4 + 3x4 + 1.5x5
  });

  it('switches to an alternate recipe and to another miner', async () => {
    setup();
    await openAndPick('plate');
    await userEvent.selectOptions(within(stepOf('plate')).getByLabelText('Made by'), 'R_PlateAlt (Assembler)');
    expect(within(stepOf('plate')).getByText('4 × Assembler')).toBeInTheDocument();
    expect(usePlanner.getState().choices).toEqual({ plate: { kind: 'recipe', recipe: 'R_PlateAlt' } });
    expect(stepOf('water')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('radio', { name: 'Miner Mk.2' }));
    expect(within(stepOf('ore')).getByText('1 × Miner Mk.2')).toBeInTheDocument();

    // Back to the default recipe: the choice is dropped
    await userEvent.selectOptions(within(stepOf('plate')).getByLabelText('Made by'), 'R_Plate (Constructor)');
    expect(usePlanner.getState().choices).toEqual({});
  });

  it('applies extractor clock speed and purity, per step too, and reports invalid clock speeds', async () => {
    setup();
    await openAndPick('ore');
    const clock = screen.getByLabelText('Extractor clock speed (%)');
    await userEvent.clear(clock);
    await userEvent.type(clock, '50');
    expect(within(stepOf('ore')).getByText('2 × Miner Mk.1')).toBeInTheDocument();
    expect(screen.getByText(/Factors from the Satisfactory wiki/)).toBeInTheDocument();
    expect(screen.getByText(/^1 % to 250 %: above 100 % each building needs a Power Shard per 50 % \(up to 3\)\./)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: 'Pure ×2' }));
    expect(within(stepOf('ore')).getByText('1 × Miner Mk.1')).toBeInTheDocument();
    expect(within(stepOf('ore')).getByLabelText('Node purity')).toHaveValue('pure');

    // Per step: 200 % on an impure node = 60/min per miner, 2 shards each
    const ore = stepOf('ore');
    await userEvent.type(within(ore).getByLabelText('Clock speed (%)'), '200');
    await userEvent.selectOptions(within(ore).getByLabelText('Node purity'), 'impure');
    expect(within(stepOf('ore')).getByText('1 × Miner Mk.1')).toBeInTheDocument();
    expect(within(stepOf('ore')).getByText('2 Power Shards per building')).toBeInTheDocument();
    expect(usePlanner.getState().steps).toEqual({ ore: { clock: '200', purity: 'impure' } });

    await userEvent.clear(within(stepOf('ore')).getByLabelText('Clock speed (%)'));
    await userEvent.type(within(stepOf('ore')).getByLabelText('Clock speed (%)'), '300');
    expect(screen.getByRole('alert')).toHaveTextContent('The clock speed for ore must be a number from 1 to 250.');
    // The last working plan stays, so the field can be corrected right there.
    expect(screen.getByText(/last plan that worked/)).toBeInTheDocument();
    await userEvent.clear(within(stepOf('ore')).getByLabelText('Clock speed (%)'));
    await userEvent.type(within(stepOf('ore')).getByLabelText('Clock speed (%)'), '200');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(/last plan that worked/)).toBeNull();
  });

  it('runs a resource well at its pressurizer\'s clock speed, with its shards, power and the game mode note', async () => {
    setup();
    await openAndPick('gas');
    const gas = stepOf('gas');
    expect(within(gas).getByText('1 × Well')).toBeInTheDocument();
    expect(within(gas).getByText(/clock speed is set at the Pressurizer and applies to all extractors/)).toBeInTheDocument();
    const totals = screen.getByRole('region', { name: 'Totals' });
    expect(within(totals).getByText('gas: one Pressurizer per resource well, 150 MW at 100 %; not included in the power.')).toBeInTheDocument();
    expect(within(totals).getByText(/Values are for the default game mode/)).toBeInTheDocument();

    // 200 %: 120 m³/min per extractor, the pressurizer takes 2 shards and 150 MW x 2^1.321929 = 375 MW
    await userEvent.type(within(gas).getByLabelText('Clock speed (%)'), '200');
    expect(within(stepOf('gas')).getByText('2 Power Shards per Pressurizer')).toBeInTheDocument();
    expect(within(stepOf('gas')).queryByText(/per building/)).not.toBeInTheDocument();
    expect(within(totals).getByText('gas: one Pressurizer per resource well, 375 MW at 200 %, 2 Power Shards; not included in the power.')).toBeInTheDocument();
    expect(within(totals).getByText(/Power:/).parentElement).toHaveTextContent('Power: 0 MW');
  });

  it('runs production buildings at a set clock speed', async () => {
    setup();
    await openAndPick('plate');
    await userEvent.type(within(stepOf('plate')).getByLabelText('Clock speed (%)'), '150');
    // 30 plates/min per constructor at 150 %
    expect(within(stepOf('plate')).getByText('2 × Constructor')).toBeInTheDocument();
    expect(within(stepOf('plate')).getByText('1 Power Shard per building')).toBeInTheDocument();
    expect(within(stepOf('ingot')).getByText('3 × Smelter')).toBeInTheDocument();
  });

  it('uses by-products for other steps and lists the rest as surplus', async () => {
    usePlanner.setState({ choices: { fuel: { kind: 'recipe', recipe: 'R_ResFuel' } } });
    setup();
    await openAndPick('plastic');
    await userEvent.click(screen.getByRole('button', { name: '+ Add item' }));
    await userEvent.type(screen.getByRole('combobox', { name: 'Item 2' }), 'fuel');
    await userEvent.keyboard('{Enter}');
    const rate = screen.getByRole('textbox', { name: 'Per minute of fuel' });
    await userEvent.clear(rate);
    await userEvent.type(rate, '4');
    // 60 plastic make 30 residue; 4 fuel need 6
    expect(within(stepOf('residue')).getByText(/from by-products of other steps/)).toBeInTheDocument();
    expect(within(stepOf('residue')).getByText(/no buildings needed/)).toBeInTheDocument();
    const totals = screen.getByRole('region', { name: 'Totals' });
    expect(within(totals).getByRole('heading', { name: 'Surplus' })).toBeInTheDocument();
  });

  it('supplies the packaged item from outside for a picked unpacking recipe', async () => {
    usePlanner.setState({ choices: { fuel: { kind: 'recipe', recipe: 'R_Unpack' } } });
    setup();
    await openAndPick('fuel');
    expect(within(stepOf('pfuel')).getByText(/Supplied from outside automatically/)).toBeInTheDocument();
  });

  it('marks loops and reports loops that cannot work', async () => {
    usePlanner.setState({ choices: { rubber: { kind: 'recipe', recipe: 'R_RecRubber' }, plastic: { kind: 'recipe', recipe: 'R_RecPlastic' } } });
    setup();
    await openAndPick('rubber');
    expect(within(stepOf('rubber')).getByText('Loop')).toBeInTheDocument();
    expect(within(stepOf('plastic')).getByText('Loop')).toBeInTheDocument();
    expect(within(stepOf('rubber')).getByText(/60\/min of it for you/)).toBeInTheDocument();

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
    const rate = screen.getByRole('textbox', { name: 'Per minute of ingot' });
    await userEvent.clear(rate);
    await userEvent.type(rate, '30');
    expect(within(stepOf('ingot')).getByText('120/min')).toBeInTheDocument();
    expect(loadPlanner()?.targets.map(t => [t.item, t.rate])).toEqual([['plate', '60'], ['ingot', '30']]);
    await userEvent.click(screen.getByRole('button', { name: 'Remove plate' }));
    expect(usePlanner.getState().targets.map(t => t.item)).toEqual(['ingot']);
  });

  it('shows names and labels in German', async () => {
    initI18n(['de']);
    setup();
    await userEvent.click(screen.getByRole('button', { name: 'Planer' }));
    const box = await screen.findByRole('combobox', { name: 'Gegenstand 1' });
    await userEvent.type(box, 'plate-de');
    await userEvent.keyboard('{Enter}');
    expect(within(stepOf('plate-de')).getByText('3 × Konstruktor')).toBeInTheDocument();
    expect(within(stepOf('plate-de')).getByLabelText('Hergestellt mit')).toBeInTheDocument();
    expect(within(stepOf('ore-de')).getByLabelText('Reinheit des Rohstoffvorkommens')).toBeInTheDocument();
    await userEvent.type(within(stepOf('plate-de')).getByLabelText('Taktrate (%)'), '150');
    expect(within(stepOf('plate-de')).getByText('1 Energiefragment je Gebäude')).toBeInTheDocument();
  });

  it('shows a resource well\'s pressurizer in German', async () => {
    initI18n(['de']);
    setup();
    await userEvent.click(screen.getByRole('button', { name: 'Planer' }));
    await userEvent.type(await screen.findByRole('combobox', { name: 'Gegenstand 1' }), 'gas-de');
    await userEvent.keyboard('{Enter}');
    await userEvent.type(within(stepOf('gas-de')).getByLabelText('Taktrate (%)'), '250');
    expect(within(stepOf('gas-de')).getByText('3 Energiefragmente je Kompressor')).toBeInTheDocument();
    const totals = screen.getByRole('region', { name: 'Summen' });
    expect(within(totals).getByText(/^gas-de: ein Kompressor je Rohstoffquelle, .* MW bei 250 %, 3 Energiefragmente; nicht im Strom eingerechnet\.$/)).toBeInTheDocument();
    expect(within(totals).getByText(/Standard-Spielmodus/)).toBeInTheDocument();
  });

  it('picks items with the keyboard and closes only the list on Escape', async () => {
    setup();
    await userEvent.click(screen.getByRole('button', { name: 'Planner' }));
    const box = await screen.findByRole('combobox', { name: 'Item 1' });
    await userEvent.type(box, 'pla');
    expect(box).toHaveAttribute('aria-expanded', 'true');
    const options = screen.getAllByRole('option');
    expect(options.map(o => o.textContent)).toEqual(['plasticplastic-de', 'plateplate-de']);
    await userEvent.keyboard('{ArrowDown}');
    expect(box).toHaveAttribute('aria-activedescendant', options[1]!.id);
    await userEvent.keyboard('{Escape}');
    expect(box).toHaveAttribute('aria-expanded', 'false');
    expect(usePlanner.getState().visible).toBe(true);
    await waitFor(() => expect(usePlanner.getState().targets[0]!.item).toBeNull());
  });
});

describe('production planner diagram', () => {
  beforeEach(() => {
    initI18n(['en']);
    localStorage.clear();
    usePlanner.setState({ visible: false, targets: [{ key: 1, item: null, rate: '60' }], choices: {}, steps: {}, settings: { miner: null, clock: '100', purity: 'normal' }, view: 'diagram' });
  });
  afterEach(() => vi.unstubAllGlobals());

  const diagram = (name = 'Production chain') => screen.getByRole('group', { name });
  /** A node's button: its accessible name starts with the item. */
  const node = (item: string, name?: string) => within(diagram(name)).getByRole('button', { name: new RegExp(`^${item}[ ;]`) });
  const edges = () => [...diagram().querySelectorAll('path[data-edge]')].map(p => `${p.getAttribute('data-from')}>${p.getAttribute('data-to')}:${p.getAttribute('data-edge')}`);

  it('shows the plan as a diagram from left to right, with rates on the edges and the totals below', async () => {
    setup();
    await openAndPick('plate');
    expect(screen.getByRole('radio', { name: 'Diagram' })).toHaveAttribute('aria-checked', 'true');
    const [plate, ingot, ore] = [node('plate'), node('ingot'), node('ore')];
    expect(parseFloat(plate.style.left)).toBeLessThan(parseFloat(ingot.style.left));
    expect(parseFloat(ingot.style.left)).toBeLessThan(parseFloat(ore.style.left));
    expect(plate).toHaveAccessibleName('plate (wanted: 60/min); 3 × Constructor; 60/min; R_Plate; In: 90/min ingot');
    expect(within(plate).getByText('3 × Constructor')).toBeInTheDocument();
    expect(within(ore).getByText('2 × Miner Mk.1')).toHaveAttribute('title', 'exact 1.5');
    expect(within(ore).getByText('Normal ×1')).toBeInTheDocument();
    expect(edges()).toEqual(['ingot>plate:input', 'ore>ingot:input']);
    expect(within(diagram()).getAllByText('90/min', { selector: 'span[aria-hidden]' })).toHaveLength(2);
    expect(screen.getByRole('list', { name: 'Legend' })).toHaveTextContent('By-product of another step');
    expect(screen.queryByRole('heading', { level: 4, name: /^plate/ })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Totals' })).toBeInTheDocument();
  });

  it('selects a node to edit its step, with the mouse or the keyboard', async () => {
    setup();
    await openAndPick('plate');
    await userEvent.click(node('plate'));
    expect(node('plate')).toHaveAttribute('aria-expanded', 'true');
    const editor = screen.getByRole('region', { name: 'Edit plate' });
    expect(node('plate')).toHaveAttribute('aria-controls', editor.id);
    await userEvent.selectOptions(within(editor).getByLabelText('Made by'), 'R_PlateAlt (Assembler)');
    expect(within(node('plate')).getByText('4 × Assembler')).toBeInTheDocument();
    expect(within(node('plate')).getByText('Alternate')).toBeInTheDocument();
    expect(node('plate')).toHaveAccessibleName(/; R_PlateAlt \(alternate recipe\);/);
    expect(edges()).toContain('water>plate:input');

    // One tab stop; the arrow keys move to the nearest node of the next column.
    node('plate').focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(node('ingot')).toHaveFocus();
    expect(node('ingot')).toHaveAttribute('tabindex', '0');
    expect(node('plate')).toHaveAttribute('tabindex', '-1');
    await userEvent.keyboard('{Enter}');
    expect(screen.queryByRole('region', { name: 'Edit plate' })).not.toBeInTheDocument();
    const ingotEditor = screen.getByRole('region', { name: 'Edit ingot' });
    await userEvent.type(within(ingotEditor).getByLabelText('Clock speed (%)'), '200');
    expect(within(node('ingot')).getByText('200 %')).toBeInTheDocument();
    expect(within(node('ingot')).getByText('2 Power Shards')).toHaveAttribute('title', '2 Power Shards per building');

    await userEvent.click(within(ingotEditor).getByRole('button', { name: 'Stop editing ingot' }));
    expect(screen.queryByRole('region', { name: 'Edit ingot' })).not.toBeInTheDocument();
    expect(node('ingot')).toHaveFocus();
    // Clicking the selected node again closes its editor too.
    await userEvent.click(node('ore'));
    await userEvent.click(node('ore'));
    expect(screen.queryByRole('region', { name: 'Edit ore' })).not.toBeInTheDocument();
  });

  it('switches between diagram and list and remembers the view', async () => {
    setup();
    await openAndPick('plate');
    await userEvent.click(screen.getByRole('radio', { name: 'List' }));
    expect(screen.queryByRole('group', { name: 'Production chain' })).not.toBeInTheDocument();
    expect(within(stepOf('plate')).getByText('3 × Constructor')).toBeInTheDocument();
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

  it('draws by-products, loops and items supplied from outside', async () => {
    usePlanner.setState({ choices: { fuel: { kind: 'recipe', recipe: 'R_ResFuel' } } });
    setup();
    await openAndPick('plastic');
    await userEvent.click(screen.getByRole('button', { name: '+ Add item' }));
    await userEvent.type(screen.getByRole('combobox', { name: 'Item 2' }), 'fuel');
    await userEvent.keyboard('{Enter}');
    const rate = screen.getByRole('textbox', { name: 'Per minute of fuel' });
    await userEvent.clear(rate);
    await userEvent.type(rate, '4');
    expect(edges()).toContain('plastic>residue:byproduct');
    expect(within(node('residue')).getByText('From by-products')).toBeInTheDocument();
    expect(within(node('residue')).getByText('30 m³/min')).toBeInTheDocument();
  });

  it('dashes the edges of a loop and marks its steps', async () => {
    usePlanner.setState({ choices: { rubber: { kind: 'recipe', recipe: 'R_RecRubber' }, plastic: { kind: 'recipe', recipe: 'R_RecPlastic' } } });
    setup();
    await openAndPick('rubber');
    expect(edges().filter(e => e.endsWith(':loop')).sort()).toEqual(['plastic>rubber:loop', 'rubber>plastic:loop']);
    expect(within(node('rubber')).getByText('Loop')).toHaveAttribute('title', 'Part of a loop: these steps feed each other.');
    expect(node('plastic').style.left).toBe(node('rubber').style.left);
  });

  it('marks an item supplied from outside', async () => {
    usePlanner.setState({ choices: { fuel: { kind: 'recipe', recipe: 'R_Unpack' } } });
    setup();
    await openAndPick('fuel');
    const pfuel = node('pfuel');
    expect(within(pfuel).getByText('Supplied from outside')).toBeInTheDocument();
    expect(within(pfuel).getByText('Automatically, avoids a loop')).toBeInTheDocument();
    expect(pfuel.className).toContain('border-dashed');
  });

  it('shows the diagram in German', async () => {
    initI18n(['de']);
    setup();
    await userEvent.click(screen.getByRole('button', { name: 'Planer' }));
    await userEvent.type(await screen.findByRole('combobox', { name: 'Gegenstand 1' }), 'plate-de');
    await userEvent.keyboard('{Enter}');
    expect(screen.getByRole('radiogroup', { name: 'Ansicht' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Diagramm' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'Liste' })).toBeInTheDocument();
    const plate = node('plate-de', 'Produktionskette');
    expect(plate).toHaveAccessibleName('plate-de (gewünscht: 60/min); 3 × Konstruktor; 60/min; R_Plate; Ein: 90/min ingot-de');
    expect(screen.getByText(/^Gewünschte Gegenstände links/)).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Legende' })).toHaveTextContent('Nebenprodukt eines anderen Schritts');
    await userEvent.click(plate);
    const editor = screen.getByRole('region', { name: 'plate-de bearbeiten' });
    expect(within(editor).getByLabelText('Hergestellt mit')).toBeInTheDocument();
    await userEvent.type(within(editor).getByLabelText('Taktrate (%)'), '150');
    expect(within(node('plate-de', 'Produktionskette')).getByText('1 Energiefragment')).toHaveAttribute('title', '1 Energiefragment je Gebäude');
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
