import { type PlanInput, type PlanSettings } from '../../src/shared/planner.js';
import { defaultNodeExtractor, maxOutput, nodeExtractors, nodeResources, nodeSupply } from '../../src/shared/plannerNodes.js';
import { indexRecipes } from '../../src/shared/recipes.js';
import { RECIPE_DATA } from '../fixtures/recipeData.js';

const IDX = indexRecipes(RECIPE_DATA);
const S: PlanSettings = { miner: 'mk1', clock: 1, purity: 'normal' };
const input = (targets: PlanInput['targets'], extra: Partial<PlanInput> = {}): PlanInput => ({ targets, settings: S, ...extra });

describe('planner: available nodes', () => {
  it('knows the resources extracted on nodes and their extractors', () => {
    expect(nodeResources(IDX).map(i => i.id)).toEqual(['ore', 'water', 'oil', 'gas']);
    expect(nodeExtractors(IDX, 'ore').map(e => e.id)).toEqual(['mk1', 'mk2']);
    // The water extractor stands in a lake, not on a node.
    expect(nodeExtractors(IDX, 'water').map(e => e.id)).toEqual(['well']);
    expect(nodeExtractors(IDX, 'oil').map(e => e.id)).toEqual(['oilpump', 'well']);
    expect(defaultNodeExtractor(IDX, 'ore', 'mk2')?.id).toBe('mk2');
    expect(defaultNodeExtractor(IDX, 'oil', 'mk2')?.id).toBe('oilpump');
    expect(defaultNodeExtractor(IDX, 'leaves', 'mk2')).toBeUndefined();
  });

  it('adds up what the nodes give, by purity, extractor and clock speed', () => {
    const supply = nodeSupply(IDX, [
      { resource: 'ore', purity: 'normal', count: 2, extractor: 'mk1' },
      { resource: 'ore', purity: 'pure', count: 1, extractor: 'mk2' },
      { resource: 'oil', purity: 'impure', count: 1, extractor: 'oilpump' },
      // Ignored: an extractor that does not fit, no count, an extractor not on a node.
      { resource: 'ore', purity: 'pure', count: 1, extractor: 'oilpump' },
      { resource: 'oil', purity: 'pure', count: 0, extractor: 'oilpump' },
      { resource: 'water', purity: 'pure', count: 3, extractor: 'pump' },
    ], 1);
    expect(Object.fromEntries(supply)).toEqual({ ore: 2 * 60 + 240, oil: 60 });
    expect(nodeSupply(IDX, [{ resource: 'ore', purity: 'pure', count: 1, extractor: 'mk2' }], 2.5).get('ore')).toBe(600);
  });

  it('makes as much as the nodes allow, with the chosen recipe', () => {
    const supply = new Map([['ore', 120]]);
    const r = maxOutput(IDX, input([{ item: 'plate', rate: 1 }]), supply);
    if (!r.ok) throw new Error(JSON.stringify(r));
    // 20 plate need 30 ore: 120 ore make 80 plate.
    expect(r.targets).toEqual([{ item: 'plate', rate: 80 }]);
    expect(r.bottleneck).toEqual(['ore']);
    expect(r.uses).toEqual([{ item: 'ore', used: 120, available: 120 }]);
    expect(r.plan?.steps.find(s => s.item === 'plate')?.rate).toBeCloseTo(80);
    // The alternate needs less ore per plate (water comes from a water extractor, which no node limits).
    const alt = maxOutput(IDX, input([{ item: 'plate', rate: 1 }], { choices: { plate: { kind: 'recipe', recipe: 'R_PlateAlt' } } }), supply);
    if (!alt.ok) throw new Error(JSON.stringify(alt));
    expect(alt.targets[0]!.rate).toBeCloseTo(180);
    expect(alt.uses.map(u => u.item)).toEqual(['ore']);
  });

  it('keeps the ratio of several targets and names the resource that runs out first', () => {
    const r = maxOutput(IDX, input([{ item: 'plate', rate: 20 }, { item: 'plastic', rate: 20 }]), new Map([['ore', 120], ['oil', 60], ['gas', 10]]));
    if (!r.ok) throw new Error(JSON.stringify(r));
    expect(r.factor).toBeCloseTo(2);
    expect(r.targets).toEqual([{ item: 'plate', rate: 40 }, { item: 'plastic', rate: 40 }]);
    expect(r.bottleneck).toEqual(['oil']);
    // The bottleneck first; a resource the plan does not need is not listed.
    expect(r.uses).toEqual([{ item: 'oil', used: 60, available: 60 }, { item: 'ore', used: 60, available: 120 }]);
  });

  it('makes nothing when a needed resource has no nodes, and says so', () => {
    const r = maxOutput(IDX, input([{ item: 'plate', rate: 20 }, { item: 'plastic', rate: 20 }]), new Map([['ore', 120]]));
    expect(r).toMatchObject({ ok: true, factor: 0, bottleneck: ['oil'], targets: [{ item: 'plate', rate: 0 }, { item: 'plastic', rate: 0 }] });
    expect(r.ok && r.plan).toBeUndefined();
  });

  it('is unbounded when the plan needs no node resource, and passes plan errors through', () => {
    expect(maxOutput(IDX, input([{ item: 'water', rate: 10 }]), new Map())).toEqual({ ok: false, error: 'unbounded' });
    expect(maxOutput(IDX, input([{ item: 'plate', rate: 10 }], { choices: { ingot: { kind: 'external' } } }), new Map())).toEqual({ ok: false, error: 'unbounded' });
    expect(maxOutput(IDX, input([]), new Map())).toEqual({ ok: false, error: 'no-targets' });
    // Water from a resource well is limited by its nodes.
    const r = maxOutput(IDX, input([{ item: 'water', rate: 1 }], { choices: { water: { kind: 'extract', extractor: 'well' } } }), new Map([['water', 90]]));
    expect(r.ok && r.targets).toEqual([{ item: 'water', rate: 90 }]);
  });
});
