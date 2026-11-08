import { analyzeFactory, type AnalysisData } from '../../src/shared/factory/analysis.js';
import { itemCause } from '../../src/shared/factory/analysis.js';
import {
  buildLines, causeContext, layer, lineHasIssue, lineLoss, mergeHints, sortLines, SPLIT_ABOVE, stationConsumers, type ProductionLine,
} from '../../src/shared/factory/lines.js';
import type { FactorySnapshot, SnapshotBuilding, SnapshotLink, SnapshotProduction } from '../../src/shared/factory/snapshot.js';
import type { MachineEntry } from '../../src/shared/machines.js';
import { indexRecipes, type RecipeData } from '../../src/shared/recipes.js';

// Numbers as in the game's 1.2 data (recipes.json / machines.json), trimmed to what the tests use.
const RECIPES: RecipeData = {
  format: 1, source: 'test', clock: { min: 0.01, perShard: 0.5 },
  items: [
    { id: 'Desc_OreIron_C', name: { en: 'Iron Ore', de: 'Eisenerz' }, form: 'solid' },
    { id: 'Desc_IronIngot_C', name: { en: 'Iron Ingot', de: 'Eisenbarren' }, form: 'solid' },
    { id: 'Desc_IronPlate_C', name: { en: 'Iron Plate', de: 'Eisenplatte' }, form: 'solid' },
    { id: 'Desc_Coal_C', name: { en: 'Coal', de: 'Kohle' }, form: 'solid' },
    { id: 'Desc_Water_C', name: { en: 'Water', de: 'Wasser' }, form: 'liquid' },
    { id: 'Desc_IronScrew_C', name: { en: 'Screws', de: 'Schrauben' }, form: 'solid' },
    { id: 'Desc_IronPlateReinforced_C', name: { en: 'Reinforced Iron Plate', de: 'Verstärkte Eisenplatte' }, form: 'solid' },
  ],
  recipes: [
    { id: 'Recipe_IngotIron_C', name: { en: 'Iron Ingot', de: 'Eisenbarren' }, alternate: false, machine: 'Build_SmelterMk1_C', duration: 2,
      ingredients: [{ item: 'Desc_OreIron_C', amount: 1 }], products: [{ item: 'Desc_IronIngot_C', amount: 1 }] },
    { id: 'Recipe_IronPlate_C', name: { en: 'Iron Plate', de: 'Eisenplatte' }, alternate: false, machine: 'Build_ConstructorMk1_C', duration: 6,
      ingredients: [{ item: 'Desc_IronIngot_C', amount: 3 }], products: [{ item: 'Desc_IronPlate_C', amount: 2 }] },
    { id: 'Recipe_IronPlateReinforced_C', name: { en: 'Reinforced Iron Plate', de: 'Verstärkte Eisenplatte' }, alternate: false, machine: 'Build_AssemblerMk1_C', duration: 12,
      ingredients: [{ item: 'Desc_IronPlate_C', amount: 6 }, { item: 'Desc_IronScrew_C', amount: 12 }], products: [{ item: 'Desc_IronPlateReinforced_C', amount: 1 }] },
  ],
  machines: [
    { id: 'Build_SmelterMk1_C', name: { en: 'Smelter', de: 'Schmelzofen' }, power: 4, powerExponent: 1.321929 },
    { id: 'Build_ConstructorMk1_C', name: { en: 'Constructor', de: 'Konstruktor' }, power: 4, powerExponent: 1.321929 },
    { id: 'Build_AssemblerMk1_C', name: { en: 'Assembler', de: 'Fabrikator' }, power: 15, powerExponent: 1.321929 },
  ],
  extractors: [
    { id: 'Build_MinerMk1_C', name: { en: 'Miner Mk.1', de: 'Miner Mk.1' }, kind: 'miner', tier: 1, rate: 60, power: 5, powerExponent: 1.321929, resources: ['Desc_OreIron_C'], onNode: true },
    { id: 'Build_WaterPump_C', name: { en: 'Water Extractor', de: 'Wasserpumpe' }, kind: 'pump', rate: 120, power: 20, powerExponent: 1.321929, resources: ['Desc_Water_C'], onNode: false },
  ],
  belts: [
    { id: 'Build_ConveyorBeltMk1_C', name: { en: 'Conveyor Belt Mk.1', de: 'Förderband Mk.1' }, kind: 'belt', rate: 60 },
    { id: 'Build_ConveyorBeltMk2_C', name: { en: 'Conveyor Belt Mk.2', de: 'Förderband Mk.2' }, kind: 'belt', rate: 120 },
  ],
  // Pipeline Mk.1: mFlowLimit 5 m³/s in the Docs.
  pipes: [{ id: 'Build_Pipeline_C', name: { en: 'Pipeline Mk.1', de: 'Pipeline Mk.1' }, rate: 300 }],
};

