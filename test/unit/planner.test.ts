import {
  choiceKey, choiceOptions, clockLimits, defaultChoice, evenClock, MAX_SHARDS, offeredChoice, parseChoiceKey, plan, shardsFor, solveLinear,
  stronglyConnected, type PlanInput, type PlanResult, type PlanSettings,
} from '../../src/shared/planner.js';
import { indexRecipes } from '../../src/shared/recipes.js';
import { EXP, RECIPE_DATA as DATA } from '../fixtures/recipeData.js';

const IDX = indexRecipes(DATA);
const S: PlanSettings = { miner: 'mk1', clock: 1, purity: 'normal' };

function ok(input: Partial<PlanInput> & Pick<PlanInput, 'targets'>) {
  const r = plan(IDX, { settings: S, ...input });
  if (!r.ok) throw new Error(`plan failed: ${JSON.stringify(r)}`);
  return r;
}
const step = (r: Extract<PlanResult, { ok: true }>, id: string) => r.steps.find(s => s.item === id)!;

describe('planner', () => {
  it('resolves a chain down to the miner, with machines, rates, power and depth', () => {
    const r = ok({ targets: [{ item: 'plate', rate: 20 }] });
    expect(r.steps.map(s => [s.item, s.depth])).toEqual([['plate', 0], ['ingot', 1], ['ore', 2]]);
    expect(step(r, 'plate')).toMatchObject({ building: 'constructor', machines: 1, machinesCeil: 1, rate: 20, targetRate: 20, inputs: [{ item: 'ingot', rate: 30 }], cycle: false });
    expect(step(r, 'plate').recipe?.id).toBe('R_Plate');
    expect(step(r, 'ingot')).toMatchObject({ building: 'smelter', machines: 1, rate: 30, inputs: [{ item: 'ore', rate: 30 }] });
    expect(step(r, 'ore')).toMatchObject({ building: 'mk1', machines: 0.5, machinesCeil: 1, rate: 30, inputs: [] });
    expect(r.totals.raw).toEqual([{ item: 'ore', rate: 30, extractor: 'mk1', machines: 0.5, machinesCeil: 1 }]);
    expect(r.totals.machines).toEqual([
      { building: 'constructor', machines: 1, machinesCeil: 1 },
      { building: 'smelter', machines: 1, machinesCeil: 1 },
      { building: 'mk1', machines: 0.5, machinesCeil: 1 },
    ]);
    expect(r.totals.power).toEqual({ min: 10.5, max: 10.5 });
  });

  it('rounds machines up per step but keeps the exact count', () => {
    const s = step(ok({ targets: [{ item: 'plate', rate: 25 }] }), 'plate');
    expect(s.machines).toBeCloseTo(1.25);
    expect(s.machinesCeil).toBe(2);
    // No rounding up of float noise: 3 x 1/3 is 1 machine, not 2.
    expect(step(ok({ targets: [{ item: 'plate', rate: 20 / 3 }, { item: 'plate', rate: 20 / 3 }, { item: 'plate', rate: 20 / 3 }] }), 'plate').machinesCeil).toBe(1);
  });

  it('uses a chosen alternate; purity and miner tier apply to node extractors, not to water extractors', () => {
    const r = ok({
      targets: [{ item: 'plate', rate: 30 }],
      choices: { plate: { kind: 'recipe', recipe: 'R_PlateAlt' } },
      settings: { miner: 'mk2', clock: 1, purity: 'pure' },
    });
    expect(step(r, 'ore').purity).toBe('pure');
    expect(step(r, 'water').purity).toBeUndefined();
    expect(step(r, 'plate')).toMatchObject({ building: 'assembler', machines: 2, inputs: [{ item: 'ingot', rate: 20 }, { item: 'water', rate: 10 }] });
    expect(step(r, 'water').extractor?.id).toBe('pump');
    expect(step(r, 'water').machines).toBeCloseTo(10 / 120);
    expect(step(r, 'ore').extractor?.id).toBe('mk2');
    expect(step(r, 'ore').machines).toBeCloseTo(20 / 240);
  });

  it('applies the clock speed to rate and, with the power exponent, to power', () => {
    const r = ok({ targets: [{ item: 'ore', rate: 300 }], settings: { miner: 'mk1', clock: 2.5, purity: 'normal' } });
    const ore = step(r, 'ore');
    expect(ore.machines).toBeCloseTo(2);
    expect(ore.power.min).toBeCloseTo(2 * 5 * 2.5 ** EXP);
    expect(ore).toMatchObject({ clock: 2.5, shards: 3 });
  });

  it('takes clock speed and purity per step; production buildings default to 100 %', () => {
    const r = ok({ targets: [{ item: 'plate', rate: 40 }], steps: { plate: { clock: 2 }, ore: { purity: 'impure', clock: 0.5 } } });
    // 20 plates/min at 100 %, 40 at 200 %: one constructor with 2 shards, power 4 MW x 2^exp
    expect(step(r, 'plate')).toMatchObject({ machines: 1, clock: 2, shards: 2, inputs: [{ item: 'ingot', rate: 60 }] });
    expect(step(r, 'plate').power.min).toBeCloseTo(4 * 2 ** EXP);
    expect(step(r, 'ingot')).toMatchObject({ machines: 2, clock: 1, shards: 0 });
    // Mk.1 60/min x 0.5 clock x 0.5 impure = 15/min each
    expect(step(r, 'ore')).toMatchObject({ purity: 'impure', clock: 0.5 });
    expect(step(r, 'ore').machines).toBeCloseTo(4);
    expect(plan(IDX, { targets: [{ item: 'plate', rate: 1 }], steps: { ingot: { clock: 2.6 } }, settings: S })).toEqual({ ok: false, error: 'invalid-clock', item: 'ingot' });
    // A step setting for an item outside the plan does not matter.
    expect(plan(IDX, { targets: [{ item: 'plate', rate: 1 }], steps: { glow: { clock: 9 } }, settings: S }).ok).toBe(true);
  });

  it('counts Power Shards: one per 50 % above 100 %', () => {
    expect([0.5, 1, 1.01, 1.5, 1.51, 2, 2.5].map(c => shardsFor(c, 0.5))).toEqual([0, 0, 1, 1, 2, 2, 3]);
    expect(shardsFor(1.3, 0.25)).toBe(2);
  });

  it('takes the clock speed limits from the data: minimum and per shard, up to 3 shards', () => {
    expect(MAX_SHARDS).toBe(3);
    expect(clockLimits(DATA.clock)).toEqual({ min: 0.01, max: 2.5, perShard: 0.5 });
    // Other values in the data change the limits and the shard count.
    const idx = indexRecipes({ ...DATA, clock: { min: 0.1, perShard: 0.25 } });
    const at = (clock: number) => plan(idx, { targets: [{ item: 'plate', rate: 1 }], steps: { plate: { clock } }, settings: S });
    expect(at(0.05)).toEqual({ ok: false, error: 'invalid-clock', item: 'plate' });
    expect(at(2)).toEqual({ ok: false, error: 'invalid-clock', item: 'plate' });
    const r = at(1.75);
    expect(r.ok && r.steps[0]!.shards).toBe(3);
    expect(plan(idx, { targets: [{ item: 'plate', rate: 1 }], settings: { ...S, clock: 0.05 } })).toEqual({ ok: false, error: 'invalid-settings' });
  });

  it('lets a fluid come from another extractor and notes resource wells', () => {
    const r = ok({ targets: [{ item: 'oil', rate: 120 }], choices: { oil: { kind: 'extract', extractor: 'well' } } });
    expect(step(r, 'oil')).toMatchObject({ building: 'well', machines: 2, power: { min: 0, max: 0 }, shards: 0, pressurizer: { building: 'press', power: 150 } });
    expect(r.totals.pressurizers).toEqual([{ item: 'oil', building: 'press', clock: 1, shards: 0, power: 150 }]);
    expect(r.totals.power).toEqual({ min: 0, max: 0 });
    // Default for oil: the oil extractor, not the well
    expect(step(ok({ targets: [{ item: 'oil', rate: 120 }] }), 'oil').building).toBe('oilpump');
    // Gas has only the well
    expect(step(ok({ targets: [{ item: 'gas', rate: 60 }] }), 'gas').building).toBe('well');
    // No pressurizer for other extractors
    expect(step(ok({ targets: [{ item: 'oil', rate: 120 }] }), 'oil').pressurizer).toBeUndefined();
  });

  it('runs a resource well at its pressurizer\'s clock speed: shards and power in the pressurizer, none in the extractors', () => {
    // 60 m³/min per extractor x 2 (pressurizer at 200 %) x 2 (pure sub-nodes) = 240 per extractor
    const r = ok({ targets: [{ item: 'gas', rate: 480 }], steps: { gas: { clock: 2, purity: 'pure' } } });
    const gas = step(r, 'gas');
    expect(gas).toMatchObject({ building: 'well', clock: 2, shards: 2, purity: 'pure', power: { min: 0, max: 0 } });
    expect(gas.machines).toBeCloseTo(2);
    expect(gas.pressurizer!.power).toBeCloseTo(150 * 2 ** EXP);
    expect(r.totals.pressurizers).toEqual([{ item: 'gas', building: 'press', clock: 2, shards: 2, power: gas.pressurizer!.power }]);
    expect(r.totals.power).toEqual({ min: 0, max: 0 });
    // Underclocked: less power, no shards
    const slow = step(ok({ targets: [{ item: 'gas', rate: 30 }], steps: { gas: { clock: 0.5 } } }), 'gas');
    expect(slow).toMatchObject({ shards: 0 });
    expect(slow.machines).toBeCloseTo(1);
    expect(slow.pressurizer!.power).toBeCloseTo(150 * 0.5 ** EXP);
    // Data without a pressurizer: no pressurizer entry
    const bare = plan(indexRecipes({ ...DATA, wellPressurizer: undefined }), { targets: [{ item: 'gas', rate: 60 }], settings: S });
    expect(bare.ok && [bare.steps[0]!.pressurizer, bare.totals.pressurizers]).toEqual([undefined, []]);
  });

  it('lists by-products nobody uses as surplus', () => {
    const r = ok({ targets: [{ item: 'plastic', rate: 20 }] });
    expect(step(r, 'plastic')).toMatchObject({ machines: 1, outputs: [{ item: 'plastic', rate: 20 }, { item: 'residue', rate: 10 }], byproducts: [{ item: 'residue', rate: 10 }] });
    expect(r.totals.byproducts).toEqual([{ item: 'residue', rate: 10 }]);
  });

  it('uses by-products against demand: the item\'s own step makes only the rest', () => {
    // Plastic makes 10 residue/min; Residual Fuel needs 30 residue for 20 fuel: the residue step makes 20.
    const r = ok({ targets: [{ item: 'plastic', rate: 20 }, { item: 'fuel', rate: 20 }], choices: { fuel: { kind: 'recipe', recipe: 'R_ResFuel' } } });
    expect(step(r, 'residue').fromByproducts).toBeCloseTo(10);
    expect(step(r, 'residue').rate).toBeCloseTo(20);
    expect(step(r, 'residue').machines).toBeCloseTo(1);
    expect(step(r, 'oil').rate).toBeCloseTo(30 + 40);
    expect(r.totals.byproducts).toEqual([]);
  });

  it('builds nothing for an item by-products fully cover, and lists the rest as surplus', () => {
    // 4 fuel need 6 residue; the plastic step makes 10.
    const r = ok({ targets: [{ item: 'plastic', rate: 20 }, { item: 'fuel', rate: 4 }], choices: { fuel: { kind: 'recipe', recipe: 'R_ResFuel' } } });
    expect(step(r, 'residue')).toMatchObject({ rate: 0, machines: 0, machinesCeil: 0, power: { min: 0, max: 0 } });
    expect(step(r, 'residue').fromByproducts).toBeCloseTo(10);
    expect(step(r, 'oil').rate).toBeCloseTo(30);
    expect(r.totals.byproducts.map(f => [f.item, Math.round(f.rate * 1e6) / 1e6])).toEqual([['residue', 4]]);
  });

  it('makes an item from a recipe where it is the by-product, if chosen', () => {
    const r = ok({ targets: [{ item: 'residue', rate: 10 }], choices: { residue: { kind: 'recipe', recipe: 'R_Plastic' } } });
    expect(step(r, 'residue')).toMatchObject({ machines: 1, rate: 10, byproducts: [{ item: 'plastic', rate: 20 }] });
    expect(r.totals.byproducts).toEqual([{ item: 'plastic', rate: 20 }]);
  });

  it('supplies the packaged item from outside when an unpacking recipe is picked, instead of looping', () => {
    const r = ok({ targets: [{ item: 'fuel', rate: 60 }], choices: { fuel: { kind: 'recipe', recipe: 'R_Unpack' } } });
    expect(step(r, 'pfuel')).toMatchObject({ choice: { kind: 'external' }, auto: 'loop', rate: 60 });
    expect(r.totals.external).toEqual([{ item: 'pfuel', rate: 60 }]);
    // Picked by the user, the packaging recipe loops back: no plan.
    const looped = plan(IDX, { targets: [{ item: 'fuel', rate: 60 }], choices: { fuel: { kind: 'recipe', recipe: 'R_Unpack' }, pfuel: { kind: 'recipe', recipe: 'R_PackFuel' } }, settings: S });
    expect(looped).toEqual({ ok: false, error: 'cycle', items: ['fuel', 'pfuel'] });
    // Without a picked recipe nothing is changed.
    expect(step(ok({ targets: [{ item: 'pfuel', rate: 60 }] }), 'fuel').auto).toBeUndefined();
  });

  it('solves a loop that makes more than it uses (recycled rubber and plastic) without recursion', () => {
    const r = ok({
      targets: [{ item: 'rubber', rate: 60 }],
      choices: { rubber: { kind: 'recipe', recipe: 'R_RecRubber' }, plastic: { kind: 'recipe', recipe: 'R_RecPlastic' } },
    });
    expect(step(r, 'rubber').machines).toBeCloseTo(2 / 3);
    expect(step(r, 'rubber').rate).toBeCloseTo(80);
    expect(step(r, 'rubber').targetRate).toBe(60);
    expect(step(r, 'plastic').machines).toBeCloseTo(1 / 3);
    expect(step(r, 'plastic').rate).toBeCloseTo(40);
    expect(step(r, 'fuel').rate).toBeCloseTo(60);
    expect(r.steps.map(s => [s.item, s.cycle, s.depth])).toEqual([['rubber', true, 0], ['plastic', true, 0], ['fuel', false, 1], ['oil', false, 2]]);
  });

  it('reports a loop that uses up as much as or more than it makes', () => {
    expect(plan(IDX, { targets: [{ item: 'a', rate: 1 }], settings: S })).toEqual({ ok: false, error: 'cycle', items: ['a', 'b'] });
    expect(plan(IDX, { targets: [{ item: 'c', rate: 1 }], settings: S })).toEqual({ ok: false, error: 'cycle', items: ['c', 'd'] });
  });

  it('treats items without a producer, and items chosen so, as supplied from outside', () => {
    const r = ok({ targets: [{ item: 'biomass', rate: 5 }] });
    expect(step(r, 'leaves')).toMatchObject({ choice: { kind: 'external' }, rate: 10, machines: 0, machinesCeil: 0 });
    expect(r.totals.external).toEqual([{ item: 'leaves', rate: 10 }]);
    const r2 = ok({ targets: [{ item: 'plate', rate: 20 }], choices: { ingot: { kind: 'external' } } });
    expect(r2.steps.map(s => s.item)).toEqual(['plate', 'ingot']);
    expect(r2.totals.external).toEqual([{ item: 'ingot', rate: 30 }]);
    expect(r2.totals.raw).toEqual([]);
  });

  it('gives a variable-power building its power range', () => {
    const r = ok({ targets: [{ item: 'glow', rate: 1 }] });
    expect(step(r, 'glow').power).toEqual({ min: 250, max: 750 });
    expect(r.totals.power.max - r.totals.power.min).toBeCloseTo(500);
  });

  it('adds up several targets and shared intermediates', () => {
    const r = ok({ targets: [{ item: 'plate', rate: 20 }, { item: 'ingot', rate: 30 }, { item: 'ingot', rate: 0 }] });
    expect(step(r, 'ingot')).toMatchObject({ rate: 60, targetRate: 30, machines: 2, depth: 1 });
  });

  it('falls back to the default for a choice that does not fit the item', () => {
    const r = ok({ targets: [{ item: 'plate', rate: 20 }], choices: { plate: { kind: 'recipe', recipe: 'R_Ingot' }, ingot: { kind: 'extract' }, ore: { kind: 'extract', extractor: 'pump' } } });
    expect(step(r, 'plate').recipe?.id).toBe('R_Plate');
    expect(step(r, 'ingot').recipe?.id).toBe('R_Ingot');
    expect(step(r, 'ore').building).toBe('mk1');
  });

  it('reports bad input', () => {
    expect(plan(IDX, { targets: [{ item: 'nope', rate: 1 }], settings: S })).toEqual({ ok: false, error: 'unknown-item', item: 'nope' });
    expect(plan(IDX, { targets: [{ item: 'plate', rate: 0 }, { item: 'plate', rate: Number.NaN }], settings: S })).toEqual({ ok: false, error: 'no-targets' });
    expect(plan(IDX, { targets: [{ item: 'plate', rate: 1 }], settings: { ...S, clock: 0 } })).toEqual({ ok: false, error: 'invalid-settings' });
    expect(plan(IDX, { targets: [{ item: 'plate', rate: 1 }], settings: { ...S, clock: 2.6 } })).toEqual({ ok: false, error: 'invalid-settings' });
    expect(plan(IDX, { targets: [{ item: 'plate', rate: 1 }], settings: { ...S, purity: 'bogus' as 'pure' } })).toEqual({ ok: false, error: 'invalid-settings' });
  });

  it('offers the choices in order and round-trips their keys', () => {
    expect(choiceOptions(IDX, 'plate').map(choiceKey)).toEqual(['recipe:R_Plate', 'recipe:R_PlateAlt', 'external']);
    // Every miner is an option of its own, by tier; the miner setting is the default, not an option.
    expect(choiceOptions(IDX, 'ore').map(choiceKey)).toEqual(['extract:mk1', 'extract:mk2', 'external']);
    expect(choiceOptions(IDX, 'water').map(choiceKey)).toEqual(['extract:pump', 'extract:well', 'external']);
    expect(defaultChoice(IDX, 'water')).toEqual({ kind: 'extract', extractor: 'pump' });
    expect(defaultChoice(IDX, 'ore')).toEqual({ kind: 'extract' });
    expect(defaultChoice(IDX, 'plate')).toEqual({ kind: 'recipe', recipe: 'R_Plate' });
    expect(defaultChoice(IDX, 'leaves')).toEqual({ kind: 'external' });
    for (const c of [...choiceOptions(IDX, 'water'), ...choiceOptions(IDX, 'plate'), { kind: 'extract' } as const]) {
      expect(parseChoiceKey(choiceKey(c))).toEqual(c);
    }
    expect(parseChoiceKey('bogus')).toBeUndefined();
  });

  it('runs a step on another miner than the setting, and names the setting\'s miner for the default', () => {
    const r = ok({ targets: [{ item: 'plate', rate: 60 }], choices: { ore: { kind: 'extract', extractor: 'mk2' } } });
    // 90 ore/min: Mk.2 makes 120/min per building
    expect(step(r, 'ore')).toMatchObject({ choice: { kind: 'extract', extractor: 'mk2' }, building: 'mk2', machinesCeil: 1 });
    expect(step(r, 'ore').machines).toBeCloseTo(0.75);
    expect(r.totals.raw).toEqual([{ item: 'ore', rate: 90, extractor: 'mk2', machines: 0.75, machinesCeil: 1 }]);
    // Without a choice the step follows the setting.
    expect(step(ok({ targets: [{ item: 'plate', rate: 60 }], settings: { ...S, miner: 'mk2' } }), 'ore').building).toBe('mk2');
    expect(offeredChoice(IDX, 'ore', defaultChoice(IDX, 'ore'), S)).toEqual({ kind: 'extract', extractor: 'mk1' });
    expect(offeredChoice(IDX, 'ore', defaultChoice(IDX, 'ore'), { miner: 'mk2' })).toEqual({ kind: 'extract', extractor: 'mk2' });
    // A miner the data does not have: the lowest tier.
    expect(offeredChoice(IDX, 'ore', { kind: 'extract' }, { miner: 'mk9' })).toEqual({ kind: 'extract', extractor: 'mk1' });
    expect(offeredChoice(IDX, 'plate', { kind: 'recipe', recipe: 'R_Plate' }, S)).toEqual({ kind: 'recipe', recipe: 'R_Plate' });
    // A miner choice for an item no miner takes falls back to the default.
    expect(step(ok({ targets: [{ item: 'water', rate: 60 }], choices: { water: { kind: 'extract', extractor: 'mk2' } } }), 'water').building).toBe('pump');
  });

  it('counts the Power Shards of all buildings, not of resource wells\' pressurizers', () => {
    // 25 plates/min at 150 %: 1.25 buildings -> 2 constructors with 1 shard each; ingot and ore at 100 % need none.
    const r = ok({ targets: [{ item: 'plate', rate: 25 }, { item: 'gas', rate: 60 }], steps: { plate: { clock: 1.5 }, gas: { clock: 2 } } });
    expect(step(r, 'plate')).toMatchObject({ machinesCeil: 1, shards: 1 });
    expect(r.totals.shards).toBe(1);
    const r2 = ok({ targets: [{ item: 'plate', rate: 60 }], steps: { plate: { clock: 2.5 } } });
    expect(step(r2, 'plate')).toMatchObject({ machinesCeil: 2, shards: 3 });
    expect(r2.totals.shards).toBe(6);
    expect(ok({ targets: [{ item: 'plate', rate: 60 }] }).totals.shards).toBe(0);
  });

  it('finds the clock speed that makes the same with whole buildings', () => {
    const limits = clockLimits(DATA.clock);
    // 52.5 buildings at 100 % = 53 at 99.0566 %, rounded up to 99.06 %
    expect(evenClock({ machines: 52.5, machinesCeil: 53, clock: 1 }, limits)).toBe(0.9906);
    expect(evenClock({ machines: 1.5, machinesCeil: 2, clock: 2 }, limits)).toBe(1.5);
    // Already whole, nothing built, or below the minimum clock speed: none.
    expect(evenClock({ machines: 3, machinesCeil: 3, clock: 1 }, limits)).toBeUndefined();
    expect(evenClock({ machines: 0, machinesCeil: 0, clock: 1 }, limits)).toBeUndefined();
    expect(evenClock({ machines: 0.001, machinesCeil: 1, clock: 1 }, limits)).toBeUndefined();
    // The rounded clock speed does not need another building.
    const r = ok({ targets: [{ item: 'plate', rate: 25 }] });
    const even = evenClock(step(r, 'plate'), limits)!;
    expect(even).toBe(0.625);
    expect(step(ok({ targets: [{ item: 'plate', rate: 25 }], steps: { plate: { clock: even } } }), 'plate').machinesCeil).toBe(2);
  });
});

describe('planner helpers', () => {
  it('solves linear systems and detects singular ones', () => {
    expect(solveLinear([[2, 1], [1, 3]], [3, 5])!.map(v => Math.round(v * 1e9) / 1e9)).toEqual([0.8, 1.4]);
    expect(solveLinear([[1, 1], [1, 1]], [1, 2])).toBeUndefined();
  });

  it('finds strongly connected components, sinks first', () => {
    // 0 -> 1 -> 2 -> 1, 2 -> 3
    expect(stronglyConnected(4, [[1], [2], [1, 3], []]).map(c => [...c].sort())).toEqual([[3], [1, 2], [0]]);
  });

  it('handles long chains without deep recursion', () => {
    const n = 20_000;
    const edges = Array.from({ length: n }, (_, i) => (i + 1 < n ? [i + 1] : []));
    expect(stronglyConnected(n, edges)).toHaveLength(n);
  });
});
