import type { LineGroup, ProductionLine } from '../../src/shared/factory/lines.js';
import {
  bottleneckOf, compactLine, groupsTopDown, machinesOnly, passesThrough, isSaturated, lineGraph, linePath, loadOf, LOGISTICS_WIDTH, NODE_WIDTH,
} from '../../src/web/features/factory/lineDiagram.js';
import { layoutGraph } from '../../src/web/features/planner/diagramLayout.js';
import { IRON_LINE } from '../web/lineFixtures.js';

const g = (id: string, stage: number, extra: Partial<LineGroup> = {}): LineGroup => ({
  id, cls: 'Build_ConstructorMk1_C', members: [id], stage, outputs: [], inputs: [], nominal: [], productivity: 1, state: 'full', reasons: [], ...extra,
});
const line = (groups: LineGroup[], edges: ProductionLine['edges']): Pick<ProductionLine, 'groups' | 'edges'> => ({ groups, edges });

describe('production line diagram', () => {
  it('puts each group in the row of its stage, without empty rows', () => {
    const graph = lineGraph(line([g('a', 0), g('b', 2), g('c', 5), g('d', 2)], []));
    expect(Object.fromEntries(graph.rows)).toEqual({ a: 0, b: 1, c: 2, d: 1 });
    expect(graph.nodes.map(n => n.width)).toEqual([NODE_WIDTH, NODE_WIDTH, NODE_WIDTH, NODE_WIDTH]);
    expect(groupsTopDown(line([g('c', 5), g('a', 0), g('b', 2)], [])).map(x => x.id)).toEqual(['a', 'b', 'c']);
  });

  it('tells flow, by-products and loops apart and leaves out edges it cannot draw', () => {
    const refinery = g('r', 1, { outputs: [{ item: 'Desc_Plastic_C', perMin: 20 }, { item: 'Desc_HeavyOilResidue_C', perMin: 10 }] });
    const graph = lineGraph(line([g('a', 0), refinery, g('b', 2), g('c', 2)], [
      { from: 'a', to: 'r', item: 'Desc_LiquidOil_C', links: 1, via: [] },
      { from: 'r', to: 'b', item: 'Desc_Plastic_C', links: 1, via: [] },
      { from: 'r', to: 'c', item: 'Desc_HeavyOilResidue_C', links: 1, via: [] },
      { from: 'b', to: 'r', item: 'Desc_Plastic_C', links: 1, via: [] },
      { from: 'b', to: 'c', item: 'Desc_Plastic_C', links: 1, via: [] },
      { from: 'x', to: 'b', links: 1, via: [] },
      { from: 'b', to: 'b', links: 1, via: [] },
    ]));
    expect(graph.links.map(l => `${l.from}>${l.to}:${l.kind}#${l.edge}`)).toEqual([
      'a>r:flow#0', 'r>b:flow#1', 'r>c:byproduct#2', 'b>r:loop#3', 'b>c:loop#4',
    ]);
  });

  it('lays a line out with narrow logistics nodes, every edge down the rows', () => {
    const graph = lineGraph(IRON_LINE);
    expect(graph.nodes.find(n => n.id === 'g-merge')!.width).toBe(LOGISTICS_WIDTH);
    const l = layoutGraph(graph.nodes, graph.links);
    expect(l.rows).toBe(4);
    const box = (id: string) => l.nodes.find(n => n.item === id)!;
    expect(box('g-merge').width).toBe(LOGISTICS_WIDTH);
    expect(box('g-plate').width).toBe(NODE_WIDTH);
    for (const e of l.edges) {
      const from = box(e.from);
      const to = box(e.to);
      expect(e.points[0]!.y).toBeCloseTo(from.y + from.height);
      expect(e.points.at(-1)!.y).toBeCloseTo(to.y);
      // Each end on its node's side.
      expect(e.points[0]!.x).toBeGreaterThanOrEqual(from.x);
      expect(e.points[0]!.x).toBeLessThanOrEqual(from.x + from.width);
    }
    // The edge index survives the layout, so the page finds the line's edge again.
    expect(l.edges.map(e => e.edge).sort()).toEqual([0, 1, 2, 3]);
  });

  it('folds pumps and other pass-through logistics with one way in and out into one edge', () => {
    const pump = (id: string, stage: number) => g(id, stage, { cls: 'Build_PipelinePump_C', logistics: true });
    const full: ProductionLine = {
      id: 'r', products: [], inputs: [], buildings: [], machines: [], productivity: 1, nominal: 0, actual: 0,
      groups: [g('oil', 0), pump('p1', 1), pump('p2', 2), g('r', 3), g('j', 1, { cls: 'Build_PipelineJunction_Cross_C', logistics: true }), g('x', 2), g('y', 2)],
      edges: [
        { from: 'oil', to: 'p1', item: 'Desc_LiquidOil_C', perMin: 300, capacity: 600, slowest: 'Build_PipelineMK2_C', links: 1, via: ['a'] },
        { from: 'p1', to: 'p2', item: 'Desc_LiquidOil_C', perMin: 300, capacity: 300, slowest: 'Build_Pipeline_C', links: 1, via: ['b'], saturated: true },
        { from: 'p2', to: 'r', item: 'Desc_LiquidOil_C', perMin: 290, capacity: 600, slowest: 'Build_PipelineMK2_C', links: 1, via: ['c'] },
        // A junction that branches stays.
        { from: 'oil', to: 'j', item: 'Desc_LiquidOil_C', links: 1, via: [] },
        { from: 'j', to: 'x', item: 'Desc_LiquidOil_C', links: 1, via: [] },
        { from: 'j', to: 'y', item: 'Desc_LiquidOil_C', links: 1, via: [] },
      ],
      bottleneck: { kind: 'edge', edge: 1, why: 'capacity' },
    };
    const { line: c, hidden } = compactLine(full);
    expect(hidden).toBe(2);
    expect(c.groups.map(x => x.id)).toEqual(['oil', 'r', 'j', 'x', 'y']);
    const merged = c.edges.find(e => e.from === 'oil' && e.to === 'r')!;
    expect(merged).toMatchObject({ perMin: 290, capacity: 300, slowest: 'Build_Pipeline_C', saturated: true, via: ['a', 'b', 'c'] });
    expect(c.bottleneck).toEqual({ kind: 'edge', edge: c.edges.indexOf(merged), why: 'capacity' });
    expect(compactLine(IRON_LINE)).toEqual({ line: IRON_LINE, hidden: 0 });
  });

  it('shows only the machines: flows over manifolds go from each maker, split by what it makes', () => {
    const m = machinesOnly(IRON_LINE);
    expect(m.groups.map(x => x.id)).toEqual(['g-smelt', 'g-plate', 'g-box']);
    expect(m.edges.map(e => `${e.from}>${e.to}:${e.perMin}/${e.capacity}`)).toEqual(['g-smelt>g-plate:30/120', 'g-plate>g-box:20/60', 'g-smelt>g-box:0/60']);
    // The bottleneck was the belt into the merger, which is gone.
    expect(m.bottleneck).toBeUndefined();
    // Two makers behind one merger share the flow by what they make; a kind decides over the class.
    const two: ProductionLine = {
      ...IRON_LINE,
      groups: [g('a', 0, { outputs: [{ item: 'X', perMin: 30 }] }), g('b', 0, { outputs: [{ item: 'X', perMin: 10 }] }),
        g('m', 1, { cls: 'merger', kind: 'merger', logistics: true }), g('c', 2)],
      edges: [
        { from: 'a', to: 'm', item: 'X', perMin: 30, links: 1, via: [] }, { from: 'b', to: 'm', item: 'X', perMin: 10, links: 1, via: [] },
        { from: 'm', to: 'c', item: 'X', perMin: 40, capacity: 60, links: 1, via: [] },
      ],
      bottleneck: { kind: 'group', group: 'c', why: 'starved' },
    };
    const t = machinesOnly(two);
    expect(t.edges.map(e => `${e.from}>${e.to}:${e.perMin}`)).toEqual(['a>c:30', 'b>c:10']);
    expect(t.bottleneck).toEqual({ kind: 'group', group: 'c', why: 'starved' });
    // A buffer between two machines goes too; a storage at the end stays.
    const buffered = machinesOnly({
      ...IRON_LINE,
      groups: [g('a', 0, { outputs: [{ item: 'W', perMin: 50 }] }), g('t', 1, { cls: 'Build_PipeStorageTank_C', kind: 'tank', logistics: true }), g('c', 2)],
      edges: [{ from: 'a', to: 't', item: 'W', perMin: 50, links: 1, via: [] }, { from: 't', to: 'c', item: 'W', perMin: 45, links: 1, via: [] }],
    });
    expect(buffered.groups.map(x => x.id)).toEqual(['a', 'c']);
    expect(buffered.edges.map(e => `${e.from}>${e.to}:${e.perMin}`)).toEqual(['a>c:45']);
    expect(passesThrough({ logistics: true, cls: 'Build_StorageContainerMk1_C', kind: 'splitter' })).toBe(true);
    expect(passesThrough({ logistics: true, cls: 'Build_ConveyorAttachmentSplitter_C' })).toBe(true);
    expect(passesThrough({ logistics: true, cls: 'Build_StorageContainerMk1_C' })).toBe(false);
  });

  it('measures load, saturation and the bottleneck', () => {
    expect(loadOf({ perMin: 60, capacity: 120 })).toBe(0.5);
    expect(loadOf({ perMin: 60 })).toBeNull();
    expect(isSaturated({ perMin: 115, capacity: 120 })).toBe(true);
    expect(isSaturated({ perMin: 100, capacity: 120 })).toBe(false);
    // The line's own flag wins.
    expect(isSaturated({ perMin: 100, capacity: 120, saturated: true })).toBe(true);
    expect(bottleneckOf(IRON_LINE)).toEqual({ edge: IRON_LINE.edges[0], edgeIndex: 0 });
    expect(bottleneckOf({ edges: [], bottleneck: { kind: 'group', group: 'g', why: 'starved' } })).toEqual({ group: 'g' });
    expect(bottleneckOf({ edges: [] })).toEqual({});
  });

  it('links to a line on the factory page', () => {
    expect(linePath('w1', 'Build_A_C 2/3')).toBe('/w/w1/factory?line=Build_A_C%202%2F3');
  });
});