const entry = (id: string, category: MachineEntry['category'], stats: MachineEntry['stats']): MachineEntry => ({
  id, category, name: { en: id, de: id }, description: { en: '', de: '' }, wikiPage: id, stats, unlockedBy: [],
});

const DATA: AnalysisData = {
  recipes: indexRecipes(RECIPES),
  machines: new Map([
    ['Build_GeneratorCoal_C', entry('Build_GeneratorCoal_C', 'power', { powerProduction: 75, fuels: [{ item: 'Desc_Coal_C', perMinute: 15, supplement: { item: 'Desc_Water_C', amount: 45 } }] })],
  ]),
  nodes: new Map([['Node_Pure', { kind: 'node', resource: 'Desc_OreIron_C', purity: 'pure' }], ['Node_Normal', { kind: 'node', resource: 'Desc_OreIron_C', purity: 'normal' }]]),
};

const at = { x: 0, y: 0, z: 0, yaw: 0 };
const node = (id: string): SnapshotBuilding => ({ id, cls: id.replace(/_\d+$/, ''), ...at });
const machine = (id: string, prod: Partial<SnapshotProduction>, extra: Partial<SnapshotBuilding> = {}): SnapshotBuilding =>
  ({ ...node(id), prod: { clock: 1, productivity: 1, producing: true, ...prod }, ...extra });
const miner = (id: string, prod: Partial<SnapshotProduction> = {}, nodeName = 'Node_Normal') => machine(id, prod, { node: nodeName });
const smelter = (id: string, prod: Partial<SnapshotProduction> = {}) => machine(id, { recipe: 'Recipe_IngotIron_C', ...prod });
const constructor = (id: string, prod: Partial<SnapshotProduction> = {}) => machine(id, { recipe: 'Recipe_IronPlate_C', ...prod });
const assembler = (id: string, prod: Partial<SnapshotProduction> = {}) => machine(id, { recipe: 'Recipe_IronPlateReinforced_C', ...prod });
const belt = (from: string, to: string, extra: Partial<SnapshotLink> = {}): SnapshotLink =>
  ({ from, to, kind: 'belt', via: [`Build_ConveyorBeltMk2_C_${from.split('_').pop()}${to.split('_').pop()}`], slowest: 'Build_ConveyorBeltMk2_C', ...extra });
const pipe = (from: string, to: string, extra: Partial<SnapshotLink> = {}): SnapshotLink =>
  ({ from, to, kind: 'pipe', via: [`Build_Pipeline_C_${from.split('_').pop()}${to.split('_').pop()}`], slowest: 'Build_Pipeline_C', ...extra });
const snapshot = (buildings: SnapshotBuilding[], links?: SnapshotLink[]): FactorySnapshot => ({
  v: 1, meta: { sessionName: 'Test', saveTime: 1, build: 1 }, buildings, lightweight: [], splines: [], powerLines: [], pathNetworks: [],
  stations: [], vehicles: [], markers: [], crates: [], ...(links ? { links } : {}),
});
const lines = (s: FactorySnapshot) => buildLines(s, analyzeFactory(s, DATA), DATA);
const groupWith = (line: ProductionLine, id: string) => line.groups.find(g => g.members.includes(id))!;
const edgeBetween = (line: ProductionLine, a: string, b: string) => line.edges.find(e => e.from === groupWith(line, a).id && e.to === groupWith(line, b).id)!;

