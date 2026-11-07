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
    usePlanner.setState({ visible: false, targets: [{ key: 1, item: null, rate: '60' }], choices: {}, steps: {}, settings: { miner: null, clock: '100', purity: 'normal' } });
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
