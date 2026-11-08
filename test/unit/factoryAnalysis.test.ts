import {
  analyzeFactory, analyzeRoutes, bandOf, diffFactory, filterMachines, machineFlow, reasonsOf, type AnalysisData,
} from '../../src/shared/factory/analysis.js';
import type { FactorySnapshot, SnapshotBuilding, SnapshotProduction } from '../../src/shared/factory/snapshot.js';
import type { MachineEntry } from '../../src/shared/machines.js';
import { indexRecipes, type RecipeData } from '../../src/shared/recipes.js';

// Numbers as in the game's 1.2 data (recipes.json / machines.json), trimmed to what the tests use.
const RECIPES: RecipeData = {
  format: 1, source: 'test', clock: { min: 0.01, perShard: 0.5 },
  items: [
    { id: 'Desc_OreIron_C', name: { en: 'Iron Ore', de: 'Eisenerz' }, form: 'solid' },
    { id: 'Desc_IronIngot_C', name: { en: 'Iron Ingot', de: 'Eisenbarren' }, form: 'solid' },
    { id: 'Desc_IronPlate_C', name: { en: 'Iron Plate', de: 'Eisenplatte' }, form: 'solid' },
    { id: 'Desc_Water_C', name: { en: 'Water', de: 'Wasser' }, form: 'liquid' },
    { id: 'Desc_LiquidOil_C', name: { en: 'Crude Oil', de: 'Rohöl' }, form: 'liquid' },
    { id: 'Desc_Plastic_C', name: { en: 'Plastic', de: 'Kunststoff' }, form: 'solid' },
    { id: 'Desc_HeavyOilResidue_C', name: { en: 'Heavy Oil Residue', de: 'Schweres Ölresiduum' }, form: 'liquid' },
  ],
  recipes: [
    { id: 'Recipe_IngotIron_C', name: { en: 'Iron Ingot', de: 'Eisenbarren' }, alternate: false, machine: 'Build_SmelterMk1_C', duration: 2,
      ingredients: [{ item: 'Desc_OreIron_C', amount: 1 }], products: [{ item: 'Desc_IronIngot_C', amount: 1 }] },
    { id: 'Recipe_IronPlate_C', name: { en: 'Iron Plate', de: 'Eisenplatte' }, alternate: false, machine: 'Build_ConstructorMk1_C', duration: 6,
      ingredients: [{ item: 'Desc_IronIngot_C', amount: 3 }], products: [{ item: 'Desc_IronPlate_C', amount: 2 }] },
    { id: 'Recipe_Plastic_C', name: { en: 'Plastic', de: 'Kunststoff' }, alternate: false, machine: 'Build_OilRefinery_C', duration: 6,
      ingredients: [{ item: 'Desc_LiquidOil_C', amount: 3 }], products: [{ item: 'Desc_Plastic_C', amount: 2 }, { item: 'Desc_HeavyOilResidue_C', amount: 1 }] },
  ],
  machines: [
    { id: 'Build_SmelterMk1_C', name: { en: 'Smelter', de: 'Schmelzofen' }, power: 4, powerExponent: 1.321929 },
    { id: 'Build_ConstructorMk1_C', name: { en: 'Constructor', de: 'Konstruktor' }, power: 4, powerExponent: 1.321929 },
    { id: 'Build_OilRefinery_C', name: { en: 'Refinery', de: 'Raffinerie' }, power: 30, powerExponent: 1.321929 },
  ],
  extractors: [
    { id: 'Build_MinerMk2_C', name: { en: 'Miner Mk.2', de: 'Miner Mk.2' }, kind: 'miner', tier: 2, rate: 120, power: 15, powerExponent: 1.321929, resources: ['Desc_OreIron_C'], onNode: true },
    { id: 'Build_WaterPump_C', name: { en: 'Water Extractor', de: 'Wasserpumpe' }, kind: 'pump', rate: 120, power: 20, powerExponent: 1.321929, resources: ['Desc_Water_C'], onNode: false },
    { id: 'Build_FrackingExtractor_C', name: { en: 'Resource Well Extractor', de: 'Quellenextraktor' }, kind: 'well', rate: 60, power: 0, powerExponent: 1, resources: ['Desc_Water_C'], onNode: true },
  ],
};

const entry = (id: string, category: MachineEntry['category'], stats: MachineEntry['stats']): MachineEntry => ({
  id, category, name: { en: id, de: id }, description: { en: '', de: '' }, wikiPage: id, stats, unlockedBy: [],
});