describe('buildLines', () => {
  it('gives no lines without links', () => {
    expect(lines(snapshot([smelter('Build_SmelterMk1_C_1')])).lines).toEqual([]);
    expect(lines(snapshot([smelter('Build_SmelterMk1_C_1')], [])).index.size).toBe(0);
  });

  describe('a manifold line: miner → splitters → 2 smelters → mergers → constructor → storage', () => {
    const MI = 'Build_MinerMk1_C_1', S1 = 'Build_ConveyorAttachmentSplitter_C_2', S2 = 'Build_ConveyorAttachmentSplitter_C_3';
    const SM1 = 'Build_SmelterMk1_C_4', SM2 = 'Build_SmelterMk1_C_5', M1 = 'Build_ConveyorAttachmentMerger_C_6', M2 = 'Build_ConveyorAttachmentMerger_C_7';
    const C = 'Build_ConstructorMk1_C_8', BOX = 'Build_StorageContainerMk1_C_9';
    const s = snapshot(
      [miner(MI), node(S1), node(S2), smelter(SM1), smelter(SM2), node(M1), node(M2), constructor(C, { clock: 2 }), node(BOX)],
      [belt(MI, S1), belt(S1, SM1), belt(S1, S2), belt(S2, SM2), belt(SM1, M1), belt(SM2, M2), belt(M2, M1), belt(M1, C), belt(C, BOX)],
    );
    const { lines: list, index } = lines(s);
    const line = list[0]!;

    it('is one line named after its most downstream machine, with every building, belt and machine', () => {
      expect(list).toHaveLength(1);
      expect(line.id).toBe(C);
      expect(line.buildings).toHaveLength(9);
      expect(line.machines.sort()).toEqual([C, MI, SM1, SM2].sort());
      expect(line.via).toHaveLength(9);
      for (const id of [...line.buildings, ...line.via!]) expect(index.get(id)).toBe(C);
    });

    it('merges linked splitters and linked mergers into one group each, parallel smelters into one, by stage', () => {
      expect(line.groups.map(g => [g.stage, g.members.length, g.logistics ? g.kind : g.cls])).toEqual([
        [0, 1, 'Build_MinerMk1_C'],
        [1, 2, 'splitter'],
        [2, 2, 'Build_SmelterMk1_C'],
        [3, 2, 'merger'],
        [4, 1, 'Build_ConstructorMk1_C'],
        [5, 1, 'storage'],
      ]);
      const smelters = groupWith(line, SM1);
      expect(smelters).toMatchObject({ recipe: 'Recipe_IngotIron_C', productivity: 1, state: 'full', band: 'full', reasons: [] });
      expect(smelters.outputs).toEqual([{ item: 'Desc_IronIngot_C', perMin: 60 }]);
      expect(smelters.inputs).toEqual([{ item: 'Desc_OreIron_C', perMin: 60 }]);
      expect(groupWith(line, S1)).toMatchObject({ cls: 'Build_ConveyorAttachmentSplitter_C', logistics: true, kind: 'splitter', state: 'full' });
    });

    it('aggregates links between groups with flow, capacity and the belts on the way; internal links are left out', () => {
      expect(line.edges).toHaveLength(5);
      expect(edgeBetween(line, MI, S1)).toMatchObject({ item: 'Desc_OreIron_C', perMin: 60, capacity: 120, links: 1, slowest: 'Build_ConveyorBeltMk2_C' });
      expect(edgeBetween(line, S1, SM1)).toMatchObject({ item: 'Desc_OreIron_C', perMin: 60, capacity: 240, links: 2 });
      expect(edgeBetween(line, SM1, M1)).toMatchObject({ perMin: 60, links: 2 });
      expect(edgeBetween(line, M1, C)).toMatchObject({ item: 'Desc_IronIngot_C', perMin: 60, capacity: 120 });
      expect(edgeBetween(line, C, BOX)).toMatchObject({ item: 'Desc_IronPlate_C', perMin: 40 });
      expect(line.edges.some(e => e.saturated)).toBe(false);
    });

    it('products, inputs, productivity and output; no bottleneck when everything runs', () => {
      expect(line.products).toEqual([{ item: 'Desc_IronPlate_C', perMin: 40 }]);
      expect(line.inputs).toEqual([]);
      expect(line.productivity).toBe(1);
      expect(line.actual).toBeCloseTo(40);
      expect(line.nominal).toBeCloseTo(40);
      expect(line.bottleneck).toBeUndefined();
    });
  });

  it('serves consumers before storage: a splitter sends what the smelter takes to it and the rest to the sink', () => {
    const MI = 'Build_MinerMk1_C_1', S = 'Build_ConveyorAttachmentSplitter_C_2', SM = 'Build_SmelterMk1_C_3', SINK = 'Build_ResourceSink_C_4';
    const s = snapshot([miner(MI, {}, 'Node_Pure'), node(S), smelter(SM, { productivity: 0.5 }), node(SINK)], [belt(MI, S), belt(S, SM), belt(S, SINK)]);
    const line = lines(s).lines[0]!;
    expect(edgeBetween(line, S, SM).perMin).toBeCloseTo(15); // 30/min × 50 %
    expect(edgeBetween(line, S, SINK).perMin).toBeCloseTo(105); // 120 − 15
    // The smelter's ingots go nowhere (no belt at its output): they count as made by the line too.
    expect(line.products).toEqual([{ item: 'Desc_OreIron_C', perMin: 105 }, { item: 'Desc_IronIngot_C', perMin: 15 }]);
  });

  it('a belt too slow: saturated edge, starving smelters, the miner backs up → the edge is the bottleneck', () => {
    const MI = 'Build_MinerMk1_C_1', S = 'Build_ConveyorAttachmentSplitter_C_2';
    const sms = [3, 4, 5, 6].map(n => `Build_SmelterMk1_C_${n}`);
    const s = snapshot(
      [miner(MI, { productivity: 0.5, issues: ['blocked'] }, 'Node_Pure'), node(S), ...sms.map(id => smelter(id, { productivity: 0.5, issues: ['starved'] }))],
      [belt(MI, S, { slowest: 'Build_ConveyorBeltMk1_C', via: ['Build_ConveyorBeltMk1_C_9'] }), ...sms.map(id => belt(S, id))],
    );
    const line = lines(s).lines[0]!;
    const edge = edgeBetween(line, MI, S);
    expect(edge).toMatchObject({ perMin: 60, capacity: 60, saturated: true, slowest: 'Build_ConveyorBeltMk1_C' });
    expect(line.bottleneck).toEqual({ kind: 'edge', edge: line.edges.indexOf(edge), why: 'capacity' });
  });

  it('a saturated belt is no bottleneck when the machines before it do not back up', () => {
    const MI = 'Build_MinerMk1_C_1', SM = 'Build_SmelterMk1_C_2', SM2 = 'Build_SmelterMk1_C_3', S = 'Build_ConveyorAttachmentSplitter_C_4';
    const s = snapshot(
      [miner(MI), node(S), smelter(SM, { productivity: 1 }), smelter(SM2, { productivity: 0, issues: ['starved'] })],
      [belt(MI, S, { slowest: 'Build_ConveyorBeltMk1_C' }), belt(S, SM), belt(S, SM2)],
    );
    expect(lines(s).lines[0]!.bottleneck).toMatchObject({ kind: 'group', group: SM, why: 'starved', short: { item: 'Desc_OreIron_C', makers: 1, extractors: true } });
  });

  it('backing up to the end: smelters and constructor blocked, the plates go nowhere → demand at the end', () => {
    const SM = 'Build_SmelterMk1_C_1', C = 'Build_ConstructorMk1_C_2', MI = 'Build_MinerMk1_C_3';
    const s = snapshot(
      [miner(MI, { productivity: 0.5, issues: ['blocked'] }), smelter(SM, { productivity: 0.5, issues: ['blocked'] }), constructor(C, { productivity: 0.4, issues: ['blocked'] })],
      [belt(MI, SM), belt(SM, C)],
    );
    const line = lines(s).lines[0]!;
    expect(line.bottleneck).toEqual({ kind: 'group', group: C, why: 'demand' });
    // Made but taken by no link: the plates count as products ("nowhere").
    expect(line.products.map(p => p.item)).toEqual(['Desc_IronPlate_C']);
  });

  it('a group that backs up because the next one lacks something else: the next one with its reason', () => {
    const SM = 'Build_SmelterMk1_C_1', C = 'Build_ConstructorMk1_C_2', BOX = 'Build_StorageContainerMk1_C_3';
    const s = snapshot(
      [smelter(SM, { productivity: 0.2, issues: ['blocked'] }), constructor(C, { productivity: 0.5, issues: ['noPower'] }), node(BOX)],
      [belt(SM, C), belt(C, BOX)],
    );
    expect(lines(s).lines[0]!.bottleneck).toEqual({ kind: 'group', group: C, why: 'noPower' });
  });

  it('a loop (overflow back to the merger) does not hang and keeps stages finite', () => {
    const MI = 'Build_MinerMk1_C_1', M = 'Build_ConveyorAttachmentMerger_C_2', S = 'Build_ConveyorAttachmentSplitter_C_3', SM = 'Build_SmelterMk1_C_4';
    const s = snapshot([miner(MI), node(M), node(S), smelter(SM, { productivity: 1 })], [belt(MI, M), belt(M, S), belt(S, SM), belt(S, M)]);
    const line = lines(s).lines[0]!;
    expect(line.groups.map(g => [g.members[0], g.stage])).toEqual([[MI, 0], [M, 1], [S, 2], [SM, 3]]);
    expect(edgeBetween(line, S, SM).perMin).toBeCloseTo(30);
    expect(line.edges).toHaveLength(4);
  });

  it('pipes: junctions form one group, fluids flow by pipe and solids by belt; a storage feeding a line is an input', () => {
    const W = 'Build_WaterPump_C_1', J1 = 'Build_PipelineJunction_Cross_C_2', J2 = 'Build_PipelineJunction_Cross_C_3';
    const G1 = 'Build_GeneratorCoal_C_4', G2 = 'Build_GeneratorCoal_C_5', BOX = 'Build_StorageContainerMk1_C_6', S = 'Build_ConveyorAttachmentSplitter_C_7';
    const s = snapshot(
      [machine(W, { productivity: 0.75, issues: ['blocked'] }), node(J1), node(J2), machine(G1, {}), machine(G2, {}), node(BOX), node(S)],
      [pipe(W, J1, { fluid: 'Desc_Water_C' }), pipe(J1, J2), pipe(J1, G1), pipe(J2, G2), belt(BOX, S, { items: { Desc_Coal_C: 3 } }), belt(S, G1), belt(S, G2)],
    );
    const line = lines(s).lines[0]!;
    expect(line.machines.sort()).toEqual([G1, G2, W]);
    const junctions = groupWith(line, J1);
    expect(junctions).toMatchObject({ kind: 'junction', members: [J1, J2], cls: 'Build_PipelineJunction_Cross_C' });
    const gens = groupWith(line, G1);
    expect(gens.members).toEqual([G1, G2]);
    expect(gens.inputs).toEqual([{ item: 'Desc_Water_C', perMin: 90, fluid: true }, { item: 'Desc_Coal_C', perMin: 30 }]);
    const water = edgeBetween(line, J1, G1);
    expect(water).toMatchObject({ item: 'Desc_Water_C', perMin: 90, links: 2 });
    expect(water).toMatchObject({ capacity: 600, perLink: 300, pipe: true }); // two Pipeline Mk.1, 300 m³/min each (Docs)
    expect(edgeBetween(line, W, J1).perMin).toBeCloseTo(90);
    expect(line.inputs).toEqual([{ item: 'Desc_Coal_C', perMin: 30 }]);
    expect(line.products).toEqual([]);
    expect(line.id).toBe(G1);
  });

  it('stations are always boundaries: a line into a station and one out of it are two lines; the station belongs to the feeding one', () => {
    const MI = 'Build_MinerMk1_C_1', ST = 'Build_TruckStation_C_2', SM = 'Build_SmelterMk1_C_3', BOX = 'Build_StorageContainerMk1_C_4';
    const s = snapshot([miner(MI), node(ST), smelter(SM, { productivity: 1 }), node(BOX)], [belt(MI, ST), belt(ST, SM), belt(SM, BOX)]);
    const { lines: list, index } = lines(s);
    expect(list.map(l => l.id).sort()).toEqual([MI, SM]);
    const into = list.find(l => l.id === MI)!, out = list.find(l => l.id === SM)!;
    expect(into.buildings).toEqual([MI, ST]);
    expect(out.buildings).toEqual([ST, BOX, SM].sort());
    expect(into.products).toEqual([{ item: 'Desc_OreIron_C', perMin: 60 }]);
    expect(out.inputs).toEqual([{ item: 'Desc_OreIron_C', perMin: 30 }]);
    expect(groupWith(out, ST)).toMatchObject({ stage: 0, kind: 'station' });
    expect(index.get(ST)).toBe(MI);
  });

  it(`a part with more than ${SPLIT_ABOVE} machines is cut at its storage containers; a smaller one is not`, () => {
    const build = (n: number) => {
      const MI = 'Build_MinerMk1_C_1', S = 'Build_ConveyorAttachmentSplitter_C_2', M = 'Build_ConveyorAttachmentMerger_C_3', BOX = 'Build_StorageContainerMk1_C_4';
      const S2 = 'Build_ConveyorAttachmentSplitter_C_5', M2 = 'Build_ConveyorAttachmentMerger_C_6', SINK = 'Build_ResourceSink_C_7';
      const sms = Array.from({ length: n }, (_, i) => `Build_SmelterMk1_C_${100 + i}`), cons = Array.from({ length: n }, (_, i) => `Build_ConstructorMk1_C_${200 + i}`);
      return snapshot(
        [miner(MI), node(S), node(M), node(BOX), node(S2), node(M2), node(SINK), ...sms.map(id => smelter(id)), ...cons.map(id => constructor(id))],
        [belt(MI, S), ...sms.flatMap(id => [belt(S, id), belt(id, M)]), belt(M, BOX), belt(BOX, S2), ...cons.flatMap(id => [belt(S2, id), belt(id, M2)]), belt(M2, SINK)],
      );
    };
    expect(lines(build(5)).lines).toHaveLength(1);
    const { lines: list, index } = lines(build(21));
    expect(list).toHaveLength(2);
    expect(list.map(l => l.machines.length)).toEqual([22, 21]);
    const [first, second] = list as [ProductionLine, ProductionLine];
    expect(first.buildings).toContain('Build_StorageContainerMk1_C_4');
    expect(second.buildings).toContain('Build_StorageContainerMk1_C_4');
    expect(index.get('Build_StorageContainerMk1_C_4')).toBe(first.id);
    expect(groupWith(second, 'Build_StorageContainerMk1_C_4').stage).toBe(0);
  });
});

