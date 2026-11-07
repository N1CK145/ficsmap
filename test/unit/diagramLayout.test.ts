import { plan, type PlanInput, type PlanSettings } from '../../src/shared/planner.js';
import { indexRecipes } from '../../src/shared/recipes.js';
import {
  DIAGRAM_DEFAULTS, diagramColumns, diagramLinks, layoutDiagram, pack, type DiagramLayout, type DiagramStep,
} from '../../src/web/features/planner/diagramLayout.js';
import { RECIPE_DATA } from '../fixtures/recipeData.js';

const IDX = indexRecipes(RECIPE_DATA);
const S: PlanSettings = { miner: 'mk1', clock: 1, purity: 'normal' };

function planSteps(input: Partial<PlanInput> & Pick<PlanInput, 'targets'>) {
  const r = plan(IDX, { settings: S, ...input });
  if (!r.ok) throw new Error(`plan failed: ${JSON.stringify(r)}`);
  return r.steps;
}

/** A made-up step: item, depth, inputs as [item, rate]. */
const step = (item: string, depth: number, inputs: [string, number][] = [], extra: Partial<DiagramStep> = {}): DiagramStep => ({
  item, depth, inputs: inputs.map(([i, rate]) => ({ item: i, rate })), byproducts: [], cycle: false, fromByproducts: 0, ...extra,
});

const node = (l: DiagramLayout, item: string) => l.nodes.find(n => n.item === item)!;
const edge = (l: DiagramLayout, from: string, to: string) => l.edges.find(e => e.from === from && e.to === to)!;
const column = (l: DiagramLayout, c: number) => l.nodes.filter(n => n.column === c).map(n => n.item);