const DATA: AnalysisData = {
  recipes: indexRecipes(RECIPES),
  machines: new Map([
    ['Build_ConstructorMk1_C', entry('Build_ConstructorMk1_C', 'production', { somersloopSlots: 1 })],
    ['Build_GeneratorCoal_C', entry('Build_GeneratorCoal_C', 'power', { powerProduction: 75 })],
  ]),
  nodes: new Map([
    ['Node_Pure', { kind: 'node', resource: 'Desc_OreIron_C', purity: 'pure' }],
    ['Node_Impure', { kind: 'node', resource: 'Desc_OreIron_C', purity: 'impure' }],
    ['Sat_1', { kind: 'satellite', resource: 'Desc_Water_C', purity: 'normal', core: 'Core_1' }],
  ]),
};

let seq = 0;
const machine = (cls: string, prod: Partial<SnapshotProduction>, extra: Partial<SnapshotBuilding> = {}): SnapshotBuilding => ({
  id: `${cls}_${++seq}`, cls, x: seq * 100, y: 0, z: 0, yaw: 0, prod: { clock: 1, ...prod }, ...extra,
});

const snapshot = (buildings: SnapshotBuilding[], extra: Partial<FactorySnapshot> = {}): FactorySnapshot => ({
  v: 1, meta: { sessionName: 'Test', saveTime: 1, build: 1 }, buildings, lightweight: [], splines: [], powerLines: [], pathNetworks: [],
  stations: [], vehicles: [], markers: [], crates: [], ...extra,
});

describe('machineFlow', () => {
  it('a manufacturer makes its recipe at its clock; actual = nominal × productivity, lost = the rest', () => {
    const m = machineFlow(machine('Build_ConstructorMk1_C', { recipe: 'Recipe_IronPlate_C', clock: 1.5, productivity: 0.4, issues: ['starved'] }), DATA);
    expect(m.kind).toBe('manufacturer');
    expect(m.outputs).toHaveLength(1);
    expect(m.outputs[0]!.item).toBe('Desc_IronPlate_C');
    expect(m.outputs[0]!.nominal).toBeCloseTo(30); // 2 per 6 s = 20/min × 1.5
    expect(m.outputs[0]!.actual).toBeCloseTo(12);
    expect(m.outputs[0]!.lost).toBeCloseTo(18);
    expect(m).toMatchObject({ band: 'throttled', reason: 'starved', inefficient: true, measured: true });
  });

  it('lists every product of a recipe with by-products, and Somersloops boost the output', () => {
    const r = machineFlow(machine('Build_OilRefinery_C', { recipe: 'Recipe_Plastic_C', productivity: 1 }), DATA);
    expect(r.outputs.map(o => [o.item, o.nominal])).toEqual([['Desc_Plastic_C', 20], ['Desc_HeavyOilResidue_C', 10]]);
    const c = machineFlow(machine('Build_ConstructorMk1_C', { recipe: 'Recipe_IronPlate_C', productivity: 1, somersloops: 1 }), DATA);
    expect(c.boost).toBe(2);
    expect(c.outputs[0]!.nominal).toBeCloseTo(40);
  });

  it('an extractor gets its rate × node purity × clock; the water extractor needs no node', () => {
    const pure = machineFlow(machine('Build_MinerMk2_C', { productivity: 1, clock: 2 }, { node: 'Node_Pure' }), DATA);
    expect(pure.outputs).toEqual([{ item: 'Desc_OreIron_C', nominal: 480, actual: 480, lost: 0 }]);
    const impure = machineFlow(machine('Build_MinerMk2_C', { productivity: 0.5 }, { node: 'Node_Impure' }), DATA);
    expect(impure.outputs[0]).toMatchObject({ nominal: 60, actual: 30, lost: 30 });
    const water = machineFlow(machine('Build_WaterPump_C', { productivity: 1, clock: 0.5 }), DATA);
    expect(water.outputs[0]).toMatchObject({ item: 'Desc_Water_C', nominal: 60 });
    const unknownNode = machineFlow(machine('Build_MinerMk2_C', { productivity: 1 }, { node: 'Nowhere' }), DATA);
    expect(unknownNode.kind).toBe('extractor');
    expect(unknownNode.outputs).toEqual([]);
  });

  it('a resource well extractor runs at its pressurizer clock', () => {
    const s = snapshot([
      machine('Build_FrackingSmasher_C', { clock: 2, productivity: 1 }, { node: 'Core_1' }),
      machine('Build_FrackingExtractor_C', { productivity: 1 }, { node: 'Sat_1' }),
    ]);
    const a = analyzeFactory(s, DATA);
    expect(a.machines[1]!.outputs[0]).toMatchObject({ item: 'Desc_Water_C', nominal: 120 });
  });

  it('a generator has power, no items', () => {
    const g = machineFlow(machine('Build_GeneratorCoal_C', { productivity: 0.5, clock: 2 }), DATA);
    expect(g).toMatchObject({ kind: 'generator', outputs: [], power: { nominal: 150, actual: 75 } });
  });

  it('counts an unmeasured machine as 0 % unless it was producing', () => {
    const paused = machineFlow(machine('Build_ConstructorMk1_C', { recipe: 'Recipe_IronPlate_C', paused: true, producing: false }), DATA);
    expect(paused).toMatchObject({ productivity: 0, measured: false, band: 'idle', reason: 'paused', inefficient: true });
    const running = machineFlow(machine('Build_ConstructorMk1_C', { recipe: 'Recipe_IronPlate_C', producing: true }), DATA);
    expect(running).toMatchObject({ productivity: 1, band: 'full', reason: null, inefficient: false });
  });
});