describe('bottleneck rules (the same as the item chain)', () => {
  const ids = (n: number, cls: string, from = 1) => Array.from({ length: n }, (_, i) => `${cls}_${from + i}`);

  it('a jam is not handed to a group losing a small fraction of where it started: it ends in demand, as the item chain says (copper sheet)', () => {
    // 4 smelters back up (3.2 lost), 4 constructors back up (3.6), 1 assembler lacks screws, not plates (0.2).
    const MI = 'Build_MinerMk1_C_1', A = 'Build_AssemblerMk1_C_2';
    const sms = ids(4, 'Build_SmelterMk1_C', 10), cons = ids(4, 'Build_ConstructorMk1_C', 20);
    const s = snapshot(
      [miner(MI, { productivity: 0.3, issues: ['blocked'] }), ...sms.map(id => smelter(id, { productivity: 0.2, issues: ['blocked'] })),
        ...cons.map(id => constructor(id, { productivity: 0.1, issues: ['blocked'] })), assembler(A, { productivity: 0.8, issues: ['starved'] })],
      [...sms.map(id => belt(MI, id)), ...sms.flatMap(sm => cons.map(c => belt(sm, c))), ...cons.map(c => belt(c, A, { items: { Desc_IronPlate_C: 12 } }))],
    );
    const analysis = analyzeFactory(s, DATA);
    expect(analysis.byId.get(A)!.starvedFor).toEqual(['Desc_IronScrew_C']);
    const pl = buildLines(s, analysis, DATA);
    const line = pl.lines[0]!;
    expect(line.bottleneck).toEqual({ kind: 'group', group: groupWith(line, cons[0]!).id, why: 'demand' });
    expect(lineHasIssue(line)).toBe(false);
    const cause = itemCause(analysis, 'Desc_IronIngot_C', causeContext(pl, analysis));
    expect(cause.jamEnds).toEqual([{ item: 'Desc_IronPlate_C', why: 'demand', path: ['Desc_IronIngot_C', 'Desc_IronPlate_C'] }]);
  });

  it('a starved group names what it lacks: iron ore, 120 of 180 per minute, its miners at 100 %', () => {
    const sms = ids(6, 'Build_SmelterMk1_C', 10);
    const s = snapshot(
      [miner('Build_MinerMk1_C_1'), miner('Build_MinerMk1_C_2'), node('Build_ConveyorAttachmentMerger_C_3'),
        ...sms.map(id => smelter(id, { productivity: 2 / 3, issues: ['starved'] }))],
      [belt('Build_MinerMk1_C_1', 'Build_ConveyorAttachmentMerger_C_3'), belt('Build_MinerMk1_C_2', 'Build_ConveyorAttachmentMerger_C_3'),
        ...sms.map(id => belt('Build_ConveyorAttachmentMerger_C_3', id))],
    );
    const line = lines(s).lines[0]!;
    expect(line.bottleneck).toMatchObject({ kind: 'group', group: groupWith(line, sms[0]!).id, why: 'starved' });
    const short = line.bottleneck!.kind === 'group' ? line.bottleneck!.short! : undefined;
    expect(short).toMatchObject({ item: 'Desc_OreIron_C', need: 180, makers: 2, makersProductivity: 1, extractors: true });
    expect(short!.supply).toBeCloseTo(120);
    expect(lineHasIssue(line)).toBe(true);
  });

  it('a full shared belt (coal): rule (1) also when the machines after it run intermittently; the miners get "shared belt full"', () => {
    const M = 'Build_ConveyorAttachmentMerger_C_3';
    const sms = ids(4, 'Build_SmelterMk1_C', 10);
    const s = snapshot(
      [miner('Build_MinerMk1_C_1', { productivity: 0.75 }), miner('Build_MinerMk1_C_2', { productivity: 0.75 }), node(M),
        ...sms.map(id => smelter(id, { productivity: 0.5 }))],
      [belt('Build_MinerMk1_C_1', M), belt('Build_MinerMk1_C_2', M), belt(M, 'Build_ConveyorAttachmentSplitter_C_4', { slowest: 'Build_ConveyorBeltMk1_C' }),
        ...sms.map(id => belt('Build_ConveyorAttachmentSplitter_C_4', id))],
    );
    // The splitter is a building of the snapshot too.
    s.buildings.push(node('Build_ConveyorAttachmentSplitter_C_4'));
    const analysis = analyzeFactory(s, DATA);
    const pl = buildLines(s, analysis, DATA);
    const line = pl.lines[0]!;
    const full = edgeBetween(line, M, 'Build_ConveyorAttachmentSplitter_C_4');
    expect(full).toMatchObject({ perMin: 60, capacity: 60, saturated: true });
    expect(full.exact).toBeUndefined();
    expect(line.bottleneck).toEqual({ kind: 'edge', edge: line.edges.indexOf(full), why: 'capacity' });
    expect(mergeHints(analysis.byId.get('Build_MinerMk1_C_1')!, pl)).toContainEqual({ kind: 'sharedBeltFull', belt: 'Build_ConveyorBeltMk1_C', rate: 60 });
  });

  it('a full belt that carries exactly what its makers make is no fault ("full, just enough")', () => {
    const s = snapshot(
      // A miner on a pure node makes 120/min; the two Mk.1 belts on carry all of it.
      [miner('Build_MinerMk1_C_1', {}, 'Node_Pure'), node('Build_ConveyorAttachmentMerger_C_2'), smelter('Build_SmelterMk1_C_3'), smelter('Build_SmelterMk1_C_4')],
      [belt('Build_MinerMk1_C_1', 'Build_ConveyorAttachmentMerger_C_2'), belt('Build_ConveyorAttachmentMerger_C_2', 'Build_SmelterMk1_C_3', { slowest: 'Build_ConveyorBeltMk1_C' }),
        belt('Build_ConveyorAttachmentMerger_C_2', 'Build_SmelterMk1_C_4', { slowest: 'Build_ConveyorBeltMk1_C' })],
    );
    const analysis = analyzeFactory(s, DATA);
    const pl = buildLines(s, analysis, DATA);
    const edge = edgeBetween(pl.lines[0]!, 'Build_ConveyorAttachmentMerger_C_2', 'Build_SmelterMk1_C_3');
    expect(edge).toMatchObject({ saturated: true, exact: true, capacity: 120, perLink: 60, links: 2 });
    expect(pl.lines[0]!.bottleneck).toBeUndefined();
    expect(mergeHints(analysis.byId.get('Build_MinerMk1_C_1')!, pl)).toContainEqual({ kind: 'beltExact', belt: 'Build_ConveyorBeltMk1_C', rate: 60 });
  });

  it('a belt carrying next to nothing between a maker that backs up and a consumer starving for that item: check the connection', () => {
    const SM = 'Build_SmelterMk1_C_1', C = 'Build_ConstructorMk1_C_2';
    const s = snapshot(
      [smelter(SM, { productivity: 0.1, issues: ['blocked'] }), constructor(C, { productivity: 0.05, issues: ['starved'] }), node('Build_StorageContainerMk1_C_3')],
      [belt('Build_StorageContainerMk1_C_3', SM), belt(SM, C)],
    );
    const analysis = analyzeFactory(s, DATA);
    const pl = buildLines(s, analysis, DATA);
    const line = pl.lines[0]!;
    expect(line.bottleneck).toEqual({ kind: 'edge', edge: line.edges.indexOf(edgeBetween(line, SM, C)), why: 'connection' });
    expect(itemCause(analysis, 'Desc_IronIngot_C', causeContext(pl, analysis))).toMatchObject({ transportLimited: true, why: 'connection' });
  });

  it('pipes have their Docs capacity (Pipeline Mk.1: 300 m³/min)', () => {
    const W = 'Build_WaterPump_C_1', G = 'Build_GeneratorCoal_C_2';
    const s = snapshot([machine(W, {}), machine(G, {})], [pipe(W, G)]);
    expect(lines(s).lines[0]!.edges[0]).toMatchObject({ capacity: 300, pipe: true });
  });

  it('a merger passes on what comes in: its inflow equals its outflow even when the consumer behind needs less', () => {
    const M = 'Build_ConveyorAttachmentMerger_C_3', C = 'Build_ConstructorMk1_C_4';
    const s = snapshot(
      [smelter('Build_SmelterMk1_C_1'), smelter('Build_SmelterMk1_C_2'), node(M), constructor(C)],
      [belt('Build_SmelterMk1_C_1', M), belt('Build_SmelterMk1_C_2', M), belt(M, C)],
    );
    const g = groupWith(lines(s).lines[0]!, M);
    expect(g.inputs[0]!.perMin).toBeCloseTo(60);
    expect(g.outputs[0]!.perMin).toBeCloseTo(60);
  });

  it('orders lines problems first, then by lost machine-equivalents; an unloading station knows its consumers', () => {
    const ST = 'Build_TruckStation_C_9', C = 'Build_ConstructorMk1_C_2', C2 = 'Build_ConstructorMk1_C_3';
    const s = snapshot(
      [node(ST), constructor(C, { productivity: 0.5, issues: ['starved'] }), constructor(C2, { productivity: 0.5, issues: ['starved'] }), node('Build_StorageContainerMk1_C_4'),
        smelter('Build_SmelterMk1_C_5', { productivity: 0.1, issues: ['blocked'] }), node('Build_StorageContainerMk1_C_6'), node('Build_StorageContainerMk1_C_7')],
      [belt(ST, C), belt(ST, C2), belt(C, 'Build_StorageContainerMk1_C_4'), belt(C2, 'Build_StorageContainerMk1_C_4'),
        belt('Build_StorageContainerMk1_C_6', 'Build_SmelterMk1_C_5'), belt('Build_SmelterMk1_C_5', 'Build_StorageContainerMk1_C_7')],
    );
    const analysis = analyzeFactory(s, DATA);
    const pl = buildLines(s, analysis, DATA);
    const sorted = sortLines(pl.lines);
    // The plates line starves (a problem, 1.0 lost), the ingot line backs up into storage (demand, 0.9 lost).
    expect(sorted.map(l => l.id)).toEqual([pl.index.get(C), pl.index.get('Build_SmelterMk1_C_5')]);
    expect(lineLoss(sorted[0]!)).toBeCloseTo(1);
    expect(stationConsumers(pl, analysis, DATA, ST, ['Desc_IronIngot_C'])).toEqual([{ item: 'Desc_IronIngot_C', consumers: 2, starving: 2, ids: [C, C2] }]);
  });
});

describe('layer', () => {
  it('cuts loops where the search meets them and ranks by the longest path', () => {
    const { back, rank, order } = layer(['a', 'b', 'c', 'd'], [['a', 'b'], ['b', 'c'], ['c', 'b'], ['a', 'c'], ['c', 'd']], ['a']);
    expect([...back]).toEqual([2]);
    expect(Object.fromEntries(rank)).toEqual({ a: 0, b: 1, c: 2, d: 3 });
    expect(order).toEqual(['a', 'b', 'c', 'd']);
  });
});
