import { plan, type PlanInput, type PlanSettings } from '../../src/shared/planner.js';
import { indexRecipes } from '../../src/shared/recipes.js';
import {
  DIAGRAM_DEFAULTS, diagramLinks, diagramRows, layoutDiagram, pack, type DiagramLayout, type DiagramStep, type Point,
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
const row = (l: DiagramLayout, r: number) => l.nodes.filter(n => n.row === r).map(n => n.item);
/** The rectangle a label may take. */
const labelBox = (e: DiagramLayout['edges'][number]) => ({
  left: e.label.x - e.label.width / 2, right: e.label.x + e.label.width / 2,
  top: e.label.y - DIAGRAM_DEFAULTS.labelHeight / 2, bottom: e.label.y + DIAGRAM_DEFAULTS.labelHeight / 2,
});

describe('planner diagram layout', () => {
  it('puts extraction in the top row, what is made from it below and the wanted items at the bottom', () => {
    const steps = planSteps({ targets: [{ item: 'plate', rate: 30 }], choices: { plate: { kind: 'recipe', recipe: 'R_PlateAlt' } } });
    expect(steps.find(s => s.item === 'water')!.depth).toBe(1);
    // Water is extracted: it joins the ore in the top row, not the ingot.
    expect(Object.fromEntries(diagramRows(steps))).toEqual({ plate: 2, ingot: 1, water: 0, ore: 0 });
    const l = layoutDiagram(steps);
    expect(l.rows).toBe(3);
    expect(node(l, 'ore').y).toBeLessThan(node(l, 'ingot').y);
    expect(node(l, 'ingot').y).toBeLessThan(node(l, 'plate').y);
    expect(node(l, 'water').y).toBe(node(l, 'ore').y);
    // A wanted item nothing else uses stays with the wanted items, extracted or not.
    expect(Object.fromEntries(diagramRows(planSteps({ targets: [{ item: 'ore', rate: 60 }] })))).toEqual({ ore: 0 });
    expect(Object.fromEntries(diagramRows(planSteps({ targets: [{ item: 'ingot', rate: 30 }, { item: 'water', rate: 60 }] }))))
      .toEqual({ ingot: 1, ore: 0, water: 1 });
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

  it('points the edges down, from the bottom of the producer into the top of the consumer', () => {
    const l = layoutDiagram(planSteps({ targets: [{ item: 'plate', rate: 60 }] }));
    for (const [from, to] of [['ore', 'ingot'], ['ingot', 'plate']] as const) {
      const e = edge(l, from, to);
      const [a, b] = [node(l, from), node(l, to)];
      expect(e.points[0]).toEqual({ x: expect.any(Number), y: a.y + a.height });
      expect(e.points.at(-1)).toEqual({ x: expect.any(Number), y: b.y });
      // The last piece is straight down; the label sits on it, above the arrowhead.
      const [p, q] = e.points.slice(-2) as [Point, Point];
      expect(p.x).toBe(q.x);
      expect(p.y).toBeLessThan(q.y);
      expect(e.label.x).toBe(q.x);
      expect(labelBox(e).bottom).toBeLessThan(b.y);
      expect(labelBox(e).top).toBeGreaterThan(a.y + a.height);
      expect(e.path).toMatch(/^M.* L/);
    }
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

  it('points a by-product for a step further up into the bottom of that step', () => {
    const l = layoutDiagram(planSteps({
      targets: [{ item: 'plastic', rate: 60 }, { item: 'fuel', rate: 4 }], choices: { fuel: { kind: 'recipe', recipe: 'R_ResFuel' } },
    }));
    const [plastic, residue] = [node(l, 'plastic'), node(l, 'residue')];
    expect(residue.row).toBeLessThan(plastic.row);
    const e = edge(l, 'plastic', 'residue');
    expect(e.points[0]!.y).toBe(plastic.y);
    expect(e.points.at(-1)!.y).toBe(residue.y + residue.height);
    expect(labelBox(e).top).toBeGreaterThan(residue.y + residue.height);
  });

  it('draws a loop inside its row as an arc above it, ending at the arrowhead', () => {
    const l = layoutDiagram(planSteps({
      targets: [{ item: 'rubber', rate: 60 }],
      choices: { rubber: { kind: 'recipe', recipe: 'R_RecRubber' }, plastic: { kind: 'recipe', recipe: 'R_RecPlastic' } },
    }));
    const rubber = node(l, 'rubber');
    expect(node(l, 'plastic').row).toBe(rubber.row);
    const e = edge(l, 'plastic', 'rubber');
    expect(e.points.at(-1)!.y).toBe(rubber.y);
    expect(Math.max(...e.points.map(p => p.y))).toBe(rubber.y);
    expect(e.label.y).toBeLessThan(rubber.y);
    expect(e.path).toMatch(/^M.* C.* L/);
  });

  it('orders a row by the nodes using it, so edges do not cross', () => {
    const steps = [step('A', 0, [['Y', 1]]), step('B', 0, [['X', 1]]), step('X', 1), step('Y', 1)];
    const l = layoutDiagram(steps);
    expect(row(l, 1)).toEqual(['A', 'B']);
    expect(row(l, 0)).toEqual(['Y', 'X']);
    // Straight down: each input above its consumer.
    expect(node(l, 'Y').x).toBe(node(l, 'A').x);
    expect(node(l, 'X').x).toBe(node(l, 'B').x);
  });

  it('routes an edge spanning rows between the nodes there, with the label above its consumer', () => {
    const steps = [step('T', 0, [['A', 1], ['R', 2]]), step('A', 1, [['B', 1]]), step('B', 2, [['R', 1]]), step('R', 3)];
    const l = layoutDiagram(steps);
    const t = node(l, 'T');
    const r = node(l, 'R');
    const e = edge(l, 'R', 'T');
    expect(e.points[0]).toEqual({ x: expect.any(Number), y: r.y + r.height });
    expect(e.points.at(-1)!.y).toBe(t.y);
    expect(labelBox(e).bottom).toBeLessThan(t.y);
    // Where it passes the rows of A and B, it stays clear of them.
    for (const n of [node(l, 'A'), node(l, 'B')]) {
      for (const p of e.points.filter(q => q.y >= n.y && q.y <= n.y + n.height)) {
        expect(p.x < n.x || p.x > n.x + n.width).toBe(true);
      }
    }
  });

  it('staggers the labels of several edges into one node so they do not overlap', () => {
    const steps = [step('T', 0, [['A', 1], ['B', 2], ['C', 3], ['D', 4]]), step('A', 1), step('B', 1), step('C', 1), step('D', 1)];
    const l = layoutDiagram(steps);
    const t = node(l, 'T');
    const into = l.edges.filter(e => e.to === 'T');
    expect(new Set(into.map(e => e.points.at(-1)!.x)).size).toBe(4);
    for (const e of into) {
      expect(e.points.at(-1)!.x).toBeGreaterThan(t.x);
      expect(e.points.at(-1)!.x).toBeLessThan(t.x + t.width);
      expect(labelBox(e).bottom).toBeLessThan(t.y);
    }
    for (let i = 0; i < into.length; i++) {
      for (let j = i + 1; j < into.length; j++) {
        const [a, b] = [labelBox(into[i]!), labelBox(into[j]!)];
        const overlap = a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
        expect(overlap).toBe(false);
      }
    }
    // The rows move apart to make room for the labels.
    expect(t.y - (node(l, 'A').y + node(l, 'A').height)).toBeGreaterThan(DIAGRAM_DEFAULTS.rowGap + 2 * DIAGRAM_DEFAULTS.labelHeight);
  });

  it('keeps the nodes of a row apart and everything inside the drawing', () => {
    const l = layoutDiagram(planSteps({
      targets: [{ item: 'plate', rate: 60 }, { item: 'rubber', rate: 30 }, { item: 'glow', rate: 1 }],
      choices: { plate: { kind: 'recipe', recipe: 'R_PlateAlt' }, rubber: { kind: 'recipe', recipe: 'R_RecRubber' }, plastic: { kind: 'recipe', recipe: 'R_RecPlastic' } },
    }));
    for (let r = 0; r < l.rows; r++) {
      const ns = l.nodes.filter(n => n.row === r);
      ns.forEach((n, i) => {
        expect(n.order).toBe(i);
        if (i > 0) expect(n.x).toBeGreaterThanOrEqual(ns[i - 1]!.x + ns[i - 1]!.width + DIAGRAM_DEFAULTS.columnGap - 1e-6);
      });
    }
    // Listed by row from the top.
    expect(l.nodes.map(n => n.row)).toEqual([...l.nodes.map(n => n.row)].sort((a, b) => a - b));
    for (const n of l.nodes) {
      expect(n.x).toBeGreaterThanOrEqual(0);
      expect(n.y).toBeGreaterThanOrEqual(0);
      expect(n.x + n.width).toBeLessThanOrEqual(l.width);
      expect(n.y + n.height).toBeLessThanOrEqual(l.height);
    }
    for (const e of l.edges) {
      for (const p of e.points) expect(p.x <= l.width && p.y <= l.height && p.x >= 0 && p.y >= 0).toBe(true);
      const b = labelBox(e);
      expect(b.left >= 0 && b.top >= 0 && b.right <= l.width && b.bottom <= l.height).toBe(true);
    }
  });

  it('makes a row as high as its tallest node, so the edges start and end on one line', () => {
    const steps = [step('T', 0, [['A', 1], ['B', 1]]), step('A', 1), step('B', 1)];
    const plain = layoutDiagram(steps);
    expect(plain.nodes.map(n => n.height)).toEqual([DIAGRAM_DEFAULTS.nodeHeight, DIAGRAM_DEFAULTS.nodeHeight, DIAGRAM_DEFAULTS.nodeHeight]);
    const l = layoutDiagram(steps, { heights: new Map([['A', 100], ['T', 60]]) });
    const [a, b, t] = [node(l, 'A'), node(l, 'B'), node(l, 'T')];
    // B has no measured height: the row's tallest counts for both.
    expect([a.height, b.height, t.height]).toEqual([100, 100, 60]);
    expect(t.y - (a.y + a.height)).toBe(plain.nodes.find(n => n.item === 'T')!.y - (node(plain, 'A').y + DIAGRAM_DEFAULTS.nodeHeight));
    for (const e of l.edges) {
      expect(e.points[0]!.y).toBe(a.y + 100);
      expect(e.points.at(-1)!.y).toBe(t.y);
    }
    expect(l.height).toBe(Math.ceil(t.y + 60 + DIAGRAM_DEFAULTS.padding));
  });

  it('is deterministic and handles an empty plan', () => {
    const input = { targets: [{ item: 'plate', rate: 60 }, { item: 'glow', rate: 2 }] };
    expect(layoutDiagram(planSteps(input))).toEqual(layoutDiagram(planSteps(input)));
    expect(layoutDiagram([])).toEqual({ nodes: [], edges: [], rows: 0, width: 0, height: 0 });
  });

  it('packs positions in order with minimum distances, as close to the wanted ones as possible', () => {
    expect(pack([0, 100], [0, 10])).toEqual([0, 100]);
    expect(pack([0, 0, 0], [0, 10, 10])).toEqual([-10, 0, 10]);
    expect(pack([50, 0], [0, 10])).toEqual([20, 30]);
  });
});