describe('planner diagram layout', () => {
  it('puts the wanted items left, their ingredients right and extraction in the last column', () => {
    const steps = planSteps({ targets: [{ item: 'plate', rate: 30 }], choices: { plate: { kind: 'recipe', recipe: 'R_PlateAlt' } } });
    expect(steps.find(s => s.item === 'water')!.depth).toBe(1);
    // Water is extracted: it joins the ore at the right end, not the ingot.
    expect(Object.fromEntries(diagramColumns(steps))).toEqual({ plate: 0, ingot: 1, water: 2, ore: 2 });
    const l = layoutDiagram(steps);
    expect(l.columns).toBe(3);
    expect(node(l, 'plate').x).toBeLessThan(node(l, 'ingot').x);
    expect(node(l, 'ingot').x).toBeLessThan(node(l, 'ore').x);
    expect(node(l, 'water').x).toBe(node(l, 'ore').x);
    // A wanted item nothing else uses stays left, extracted or not.
    expect(Object.fromEntries(diagramColumns(planSteps({ targets: [{ item: 'ore', rate: 60 }] })))).toEqual({ ore: 0 });
  });

  it('draws every item once; a shared intermediate gets an edge per consumer', () => {
    const steps = planSteps({ targets: [{ item: 'plate', rate: 20 }, { item: 'glow', rate: 1 }] });
    const l = layoutDiagram(steps);
    expect(l.nodes.map(n => n.item).sort()).toEqual(['glow', 'ingot', 'ore', 'plate']);
    expect(diagramLinks(steps)).toEqual([
      { from: 'ingot', to: 'plate', rate: 30, kind: 'input', loop: false },
      { from: 'ingot', to: 'glow', rate: expect.closeTo(10), kind: 'input', loop: false },
      { from: 'ore', to: 'ingot', rate: expect.closeTo(40), kind: 'input', loop: false },
    ]);
    expect(l.edges).toHaveLength(3);
  });

  it('adds by-product edges, marks loop edges and leaves out flows of nothing', () => {
    const fed = planSteps({ targets: [{ item: 'plastic', rate: 60 }, { item: 'fuel', rate: 4 }], choices: { fuel: { kind: 'recipe', recipe: 'R_ResFuel' } } });
    const links = diagramLinks(fed);
    expect(links).toContainEqual({ from: 'plastic', to: 'residue', rate: 30, kind: 'byproduct', loop: false });
    // By-products cover the residue: its own recipe runs no buildings, so no oil goes into it.
    expect(links.filter(e => e.to === 'residue')).toHaveLength(1);
    expect(links.every(e => e.rate > 0)).toBe(true);

    const loop = planSteps({
      targets: [{ item: 'rubber', rate: 60 }],
      choices: { rubber: { kind: 'recipe', recipe: 'R_RecRubber' }, plastic: { kind: 'recipe', recipe: 'R_RecPlastic' } },
    });
    const ll = diagramLinks(loop);
    expect(ll.filter(e => e.loop).map(e => `${e.from}>${e.to}`).sort()).toEqual(['plastic>rubber', 'rubber>plastic']);
    expect(ll.find(e => e.from === 'fuel' && e.to === 'rubber')!.loop).toBe(false);
  });

  it('draws a loop inside its column as an arc on the right, ending at the arrowhead', () => {
    const l = layoutDiagram(planSteps({
      targets: [{ item: 'rubber', rate: 60 }],
      choices: { rubber: { kind: 'recipe', recipe: 'R_RecRubber' }, plastic: { kind: 'recipe', recipe: 'R_RecPlastic' } },
    }));
    const rubber = node(l, 'rubber');
    expect(node(l, 'plastic').column).toBe(rubber.column);
    const e = edge(l, 'plastic', 'rubber');
    expect(e.points.at(-1)!.x).toBe(rubber.x + rubber.width);
    expect(Math.min(...e.points.map(p => p.x))).toBe(rubber.x + rubber.width);
    expect(e.label.x).toBeGreaterThan(rubber.x + rubber.width);
    expect(e.path).toMatch(/^M.* C.* L/);
  });

  it('orders a column by the nodes using it, so edges do not cross', () => {
    const steps = [step('A', 0, [['Y', 1]]), step('B', 0, [['X', 1]]), step('X', 1), step('Y', 1)];
    const l = layoutDiagram(steps);
    expect(column(l, 0)).toEqual(['A', 'B']);
    expect(column(l, 1)).toEqual(['Y', 'X']);
    // Straight across: each input as high as its consumer.
    expect(node(l, 'Y').y).toBe(node(l, 'A').y);
    expect(node(l, 'X').y).toBe(node(l, 'B').y);
  });

  it('routes an edge spanning columns between the nodes there, with the label next to its consumer', () => {
    const steps = [step('T', 0, [['A', 1], ['R', 2]]), step('A', 1, [['B', 1]]), step('B', 2, [['R', 1]]), step('R', 3)];
    const l = layoutDiagram(steps);
    const t = node(l, 'T');
    const r = node(l, 'R');
    const e = edge(l, 'R', 'T');
    expect(e.points[0]).toEqual({ x: r.x, y: expect.any(Number) });
    expect(e.points.at(-1)!.x).toBe(t.x + t.width);
    expect(e.label.x - e.label.width / 2).toBeGreaterThan(t.x + t.width);
    expect(e.label.x + e.label.width / 2).toBeLessThanOrEqual(t.x + t.width + DIAGRAM_DEFAULTS.stub);
    // Where it passes the columns of A and B, it stays clear of them.
    for (const n of [node(l, 'A'), node(l, 'B')]) {
      for (const p of e.points.filter(q => q.x >= n.x && q.x <= n.x + n.width)) {
        expect(p.y < n.y || p.y > n.y + n.height).toBe(true);
      }
    }
  });

  it('keeps the nodes of a column apart and everything inside the drawing', () => {
    const l = layoutDiagram(planSteps({
      targets: [{ item: 'plate', rate: 60 }, { item: 'rubber', rate: 30 }, { item: 'glow', rate: 1 }],
      choices: { plate: { kind: 'recipe', recipe: 'R_PlateAlt' }, rubber: { kind: 'recipe', recipe: 'R_RecRubber' }, plastic: { kind: 'recipe', recipe: 'R_RecPlastic' } },
    }));
    for (let c = 0; c < l.columns; c++) {
      const ns = l.nodes.filter(n => n.column === c);
      ns.forEach((n, i) => {
        expect(n.order).toBe(i);
        if (i > 0) expect(n.y).toBeGreaterThanOrEqual(ns[i - 1]!.y + ns[i - 1]!.height + DIAGRAM_DEFAULTS.rowGap - 1e-6);
      });
    }
    for (const n of l.nodes) {
      expect(n.x).toBeGreaterThanOrEqual(0);
      expect(n.y).toBeGreaterThanOrEqual(0);
      expect(n.x + n.width).toBeLessThanOrEqual(l.width);
      expect(n.y + n.height).toBeLessThanOrEqual(l.height);
    }
    for (const e of l.edges) for (const p of e.points) expect(p.x <= l.width && p.y <= l.height && p.x >= 0 && p.y >= 0).toBe(true);
  });

  it('is deterministic and handles an empty plan', () => {
    const input = { targets: [{ item: 'plate', rate: 60 }, { item: 'glow', rate: 2 }] };
    expect(layoutDiagram(planSteps(input))).toEqual(layoutDiagram(planSteps(input)));
    expect(layoutDiagram([])).toEqual({ nodes: [], edges: [], columns: 0, width: 0, height: 0 });
  });

  it('packs positions in order with minimum distances, as close to the wanted ones as possible', () => {
    expect(pack([0, 100], [0, 10])).toEqual([0, 100]);
    expect(pack([0, 0, 0], [0, 10, 10])).toEqual([-10, 0, 10]);
    expect(pack([50, 0], [0, 10])).toEqual([20, 30]);
  });
});
