import { existsSync, readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { Parser } from '@etothepii/satisfactory-file-parser';
import { extractFactory, guidHex, linearToHex, slotFull, type FactoryObject, type FactorySaveLike } from '../../src/shared/factory/extract.js';
import type { SnapshotBuilding } from '../../src/shared/factory/snapshot.js';

// Hand-made objects in the shapes parser 4.1.2 returns for 1.2 saves (no game files in the repo).

const P = 'Persistent_Level:PersistentLevel.';
const ID = { rotation: { x: 0, y: 0, z: 0, w: 1 }, translation: { x: 0, y: 0, z: 0 } };
const at = (x: number, y: number, z: number, yawDeg = 0) => {
  const h = (yawDeg * Math.PI) / 360;
  return { rotation: { x: 0, y: 0, z: Math.sin(h), w: Math.cos(h) }, translation: { x, y, z } };
};
const obj = (dir: string, cls: string, n: number, extra: Partial<FactoryObject> = {}): FactoryObject => ({
  typePath: `/Game/FactoryGame/${dir}/${cls.replace(/_C$/, '')}.${cls}`,
  instanceName: `${P}${cls}_${n}`,
  type: 'SaveEntity',
  transform: ID,
  properties: {},
  components: [],
  ...extra,
});
const ref = (path: string) => ({ value: { levelName: 'Persistent_Level', pathName: path } });
const cref = (path: string) => ({ value: { levelName: '', pathName: path } });
const f = (v: number) => ({ value: v });
const TRUE = { value: false, flags: 0x10 };
const stack = (item: string, n: number) => ({
  type: 'InventoryStack',
  properties: { Item: { value: { itemReference: { pathName: item ? `/Game/X/${item}.${item}` : '' } } }, NumItems: { value: n } },
});
const inventory = (owner: string, name: string, stacks: [string, number][], allowed: string[] = [], sizes: number[] = []): FactoryObject => ({
  typePath: '/Script/FactoryGame.FGInventoryComponent',
  instanceName: `${owner}.${name}`,
  type: 'SaveComponent',
  properties: {
    mInventoryStacks: { values: stacks.map(([i, n]) => stack(i, n)) },
    mAllowedItemDescriptors: { values: allowed.map(a => ({ pathName: a === 'any' ? '/Script/FactoryGame.FGItemDescriptor' : `/Game/X/${a}.${a}` })) },
    mArbitrarySlotSizes: { values: sizes.length ? sizes : allowed.map(() => 0) },
  },
});

interface MachineSpec {
  n: number; cls?: string; recipe?: string; produce?: number; producing?: boolean; paused?: boolean; pending?: number;
  input?: [string, number][]; inputAllowed?: string[]; output?: [string, number][]; outputAllowed?: string[]; outputSizes?: number[];
  potential?: [string, number][];
}
function machine(s: MachineSpec): FactoryObject[] {
  const cls = s.cls ?? 'Build_ConstructorMk1_C';
  const name = `${P}${cls}_${s.n}`;
  const props: Record<string, unknown> = {
    mInputInventory: ref(`${name}.InputInventory`),
    mOutputInventory: ref(`${name}.OutputInventory`),
    mInventoryPotential: ref(`${name}.InventoryPotential`),
    mPowerInfo: ref(`${name}.powerInfo`),
    BuiltBy: { value: { serviceProvider: 6, playerInfoTableIndex: 0 } },
  };
  if (s.recipe) props.mCurrentRecipe = cref(`/Game/FactoryGame/Recipes/${s.recipe}.${s.recipe}`);
  if (s.produce !== undefined) {
    props.mLastProductivityMeasurementProduceDuration = f(s.produce);
    props.mLastProductivityMeasurementDuration = f(300.004);
  }
  if (s.producing) props.mIsProducing = TRUE;
  if (s.paused) props.mIsProductionPaused = TRUE;
  if (s.pending !== undefined) { props.mPendingPotential = f(s.pending); props.mCurrentPotential = f(s.pending); }
  const m = obj('Buildable/Factory', cls, s.n, {
    properties: props as FactoryObject['properties'],
    components: [{ pathName: `${name}.PowerInput` }, { pathName: `${name}.InputInventory` }],
  });
  return [
    m,
    inventory(name, 'InputInventory', s.input ?? [['Desc_IronIngot_C', 50]], s.inputAllowed ?? ['Desc_IronIngot_C']),
    inventory(name, 'OutputInventory', s.output ?? [['Desc_IronPlate_C', 2], ['', 0]], s.outputAllowed ?? ['Desc_IronPlate_C', 'any'], s.outputSizes),
    inventory(name, 'InventoryPotential', s.potential ?? [['', 0], ['', 0], ['', 0], ['', 0]]),
  ];
}
const circuit = (n: number, comps: string[]): FactoryObject => ({
  typePath: '/Script/FactoryGame.FGPowerCircuit', instanceName: `${P}CircuitSubsystem.FGPowerCircuit_${n}`, type: 'SaveEntity',
  properties: { mCircuitID: f(n), mComponents: { values: comps.map(c => ({ pathName: c })) } },
});

function save(objects: FactoryObject[], header: Partial<FactorySaveLike['header']> = {}): FactorySaveLike {
  return {
    header: { sessionName: 'Test', saveDateTime: '1794095962284', buildVersion: 517554, playDurationSeconds: 1234.4, ...header },
    levels: { Persistent_Level: { objects } },
  };
}
const byId = (b: SnapshotBuilding[], id: string) => b.find(x => x.id === id)!;

describe('meta', () => {
  it('reads header, game phase and schematics; converts raw ticks', () => {
    const s = extractFactory(save([
      obj('-Shared', 'BP_GamePhaseManager_C', 1, { properties: { mCurrentGamePhase: cref('/Game/FactoryGame/GamePhases/GP_Project_Assembly_Phase_2.GP_Project_Assembly_Phase_2') } }),
      obj('-Shared', 'BP_SchematicManager_C', 1, { properties: { mPurchasedSchematics: { values: [cref('/a.S1_C').value, cref('/a.S2_C').value] } } }),
    ]));
    expect(s.v).toBe(1);
    expect(s.meta).toEqual({ sessionName: 'Test', saveTime: 1794095962284, build: 517554, playTimeSec: 1234, gamePhase: 'GP_Project_Assembly_Phase_2', schematics: 2 });
    const ms = Date.UTC(2026, 10, 8);
    expect(extractFactory(save([], { saveDateTime: String((BigInt(ms) + 62135596800000n) * 10000n) })).meta.saveTime).toBe(ms);
  });
});

describe('buildings and production', () => {
  const POWERED = 9;
  const gen = obj('Buildable/Factory', 'Build_GeneratorCoal_C', POWERED, {
    properties: { mFuelInventory: ref(`${P}Build_GeneratorCoal_C_${POWERED}.FuelInventory`), mIsProducing: TRUE, mCurrentFuelAmount: f(100),
      mLastProductivityMeasurementProduceDuration: f(300), mLastProductivityMeasurementDuration: f(300) },
    components: [{ pathName: `${P}Build_GeneratorCoal_C_${POWERED}.PowerConnection` }],
  });
  const genFuel = inventory(gen.instanceName, 'FuelInventory', [['Desc_Coal_C', 50], ['Desc_Water_C', 40000]], ['', 'Desc_Water_C'], [0, 50000]);
  const deadGen = obj('Buildable/Factory', 'Build_GeneratorFuel_C', 10, {
    properties: { mFuelInventory: ref(`${P}Build_GeneratorFuel_C_10.FuelInventory`), mLastProductivityMeasurementProduceDuration: f(0), mLastProductivityMeasurementDuration: f(300) },
  });
  const deadFuel = inventory(deadGen.instanceName, 'FuelInventory', [['', 0]], [''], [50000]);
  const machines = [
    // 1: running fully, momentarily empty input: no issue
    ...machine({ n: 1, recipe: 'Recipe_IronPlate_C', produce: 300.004, producing: true, input: [['', 0]] }),
    // 2: output full (200 plates), not producing → blocked
    ...machine({ n: 2, recipe: 'Recipe_IronPlate_C', produce: 171.4, output: [['Desc_IronPlate_C', 200], ['', 0]], pending: 1.5,
      potential: [['Desc_CrystalShard_C', 1], ['', 0], ['', 0], ['Desc_WAT1_C', 2]] }),
    // 3: input empty, low → starved
    ...machine({ n: 3, recipe: 'Recipe_IronPlate_C', produce: 90, input: [['', 0]] }),
    // 4: has some input, not producing, output free → starved by elimination
    ...machine({ n: 4, cls: 'Build_ManufacturerMk1_C', recipe: 'Recipe_Computer_C', produce: 96,
      input: [['Desc_CircuitBoard_C', 19], ['Desc_Cable_C', 200], ['Desc_Plastic_C', 12], ['', 0]],
      inputAllowed: ['Desc_CircuitBoard_C', 'Desc_Cable_C', 'Desc_Plastic_C', 'any'], output: [['', 0], ['', 0]], outputAllowed: ['Desc_Computer_C', 'any'] }),
    // 5: no recipe, never measured, not on any circuit → noRecipe + noPower
    ...machine({ n: 5, cls: 'Build_AssemblerMk1_C', input: [], inputAllowed: [], output: [], outputAllowed: [] }),
    // 6: paused
    ...machine({ n: 6, recipe: 'Recipe_IronRod_C', paused: true }),
    // 7: fluid output at 47 000 of 50 000 litres → blocked
    ...machine({ n: 7, cls: 'Build_OilRefinery_C', recipe: 'Recipe_LiquidFuel_C', produce: 6,
      input: [['Desc_LiquidOil_C', 50000], ['', 0]], inputAllowed: ['Desc_LiquidOil_C', 'any'],
      output: [['Desc_LiquidFuel_C', 47000], ['', 0], ['', 0]], outputAllowed: ['Desc_LiquidFuel_C', 'Desc_HeavyOilResidue_C', 'any'], outputSizes: [50000, 50000, 0] }),
  ];
  const powered = [1, 2, 3, 4, 6].map(n => `${P}Build_ConstructorMk1_C_${n}.PowerInput`)
    .concat([`${P}Build_ManufacturerMk1_C_4.PowerInput`, `${P}Build_OilRefinery_C_7.PowerInput`, `${P}Build_GeneratorCoal_C_${POWERED}.PowerConnection`]);
  const s = extractFactory(save([...machines, gen, genFuel, deadGen, deadFuel, circuit(1, powered)]));

  it('reads position, yaw and production fields', () => {
    const b = byId(s.buildings, 'Build_ConstructorMk1_C_2');
    expect(b).toMatchObject({ cls: 'Build_ConstructorMk1_C', x: 0, y: 0, z: 0, yaw: 0 });
    expect(b.prod).toEqual({
      recipe: 'Recipe_IronPlate_C', clock: 1.5, productivity: 0.571, windowSec: 300, producing: false,
      powerShards: 1, somersloops: 2, issues: ['blocked'],
    });
  });

  it('flags nothing on a machine running at 100 %', () => {
    expect(byId(s.buildings, 'Build_ConstructorMk1_C_1').prod).toEqual({ recipe: 'Recipe_IronPlate_C', clock: 1, productivity: 1, windowSec: 300, producing: true });
  });

  it('starved: empty input slot, or idle with power, recipe and room', () => {
    expect(byId(s.buildings, 'Build_ConstructorMk1_C_3').prod!.issues).toEqual(['starved']);
    expect(byId(s.buildings, 'Build_ManufacturerMk1_C_4').prod!.issues).toEqual(['starved']);
  });

  it('noRecipe and noPower', () => {
    const p = byId(s.buildings, 'Build_AssemblerMk1_C_5').prod!;
    expect(p.recipe).toBeUndefined();
    expect(p.productivity).toBeUndefined();
    expect(p.issues).toEqual(['noRecipe', 'noPower']);
  });

  it('paused machines are not called starved', () => {
    const p = byId(s.buildings, 'Build_ConstructorMk1_C_6').prod!;
    expect(p.paused).toBe(true);
    expect(p.issues).toBeUndefined();
  });

  it('fluid output nearly full is blocked', () => {
    expect(byId(s.buildings, 'Build_OilRefinery_C_7').prod!.issues).toEqual(['blocked']);
  });

  it('generators: running one fine, empty one noFuel, never noPower', () => {
    expect(byId(s.buildings, `Build_GeneratorCoal_C_${POWERED}`).prod).toEqual({ clock: 1, productivity: 1, windowSec: 300, producing: true });
    expect(byId(s.buildings, 'Build_GeneratorFuel_C_10').prod!.issues).toEqual(['noFuel']);
  });

  it('a circuit without a generator does not power its machines', () => {
    const [m] = machine({ n: 11, recipe: 'Recipe_IronPlate_C', produce: 300, producing: true });
    const r = extractFactory(save([...machine({ n: 11, recipe: 'Recipe_IronPlate_C', produce: 300, producing: true }),
      circuit(2, [`${P}Build_ConstructorMk1_C_11.PowerInput`, `${P}Build_PowerPoleMk1_C_1.PowerConnection`])]));
    expect(r.buildings.find(b => b.id === shortId(m!))!.prod!.issues).toEqual(['noPower']);
  });

  it('slotFull uses stack sizes for solids and the fixed size for fluids', () => {
    expect(slotFull({ count: 99, size: 0 })).toBe(true);
    expect(slotFull({ count: 190, size: 0 })).toBe(true);
    expect(slotFull({ count: 120, size: 0 })).toBe(false);
    expect(slotFull({ count: 3, size: 0 })).toBe(false);
    expect(slotFull({ count: 40000, size: 50000 })).toBe(true);
    expect(slotFull({ count: 30000, size: 50000 })).toBe(false);
  });
});
const shortId = (o: FactoryObject) => o.instanceName.slice(o.instanceName.lastIndexOf('.') + 1);

describe('other building fields', () => {
  it('links extractors to resource nodes, reads lift height, signs, swatches; skips non-buildings', () => {
    const node = { typePath: '/Game/FactoryGame/Resource/BP_ResourceNode.BP_ResourceNode_C', instanceName: `${P}BP_ResourceNode586`, type: 'SaveEntity', transform: ID };
    const s = extractFactory(save([
      node,
      obj('Buildable/Factory', 'Build_MinerMk2_C', 1, { transform: at(100, 200, 300, 90), properties: { mExtractableResource: ref(node.instanceName) } }),
      obj('Buildable/Factory', 'Build_WaterPump_C', 1, { properties: { mExtractableResource: ref(`${P}FGWaterVolume35_5`) } }),
      obj('Buildable/Factory', 'Build_ConveyorLiftMk4_C', 1, { properties: { mTopTransform: { value: { properties: { Translation: { value: { x: 0, y: 0, z: -550 } } } } } } }),
      obj('Buildable/Factory', 'Build_StandaloneWidgetSign_Small_C', 1, { properties: {
        mPrefabTextElementSaveData: { values: [{ properties: { ElementName: { value: 'Name' }, Text: { value: 'Iron' } } }, { properties: { Text: { value: ' ' } } }] },
        mCustomizationData: { value: { properties: { SwatchDesc: cref('/Game/X/SwatchDesc_Slot3.SwatchDesc_Slot3_C') } } },
      } }),
      obj('Buildable/Factory', 'Build_PipelineFlowIndicator_C', 1),
      obj('Buildable/Vehicle', 'Build_VehiclePathNode_Default_C', 1),
      obj('Buildable/Factory', 'BP_ProjectAssembly_C', 1),
      { ...obj('Buildable/Factory', 'Build_ConstructorMk1_C', 99), type: 'SaveComponent' },
    ]));
    expect(s.buildings.map(b => b.id)).toEqual(['Build_MinerMk2_C_1', 'Build_WaterPump_C_1', 'Build_ConveyorLiftMk4_C_1', 'Build_StandaloneWidgetSign_Small_C_1']);
    expect(s.buildings[0]).toMatchObject({ x: 100, y: 200, z: 300, yaw: 90, node: 'BP_ResourceNode586' });
    expect(s.buildings[1]!.node).toBeUndefined();
    expect(s.buildings[2]!.height).toBe(-550);
    expect(s.buildings[3]).toMatchObject({ texts: ['Iron'], swatch: 3 });
  });
});

describe('lightweight buildables', () => {
  it('groups instances per class as x, y, z, yaw and skips empty classes', () => {
    const s = extractFactory(save([obj('-Shared', 'FGLightweightBuildableSubsystem', 1, {
      typePath: '/Script/FactoryGame.FGLightweightBuildableSubsystem',
      specialProperties: { type: 'BuildableSubsystemSpecialProperties', buildables: [
        { typeReference: { pathName: '/Game/X/Build_Foundation_8x4_01.Build_Foundation_8x4_01_C' }, instances: [
          { transform: at(-88286.9, 252495.9, -3212.8, 90) }, { transform: at(1, 2, 3) }] },
        { typeReference: { pathName: '/Game/X/Build_PillarBase_Small.Build_PillarBase_Small_C' }, instances: [] },
      ] },
    })]));
    expect(s.lightweight).toEqual([{ cls: 'Build_Foundation_8x4_01_C', xyzYaw: [-88287, 252496, -3213, 90, 1, 2, 3, 0] }]);
  });
});

describe('splines and power lines', () => {
  const sp = (x: number, y: number, z: number, tx: number, ty: number) => ({
    properties: { Location: { value: { x, y, z } }, ArriveTangent: { value: { x: tx, y: ty, z: 0 } }, LeaveTangent: { value: { x: tx, y: ty, z: 0 } } },
  });
  it('transforms belt points to world space and simplifies them', () => {
    const s = extractFactory(save([
      obj('Buildable/Factory', 'Build_ConveyorBeltMk1_C', 1, { transform: at(1000, 2000, 100, 90), properties: { mSplineData: { values: [sp(0, 0, 0, 600, 0), sp(2000, 0, 0, 600, 0)] } } }),
      obj('Buildable/Vehicle', 'Build_VehiclePath_Universal_C', 1, { transform: at(0, 0, 0), properties: { mSplinePoints: { values: [
        sp(0, 0, 0, 100, 0), sp(100, 1, 0, 100, 0), sp(200, -1, 0, 100, 0), sp(300, 0, 0, 100, 0)] } } }),
    ]));
    expect(s.splines).toEqual([
      { id: 'Build_ConveyorBeltMk1_C_1', cls: 'Build_ConveyorBeltMk1_C', pts: [1000, 2000, 100, 1000, 4000, 100] },
      { id: 'Build_VehiclePath_Universal_C_1', cls: 'Build_VehiclePath_Universal_C', pts: [0, 0, 0, 300, 0, 0] },
    ]);
    expect(s.buildings).toEqual([]);
  });

  it('power lines from wire instances, else from the connected buildings', () => {
    const pole = obj('Buildable/Factory', 'Build_PowerPoleMk1_C', 1, { transform: at(10, 20, 30) });
    const m = obj('Buildable/Factory', 'Build_ConstructorMk1_C', 1, { transform: at(-10, -20, -30) });
    const s = extractFactory(save([
      pole, m,
      obj('Buildable/Factory', 'Build_PowerLine_C', 1, { properties: { mWireInstances: { values: [{ properties: {
        Locations: [{ value: { x: 1.4, y: 2, z: 3 } }, { index: 1, value: { x: 4, y: 5, z: 6.6 } }] } }] } },
        specialProperties: { type: 'PowerLineSpecialProperties' } }),
      obj('Buildable/Factory', 'Build_PowerLine_C', 2, { specialProperties: { type: 'PowerLineSpecialProperties',
        source: { pathName: `${pole.instanceName}.PowerConnection` }, target: { pathName: `${m.instanceName}.PowerInput` } } }),
    ]));
    expect(s.powerLines).toEqual([1, 2, 3, 4, 5, 7, 10, 20, 30, -10, -20, -30]);
    expect(s.buildings).toHaveLength(2);
  });
});

describe('stations, vehicles, routes, path networks', () => {
  const G1 = [2283413397, 1121460384, 2574457011, 201347935];
  const G2 = [2876877455, 1242919635, 2131307402, 2217402498];
  const GX = [270472127, 1257643663, 640710535, 837119579];
  const st1 = obj('Buildable/Factory', 'Build_TruckStation_C', 1, { transform: at(5, 6, 7, 160), properties: {
    mIsInLoadMode: { value: false },
    mDockingPathNode: ref(`${P}Build_VehiclePathNode_DockingStation_C_1`),
    mVehicleTracking: { values: [{ properties: {
      OwnerVehicle: ref(`${P}BP_Tractor_C_1`), VehicleInventorySizeLinear: f(25), VehicleFluidSlotCapacity: f(0),
      AverageTimeBetweenDocks: f(92.857), AverageItemsTransferredPerDock: f(150.475), TimeSinceLastDocking: f(68),
    } }] },
  } });
  const st2 = obj('Buildable/Factory', 'Build_TruckStation_C', 2);
  const ident = (n: number, station: FactoryObject, guid: number[], name: object) => obj('-', 'FGDockingStationIdentifier', n, {
    typePath: '/Script/FactoryGame.FGDockingStationIdentifier', transform: undefined,
    properties: { mStation: ref(station.instanceName), mStationName: { value: name }, mPathNodeGUID: { value: guid } },
  });
  const tractor = obj('Buildable/Vehicle', 'BP_Tractor_C', 1, { transform: at(100, 200, 300, -90), properties: { mOwningPlayerState: ref(`${P}BP_PlayerState_C_1`) } });
  const vident = obj('-', 'FGWheeledVehicleIdentifier', 1, {
    typePath: '/Script/FactoryGame.FGWheeledVehicleIdentifier', transform: undefined,
    properties: {
      mOwnerVehicle: ref(tractor.instanceName), mVehicleName: { value: { historyType: -1, value: 'Iron run' } },
      mIsAutopilotEnabled: TRUE, mVehicleRoute: { values: [G1, GX, G2] },
      mFuelTypeDescriptor: cref('/Game/X/Desc_TurboFuel.Desc_TurboFuel_C'),
    },
  });
  const fuel = inventory(tractor.instanceName, 'FuelInventory', [['Desc_TurboFuel_C', 99]]);
  const node = (n: number, net: number, cls = 'Build_VehiclePathNode_Default_C') => obj('Buildable/Vehicle', cls, n, { properties: { mPathNetworkID: f(net) } });
  const seg = (n: number, from: FactoryObject) => obj('Buildable/Vehicle', 'Build_VehiclePath_Universal_C', n, { properties: {
    mStartNode: ref(from.instanceName), mSplinePoints: { values: [
      { properties: { Location: { value: { x: 0, y: 0, z: 0 } } } }, { properties: { Location: { value: { x: 100, y: 0, z: 0 } } } }] },
  } });
  const n1 = node(1, 256), n2 = node(2, 256), n3 = node(3, 228);
  const s = extractFactory(save([
    st1, st2, ident(1, st1, G1, { historyType: 11, tableId: 'Buildables_Data', textKey: 'Transport/RoadVehicles/Infrastructure/TruckStation' }),
    ident(2, st2, G2, { flags: 18, historyType: -1, hasCultureInvariantString: true, value: 'Base' }),
    tractor, vident, fuel, n1, n2, n3, seg(1, n1), seg(2, n2), seg(3, n3),
  ]));

  it('stations: default name left out, renamed kept, GUID, mode, traffic', () => {
    expect(s.stations).toEqual([
      { id: 'Build_TruckStation_C_1', cls: 'Build_TruckStation_C', x: 5, y: 6, z: 7, yaw: 160, nodeGuid: guidHex(G1), loading: false,
        traffic: [{ vehicle: 'BP_Tractor_C_1', avgSecBetweenDocks: 92.9, avgItemsPerDock: 150.5, capacityStacks: 25 }] },
      { id: 'Build_TruckStation_C_2', cls: 'Build_TruckStation_C', name: 'Base', x: 0, y: 0, z: 0, yaw: 0, nodeGuid: guidHex(G2), loading: true, traffic: [] },
    ]);
    expect(s.buildings.map(b => b.id)).toEqual(['Build_TruckStation_C_1', 'Build_TruckStation_C_2']);
  });

  it('vehicles: name, autopilot, fuel and route through the stations’ path node GUIDs; no owner', () => {
    expect(s.vehicles).toEqual([{
      id: 'BP_Tractor_C_1', cls: 'BP_Tractor_C', name: 'Iron run', x: 100, y: 200, z: 300, yaw: -90, autopilot: true,
      fuel: { item: 'Desc_TurboFuel_C', amount: 99 }, route: ['Build_TruckStation_C_1', 'Build_TruckStation_C_2'],
    }]);
    expect(JSON.stringify(s)).not.toContain('PlayerState');
  });

  it('path networks group nodes and segments by network id', () => {
    expect(s.pathNetworks).toEqual([
      { id: 228, nodes: 1, segments: ['Build_VehiclePath_Universal_C_3'] },
      { id: 256, nodes: 2, segments: ['Build_VehiclePath_Universal_C_1', 'Build_VehiclePath_Universal_C_2'] },
    ]);
  });

  it('guidHex is 32 upper-case hex digits', () => {
    expect(guidHex(G1)).toBe('881A1F9542D820A0997318B30C00535F');
    expect(guidHex([0, 0, 0, 0])).toBeUndefined();
  });
});

describe('map manager: markers, fog; crates', () => {
  const W = 8;
  const raw = new Array<number>(W * W * 4).fill(0);
  for (let i = 0; i < W * W; i++) { raw[i * 4 + 2] = i % W < 3 ? 255 : 0; raw[i * 4 + 3] = 255; }
  const marker = (name: string, kind: string, color: object) => ({ type: 'MapMarker', properties: {
    markerGuid: { value: [1, 2, 3, 4] },
    Location: { value: { type: 'Vector_NetQuantize', properties: { X: f(-42844.6), Y: f(224129.6), Z: f(-646.5) } } },
    Name: { value: name }, CategoryName: { value: '' },
    MapMarkerType: { value: { value: `ERepresentationType::${kind}` } }, IconID: f(651), Color: { value: color }, Scale: f(1.5),
    lastEditedBy: { value: { serviceProvider: 6, playerInfoTableIndex: 0 } },
  } });
  const s = extractFactory(save([
    obj('-', 'FGMapManager', 1, { typePath: '/Script/FactoryGame.FGMapManager', properties: {
      mMapMarkers: { values: [marker('Cave', 'RT_Stamp', { r: 1, g: 1, b: 1, a: 1 }), marker('Base', 'RT_MapMarker', { r: 0.5, g: 0, b: 0.2140, a: 1 })] },
      mFogOfWarRawData: { values: raw },
    } }),
    obj('-', 'BP_Crate_C', 1, { typePath: '/Game/FactoryGame/-Shared/Crate/BP_Crate.BP_Crate_C', transform: at(1.4, 2.6, -3),
      properties: { mCrateType: { value: { value: 'EFGCrateType::CT_DeathCrate' } } } }),
  ]));

  it('markers with kind, icon, sRGB colour and scale, no editor', () => {
    expect(s.markers).toEqual([
      { name: 'Cave', x: -42845, y: 224130, z: -646, kind: 'RT_Stamp', iconId: 651, color: '#ffffff', scale: 1.5 },
      { name: 'Base', x: -42845, y: 224130, z: -646, kind: 'RT_MapMarker', iconId: 651, color: '#bc007f', scale: 1.5 },
    ]);
    expect(linearToHex({ r: 0, g: 0.0031308, b: 0.2140 })).toBe('#000a7f');
  });

  it('crates', () => {
    expect(s.crates).toEqual([{ x: 1, y: 3, z: -3, kind: 'CT_DeathCrate' }]);
  });

  it('fog as a greyscale PNG of byte 2 of each pixel', () => {
    const png = Buffer.from(s.fog!, 'base64');
    expect(png.readUInt32BE(16)).toBe(W);
    const len = png.readUInt32BE(33);
    const rows = inflateSync(png.subarray(41, 41 + len));
    // Row 0 has filter None or Sub; decode both.
    const f0 = rows[0]!;
    const row: number[] = [];
    for (let x = 0; x < W; x++) row.push((rows[1 + x]! + (f0 === 1 && x > 0 ? row[x - 1]! : 0)) & 0xff);
    expect(row).toEqual([255, 255, 255, 0, 0, 0, 0, 0]);
    expect(extractFactory(save([obj('-', 'FGMapManager', 1, { typePath: '/Script/FactoryGame.FGMapManager', properties: { mFogOfWarRawData: { values: raw } } })]), { skipFog: true }).fog).toBeUndefined();
  });
});

// Needs a real save (never in the repo); skipped without one.
const fixture = process.env.FICSMAP_SAVE_FIXTURE;
describe('real save', () => {
  it.skipIf(!fixture || !existsSync(fixture))('extracts a snapshot within the size budget', () => {
    const buf = readFileSync(fixture!);
    const parsed = Parser.ParseSave('t', buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
    const s = extractFactory(parsed as unknown as FactorySaveLike);
    expect(s.buildings.length).toBeGreaterThan(0);
    expect(s.splines.length).toBeGreaterThan(0);
    expect(JSON.stringify(s).length).toBeLessThan(4 * 2 ** 20);
  }, 30_000);
});