describe('reasonsOf and bandOf', () => {
  it('orders reasons (paused first) and fills in a reason for a machine below full without one', () => {
    expect(reasonsOf({ clock: 1, issues: ['blocked', 'noPower'], paused: true }, 0)).toEqual(['paused', 'noPower', 'blocked']);
    expect(reasonsOf({ clock: 1 }, 0.5)).toEqual(['unknown']);
    expect(reasonsOf({ clock: 1 }, 0.5, 'extractor')).toEqual(['blocked']);
    expect(reasonsOf({ clock: 1 }, 0.995)).toEqual([]);
  });

  it('bands: < 1 % idle, < 90 % throttled, < 99 % high, else full', () => {
    expect([0, 0.0099, 0.01, 0.899, 0.9, 0.989, 0.99, 1].map(bandOf)).toEqual(['idle', 'idle', 'throttled', 'throttled', 'high', 'high', 'full', 'full']);
  });
});

describe('analyzeFactory', () => {
  const s = snapshot([
    machine('Build_SmelterMk1_C', { recipe: 'Recipe_IngotIron_C', productivity: 1 }),
    machine('Build_SmelterMk1_C', { recipe: 'Recipe_IngotIron_C', productivity: 0.25, issues: ['blocked'] }),
    machine('Build_SmelterMk1_C', { recipe: 'Recipe_IngotIron_C', productivity: 0, issues: ['starved'], clock: 2 }),
    machine('Build_ConstructorMk1_C', { recipe: 'Recipe_IronPlate_C', productivity: 0.95 }),
    machine('Build_GeneratorCoal_C', { productivity: 1 }),
    { id: 'belt', cls: 'Build_ConveyorPole_C', x: 0, y: 0, z: 0, yaw: 0 },
  ]);
  const a = analyzeFactory(s, DATA);

  it('sums items: nominal, actual, lost, machines worst first, main reason by lost output', () => {
    const ingot = a.items.find(i => i.item === 'Desc_IronIngot_C')!;
    expect(ingot.nominal).toBeCloseTo(30 + 30 + 60);
    expect(ingot.actual).toBeCloseTo(30 + 7.5);
    expect(ingot.lost).toBeCloseTo(22.5 + 60);
    expect(ingot.machines.map(m => m.productivity)).toEqual([0, 0.25, 1]);
    expect(ingot.lostBy).toEqual({ blocked: 22.5, starved: 60 });
    expect(ingot.mainReason).toBe('starved');
    expect(a.items[0]!.item).toBe('Desc_IronIngot_C'); // most loss first
  });

  it('per class: count, weighted mean, bands, reasons', () => {
    const smelters = a.classes.find(c => c.cls === 'Build_SmelterMk1_C')!;
    expect(smelters).toMatchObject({ count: 3, bands: { idle: 1, throttled: 1, high: 0, full: 1 }, reasons: { blocked: 1, starved: 1 }, inefficient: 2 });
    // weights by clock: 1, 1, 2
    expect(smelters.avgProductivity).toBeCloseTo((1 + 0.25 + 0) / 4);
    expect(a.classes[0]!.cls).toBe('Build_SmelterMk1_C');
  });

  it('totals: machines, weighted mean, bands, power', () => {
    expect(a.totals.machines).toBe(5);
    expect(a.totals.bands).toEqual({ idle: 1, throttled: 1, high: 1, full: 2 });
    expect(a.totals.avgProductivity).toBeCloseTo((1 + 0.25 + 0 + 0.95 + 1) / 6);
    expect(a.totals.power).toEqual({ produced: 75, producible: 75 });
    expect(a.totals.inefficient).toBe(2);
  });

  it('filters machines by class, item, reason and band', () => {
    expect(filterMachines(a.machines, { reason: 'blocked' })).toHaveLength(1);
    expect(filterMachines(a.machines, { item: 'Desc_IronPlate_C' })).toHaveLength(1);
    expect(filterMachines(a.machines, { cls: 'Build_SmelterMk1_C', band: 'full' })).toHaveLength(1);
    expect(filterMachines(a.machines, {})).toHaveLength(5);
  });
});

describe('diffFactory', () => {
  const keep = machine('Build_SmelterMk1_C', { recipe: 'Recipe_IngotIron_C', productivity: 1 });
  const gone = machine('Build_SmelterMk1_C', { recipe: 'Recipe_IngotIron_C', productivity: 1 });
  const before = snapshot([keep, gone]);
  const after = snapshot([
    { ...keep, prod: { ...keep.prod!, productivity: 0.5, issues: ['blocked'] } },
    machine('Build_ConstructorMk1_C', { recipe: 'Recipe_IronPlate_C', productivity: 1 }),
    // same id, other class: another building
    { ...gone, cls: 'Build_ConveyorPole_C', prod: undefined },
  ]);
  const d = diffFactory({ snapshot: before, analysis: analyzeFactory(before, DATA) }, { snapshot: after, analysis: analyzeFactory(after, DATA) });

  it('finds added and removed buildings by id and class', () => {
    expect(d.removed).toEqual([gone.id]);
    expect(d.added).toHaveLength(2);
    expect(d.classes).toEqual([
      { cls: 'Build_ConstructorMk1_C', added: 1, removed: 0 },
      { cls: 'Build_ConveyorPole_C', added: 1, removed: 0 },
      { cls: 'Build_SmelterMk1_C', added: 0, removed: 1 },
    ]);
  });

  it('lists machines that got worse or better and items whose loss changed', () => {
    expect(d.worse.map(w => [w.id, w.before, w.after])).toEqual([[keep.id, 1, 0.5]]);
    expect(d.better).toEqual([]);
    const ingot = d.items.find(i => i.item === 'Desc_IronIngot_C')!;
    expect(ingot).toMatchObject({ lostBefore: 0, lostAfter: 15, delta: 15 });
    expect(d.totals).toMatchObject({ buildings: 1, machines: 0, idle: 0, throttled: 1, full: -1 });
  });
});

describe('analyzeRoutes', () => {
  const s = snapshot([], {
    stations: [
      { id: 'A', cls: 'Build_TruckStation_C', x: 0, y: 0, z: 0, yaw: 0, loading: true, traffic: [
        { vehicle: 'T1', avgSecBetweenDocks: 120, avgItemsPerDock: 200, capacityStacks: 25 },
        { vehicle: 'T2', avgSecBetweenDocks: 60, avgItemsPerDock: 50, capacityStacks: 48 },
      ] },
      { id: 'B', cls: 'Build_TruckStation_C', name: 'Iron drop', x: 0, y: 0, z: 0, yaw: 0, loading: false, traffic: [
        { vehicle: 'T1', avgSecBetweenDocks: 60, avgItemsPerDock: 100 },
      ] },
      { id: 'C', cls: 'Build_TruckStation_C', x: 0, y: 0, z: 0, yaw: 0, traffic: [] },
    ],
    vehicles: [
      { id: 'T1', cls: 'BP_Tractor_C', x: 0, y: 0, z: 0, yaw: 0, autopilot: true, route: ['A', 'B', 'X', 'B'], fuel: { item: 'Desc_Coal_C', amount: 10 } },
      { id: 'T2', cls: 'BP_Truck_C', x: 0, y: 0, z: 0, yaw: 0, autopilot: false, route: [] },
    ],
  });
  const r = analyzeRoutes(s);

  it('stations: items per minute per vehicle and summed, mean interval', () => {
    const a = r.stations[0]!;
    expect(a.visits.map(v => v.itemsPerMin)).toEqual([100, 50]);
    expect(a).toMatchObject({ itemsPerMin: 150, interval: 90, loading: true });
    expect(r.stations[1]).toMatchObject({ name: 'Iron drop', itemsPerMin: 100, loading: false });
    expect(r.stations[2]).toMatchObject({ itemsPerMin: null, interval: null, loading: null });
  });

  it('vehicles: stops in order, loaded and unloaded per minute, round trip from visits × interval', () => {
    const t1 = r.vehicles[0]!;
    expect(t1.stops.map(x => x.station)).toEqual(['A', 'B', 'X', 'B']);
    expect(t1).toMatchObject({ loadedPerMin: 100, unloadedPerMin: 100, autopilot: true });
    // A once × 120 s, B twice × 60 s, X unknown
    expect(t1.roundTrip).toBe(120);
    expect(r.vehicles[1]).toMatchObject({ stops: [], loadedPerMin: null, roundTrip: null, fuel: null });
  });
});
