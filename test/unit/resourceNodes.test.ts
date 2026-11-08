import { existsSync, readFileSync } from 'node:fs';
import { Parser } from '@etothepii/satisfactory-file-parser';
import {
  applyOverrides, changedNodeSettings, countNodes, extractorsByNode, extractResourceNodes, filterNodes, isRandomized, MAX_CLOCK, MAX_SHARDS,
  NODE_PURITY_SETTINGS, NODE_RANDOMIZATION_MODES, purityFromGame, readResourceNodes,
  summarizeExtractors, type NodeExtractor, type NodeFilter, type Purity, type ResourceNodesFile, type SaveNodesLike,
} from '../../src/shared/resourceNodes.js';

const FILE: ResourceNodesFile = {
  version: 't',
  resources: [{ id: 'Desc_OreIron_C', name: 'Iron Ore' }, { id: 'Desc_Water_C', name: 'Water' }],
  nodes: [
    ['N1', 'node', 'Desc_OreIron_C', 'impure', 0, 0, 0],
    ['N2', 'node', 'Desc_OreIron_C', 'pure', 10, 0, 0],
    ['G1', 'geyser', 'Geyser', 'normal', 20, 0, 0],
    ['C1', 'core', 'Desc_Water_C', null, 30, 0, 0],
    ['S1', 'satellite', 'Desc_Water_C', 'pure', 31, 0, 0, 'C1'],
    ['S2', 'satellite', 'Desc_Water_C', 'impure', 29, 0, 0, 'C1'],
  ],
};
const nodes = readResourceNodes(FILE);
const all = (hidden: string[] = [], purities: Purity[] = ['impure', 'normal', 'pure']): NodeFilter =>
  ({ hiddenResources: new Set(hidden), purities: new Set(purities) });
const names = (ns: { name: string }[]) => ns.map(n => n.name);

describe('purityFromGame', () => {
  it('maps the game names (with its spelling RP_Inpure), qualified names and enum indices', () => {
    expect(purityFromGame('RP_Inpure')).toBe('impure');
    expect(purityFromGame('EResourcePurity::RP_Normal')).toBe('normal');
    expect(purityFromGame('RP_Pure')).toBe('pure');
    expect(purityFromGame(2)).toBe('pure');
    expect(purityFromGame('RP_MAX')).toBeNull();
    expect(purityFromGame(3)).toBeNull();
    expect(purityFromGame(undefined)).toBeNull();
  });
});

describe('readResourceNodes', () => {
  it('turns the tuples into nodes, with the core only on satellites', () => {
    expect(nodes[0]).toEqual({ name: 'N1', kind: 'node', resource: 'Desc_OreIron_C', purity: 'impure', x: 0, y: 0, z: 0 });
    expect(nodes[4]).toMatchObject({ kind: 'satellite', core: 'C1' });
  });
});

describe('applyOverrides', () => {
  it('returns the defaults without overrides', () => {
    expect(applyOverrides(nodes, [])).toEqual(nodes);
  });
  it('takes resource and purity from the save and remembers the default', () => {
    const out = applyOverrides(nodes, [['N1', 'Desc_Coal_C', null], ['N2', null, 'normal'], ['Unknown', 'Desc_Coal_C', 'pure']]);
    expect(out[0]).toMatchObject({ resource: 'Desc_Coal_C', purity: 'impure', original: { resource: 'Desc_OreIron_C', purity: 'impure' } });
    expect(out[1]).toMatchObject({ resource: 'Desc_OreIron_C', purity: 'normal', original: { resource: 'Desc_OreIron_C', purity: 'pure' } });
    expect(out[2]).toBe(nodes[2]);
    expect(out).toHaveLength(nodes.length);
  });
  it('an override equal to the default changes nothing', () => {
    expect(applyOverrides(nodes, [['N2', 'Desc_OreIron_C', 'pure']])[1]).toBe(nodes[1]);
  });
  it("a core's resource applies to its satellites unless they have their own; cores keep no purity", () => {
    const out = applyOverrides(nodes, [['C1', 'Desc_NitrogenGas_C', 'pure'], ['S2', 'Desc_LiquidOil_C', null]]);
    expect(out[3]).toMatchObject({ resource: 'Desc_NitrogenGas_C', purity: null });
    expect(out[4]).toMatchObject({ resource: 'Desc_NitrogenGas_C', purity: 'pure' });
    expect(out[5]).toMatchObject({ resource: 'Desc_LiquidOil_C', purity: 'impure' });
  });
});

describe('filterNodes and countNodes', () => {
  it('shows everything by default, cores included', () => {
    expect(names(filterNodes(nodes, all()))).toEqual(['N1', 'N2', 'G1', 'C1', 'S1', 'S2']);
  });
  it('filters by resource and purity; a core stays while one of its satellites does', () => {
    expect(names(filterNodes(nodes, all(['Desc_OreIron_C'])))).toEqual(['G1', 'C1', 'S1', 'S2']);
    expect(names(filterNodes(nodes, all([], ['pure'])))).toEqual(['N2', 'C1', 'S1']);
    expect(names(filterNodes(nodes, all([], ['normal'])))).toEqual(['G1']);
    expect(names(filterNodes(nodes, all(['Desc_Water_C'])))).toEqual(['N1', 'N2', 'G1']);
  });
  it('counts per resource under the purity filter and per purity under the resource filter, without cores', () => {
    const c = countNodes(nodes, all(['Geyser'], ['pure']));
    expect(Object.fromEntries(c.byResource)).toEqual({ Desc_OreIron_C: 1, Desc_Water_C: 1 });
    expect(c.byPurity).toEqual({ impure: 2, normal: 0, pure: 2 });
  });
});

type Obj = SaveNodesLike['levels'][string]['objects'][number];
const save = (...objects: Obj[]): SaveNodesLike => ({ levels: { Persistent_Level: { objects } } });
/**
 * Property shapes as @etothepii/satisfactory-file-parser returns them for 1.2 saves (save version 60, complete
 * property tags). Int, Bool, Enum and class-reference properties are copied from real saves; the ByteProperty with
 * an enum is what the parser makes of UE's tag for a `TEnumAsByte` (checked by writing and re-reading it).
 */
const tag = (name: string, children: unknown[] = []) => ({ name, children });
const intProp = (name: string, value: number) => ({ type: 'IntProperty', name, propertyTagType: tag('IntProperty'), value });
const boolProp = (name: string, value: boolean) => ({ type: 'BoolProperty', name, propertyTagType: tag('BoolProperty'), flags: 16, value });
const byteEnumProp = (name: string, enumName: string, value: string) => ({
  type: 'ByteProperty', name, propertyTagType: tag('ByteProperty', [tag(enumName, [tag('/Script/FactoryGame')])]), value: { type: enumName, value },
});
const enumProp = (name: string, enumName: string, value: string) => ({
  type: 'EnumProperty', name, propertyTagType: tag('EnumProperty', [tag(enumName, [tag('/Script/FactoryGame')]), tag('ByteProperty')]), value: { value },
});
const classProp = (name: string, pathName: string) => ({ type: 'ObjectProperty', name, propertyTagType: tag('ObjectProperty'), value: { levelName: '', pathName } });

const node = (name: string, properties: Obj['properties'] = {}, cls = 'BP_ResourceNode'): Obj => ({
  typePath: `/Game/FactoryGame/Resource/${cls}.${cls}_C`, instanceName: `Persistent_Level:PersistentLevel.${name}`, properties,
});
const GAME_STATE = '/Game/FactoryGame/-Shared/Blueprint/BP_GameState.BP_GameState_C';

describe('extractResourceNodes', () => {
  it('finds nothing in a world with default nodes (only mResourcesLeft and mDoSpawnParticle)', () => {
    const s = save(
      node('BP_ResourceNode620', { mResourcesLeft: intProp('mResourcesLeft', -1) }),
      node('BP_ResourceNode13', { mDoSpawnParticle: boolProp('mDoSpawnParticle', false) }),
      node('BP_FrackingCore6', {}, 'BP_FrackingCore'),
      node('BP_FrackingSatellite50', {}, 'BP_FrackingSatellite'),
      { typePath: GAME_STATE, instanceName: 'Persistent_Level:PersistentLevel.BP_GameState_C_2147482350', properties: { mIsSpaceElevatorBuilt: boolProp('mIsSpaceElevatorBuilt', true) } },
    );
    expect(extractResourceNodes(s)).toEqual({ overrides: [], settings: null, extractors: [] });
  });
  it('reads purity and resource class overrides per node actor as the save stores them', () => {
    const s = save(
      node('N2', { mResourcesLeft: intProp('mResourcesLeft', -1), mPurityOverride: byteEnumProp('mPurityOverride', 'EResourcePurity', 'RP_Pure') }),
      node('N1', { mResourceClassOverride: classProp('mResourceClassOverride', '/Game/FactoryGame/Resource/RawResources/Coal/Desc_Coal.Desc_Coal_C') }),
      node('S1', { mPurityOverride: byteEnumProp('mPurityOverride', 'EResourcePurity', 'RP_Inpure') }, 'BP_FrackingSatellite'),
      node('G1', { mPurityOverride: byteEnumProp('mPurityOverride', 'EResourcePurity', 'RP_Normal') }, 'BP_ResourceNodeGeyser'),
      node('C1', { mResourceClassOverride: classProp('mResourceClassOverride', '/Game/FactoryGame/Resource/RawResources/NitrogenGas/Desc_NitrogenGas.Desc_NitrogenGas_C') }, 'BP_FrackingCore'),
      node('N3', { mPurityOverride: byteEnumProp('mPurityOverride', 'EResourcePurity', 'RP_MAX') }),
      node('N4', { mResourceClassOverride: classProp('mResourceClassOverride', '') }),
    );
    expect(extractResourceNodes(s).overrides).toEqual([
      ['C1', 'Desc_NitrogenGas_C', null], ['G1', null, 'normal'], ['N1', 'Desc_Coal_C', null], ['N2', null, 'pure'], ['S1', null, 'impure'],
    ]);
  });
  it('also accepts a qualified enum name or a plain byte index', () => {
    const s = save(
      node('N1', { mPurityOverride: { value: { value: 'EResourcePurity::RP_Pure' } } }),
      node('N2', { mPurityOverride: { value: { type: 'None', value: 0 } } }),
    );
    expect(extractResourceNodes(s).overrides).toEqual([['N1', null, 'pure'], ['N2', null, 'impure']]);
  });
  it('reads the randomisation settings from the game state', () => {
    const s = save({
      typePath: GAME_STATE, instanceName: 'Persistent_Level:PersistentLevel.BP_GameState_C_2147482350',
      properties: {
        mNodeRandomization: enumProp('mNodeRandomization', 'ENodeRandomizationMode', 'ENodeRandomizationMode::NRM_BasicReach'),
        mNodeRandomizationSeed: intProp('mNodeRandomizationSeed', 1234),
      },
    });
    const r = extractResourceNodes(s);
    expect(r.settings).toEqual({ randomization: 'NRM_BasicReach', purity: null, seed: 1234 });
    expect(isRandomized(r.settings)).toBe(true);
  });
  it('a game state with only the seed (settings at their defaults) is not randomised', () => {
    const s = save({
      typePath: GAME_STATE, instanceName: 'Persistent_Level:PersistentLevel.BP_GameState_C_2147482350',
      properties: { mNodeRandomizationSeed: intProp('mNodeRandomizationSeed', 99) },
    });
    const r = extractResourceNodes(s);
    expect(r).toMatchObject({ overrides: [], settings: { randomization: null, purity: null, seed: 99 } });
    expect(isRandomized(r.settings)).toBe(false);
  });
  it('ignores settings-like properties on other objects', () => {
    const s = save({
      typePath: '/Script/FactoryGame.FGSessionInformationModel', instanceName: 'x',
      properties: { mNodePuritySettings: enumProp('mNodePuritySettings', 'ENodePuritySettings', 'ENodePuritySettings::NPS_AllPure') },
    });
    expect(extractResourceNodes(s).settings).toBeNull();
  });
});

describe('occupancy filter, extractors per node and summary', () => {
  const list: NodeExtractor[] = [
    ['N1', 'portable', null, null], ['N1', 'miner2', 2.25, 3], ['S1', 'well', 1.5, 1], ['C1', 'pressurizer', 1, 0], ['Elsewhere', 'miner1', 1, 0],
  ];
  const byNode = extractorsByNode(nodes, list);
  const occ = (occupancy: 'all' | 'occupied' | 'free'): NodeFilter => ({ ...all(), occupancy, occupied: byNode });

  it('groups extractors by node, buildings first, and leaves out nodes the dataset lacks', () => {
    expect([...byNode.keys()].sort()).toEqual(['C1', 'N1', 'S1']);
    expect(byNode.get('N1')!.map(e => e.kind)).toEqual(['miner2', 'portable']);
  });
  it('filters occupied and free nodes; a pressurized core shows with the occupied filter', () => {
    expect(names(filterNodes(nodes, occ('all')))).toEqual(['N1', 'N2', 'G1', 'C1', 'S1', 'S2']);
    expect(names(filterNodes(nodes, occ('occupied')))).toEqual(['N1', 'C1', 'S1']);
    expect(names(filterNodes(nodes, occ('free')))).toEqual(['N2', 'G1', 'C1', 'S2']);
    expect(names(filterNodes(nodes, { ...occ('occupied'), hiddenResources: new Set(['Desc_Water_C']) }))).toEqual(['N1']);
  });
  it('counts occupancy under the other filters and the others under occupancy', () => {
    const c = countNodes(nodes, { ...occ('occupied'), purities: new Set<Purity>(['pure', 'impure']) });
    expect(c.byOccupancy).toEqual({ all: 4, occupied: 2, free: 2 });
    expect(Object.fromEntries(c.byResource)).toEqual({ Desc_OreIron_C: 1, Desc_Water_C: 1 });
    expect(c.byPurity).toEqual({ impure: 1, normal: 0, pure: 1 });
  });
  it('without occupancy every node counts as free and nothing is filtered', () => {
    expect(countNodes(nodes, all()).byOccupancy).toEqual({ all: 5, occupied: 0, free: 5 });
  });
  it('summarises extractors per kind and their Power Shards', () => {
    expect(summarizeExtractors(byNode)).toEqual({ byKind: [['miner2', 1], ['pressurizer', 1], ['well', 1], ['portable', 1]], shards: 4, nodes: 3 });
  });
});

/**
 * Extractor buildings, their potential inventories and portable miners, shaped exactly as the parser returns them for
 * 1.2 saves (build 495413, save version 60): property shapes copied from a real save, names and values made up.
 */
const objRef = (name: string, pathName: string) => ({ type: 'ObjectProperty', name, propertyTagType: tag('ObjectProperty'), value: { levelName: 'Persistent_Level', pathName } });
const floatProp = (name: string, value: number) => ({ type: 'FloatProperty', name, propertyTagType: tag('FloatProperty'), value });
const LEVEL = 'Persistent_Level:PersistentLevel.';
const SHARD = '/Game/FactoryGame/Resource/Environment/Crystal/Desc_CrystalShard.Desc_CrystalShard_C';
const stack = (pathName: string, n: number) => ({
  type: 'InventoryStack',
  properties: {
    Item: {
      type: 'StructProperty', name: 'Item', propertyTagType: tag('StructProperty', [tag('InventoryItem', [tag('/Script/FactoryGame')])]), flags: 8,
      value: { itemReference: { levelName: '', pathName }, itemState: { hasValidStruct: false } },
    },
    NumItems: intProp('NumItems', n),
  },
});
const stacks = (values: ReturnType<typeof stack>[]) => ({
  type: 'ArrayProperty', name: 'mInventoryStacks',
  propertyTagType: tag('ArrayProperty', [tag('StructProperty', [tag('InventoryStack', [tag('/Script/FactoryGame')])])]),
  values,
});
const intArray = (name: string, values: number[]) => ({ type: 'ArrayProperty', name, propertyTagType: tag('ArrayProperty', [tag('IntProperty')]), values });
/** The building's `InventoryPotential` component: one slot per shard, `mInventoryStacks` absent when all are empty. */
const potentialInventory = (building: string, shards: number): Obj => ({
  typePath: '/Script/FactoryGame.FGInventoryComponent',
  instanceName: `${LEVEL}${building}.InventoryPotential`,
  properties: {
    ...(shards > 0 ? { mInventoryStacks: stacks([0, 1, 2].map(i => (i < shards ? stack(SHARD, 1) : stack('', 0)))) } : {}),
    mArbitrarySlotSizes: intArray('mArbitrarySlotSizes', [1, 1, 1]),
  },
});
const building = (cls: string, id: number, nodeName: string, potential?: { pending?: number; current?: number }, inventory = true): Obj => {
  const name = `${cls}_C_${id}`;
  return {
    typePath: `/Game/FactoryGame/Buildable/Factory/${cls}/${cls}.${cls}_C`,
    instanceName: `${LEVEL}${name}`,
    properties: {
      mExtractStartupTimer: floatProp('mExtractStartupTimer', 0),
      mExtractableResource: objRef('mExtractableResource', `${LEVEL}${nodeName}`),
      mPowerInfo: objRef('mPowerInfo', `${LEVEL}${name}.powerInfo`),
      ...(potential?.pending !== undefined ? { mPendingPotential: floatProp('mPendingPotential', potential.pending) } : {}),
      ...(inventory ? { mInventoryPotential: objRef('mInventoryPotential', `${LEVEL}${name}.InventoryPotential`) } : {}),
      ...(potential?.current !== undefined ? { mCurrentPotential: floatProp('mCurrentPotential', potential.current) } : {}),
      mIsProducing: boolProp('mIsProducing', false),
    },
  };
};
const portable = (id: number, nodeName: string): Obj => ({
  typePath: '/Game/FactoryGame/Equipment/PortableMiner/BP_PortableMiner.BP_PortableMiner_C',
  instanceName: `${LEVEL}BP_PortableMiner_C_${id}`,
  properties: {
    mExtractResourceNode: objRef('mExtractResourceNode', `${LEVEL}${nodeName}`),
    mOutputInventory: objRef('mOutputInventory', `${LEVEL}BP_PortableMiner_C_${id}.OutputInventory`),
  },
});

describe('extractResourceNodes: extractors', () => {
  const s = save(
    node('BP_ResourceNode586'), node('BP_ResourceNode540'), node('BP_ResourceNode172_UAID_40B076DF2F79DFD901_1471130569'),
    node('BP_ResourceNode9'), node('BP_ResourceNodeGeyser3', {}, 'BP_ResourceNodeGeyser'),
    node('BP_FrackingCore5', {}, 'BP_FrackingCore'), node('BP_FrackingSatellite33', {}, 'BP_FrackingSatellite'),
    // Default clock: no potential properties, an empty potential inventory.
    building('Build_MinerMk1', 2146959300, 'BP_ResourceNode586'), potentialInventory('Build_MinerMk1_C_2146959300', 0),
    // Overclocked with three shards; pending and current agree.
    building('Build_MinerMk2', 2147286205, 'BP_ResourceNode540', { pending: 2.25, current: 2.25 }), potentialInventory('Build_MinerMk2_C_2147286205', 3),
    // Pending set, current still at the default (seen in a real save): the set clock counts.
    building('Build_MinerMk1', 2146810277, 'BP_ResourceNode172_UAID_40B076DF2F79DFD901_1471130569', { pending: 1.125 }), potentialInventory('Build_MinerMk1_C_2146810277', 1),
    // Underclocked with a shard left in it: the shard counts, the clock is what the save says.
    building('Build_OilPump', 1, 'BP_ResourceNode9', { pending: 0.5, current: 0.5 }), potentialInventory('Build_OilPump_C_1', 1),
    building('Build_FrackingSmasher', 2, 'BP_FrackingCore5', { pending: 3, current: 3 }), potentialInventory('Build_FrackingSmasher_C_2', 3),
    building('Build_FrackingExtractor', 3, 'BP_FrackingSatellite33'), potentialInventory('Build_FrackingExtractor_C_3', 0),
    building('Build_GeneratorGeoThermal', 4, 'BP_ResourceNodeGeyser3', undefined, false),
    portable(2147178192, 'BP_ResourceNode586'), portable(2147256879, 'BP_ResourceNode586'),
    // Not on a node: water pumps (water volume), a miner whose node the save does not have.
    building('Build_WaterPump', 2147230012, 'FGWaterVolume35_5', { pending: 1.5, current: 1.5 }), potentialInventory('Build_WaterPump_C_2147230012', 1),
    building('Build_MinerMk3', 5, 'BP_ResourceNode999'),
  );

  it('reads building, linked node, clock speed and Power Shards per extractor', () => {
    expect(extractResourceNodes(s).extractors).toEqual([
      ['BP_FrackingCore5', 'pressurizer', 2.5, 3],
      ['BP_FrackingSatellite33', 'well', null, null],
      ['BP_ResourceNode172_UAID_40B076DF2F79DFD901_1471130569', 'miner1', 1.125, 1],
      ['BP_ResourceNode540', 'miner2', 2.25, 3],
      ['BP_ResourceNode586', 'miner1', 1, 0],
      ['BP_ResourceNode586', 'portable', null, null],
      ['BP_ResourceNode586', 'portable', null, null],
      ['BP_ResourceNode9', 'oil', 0.5, 1],
      ['BP_ResourceNodeGeyser3', 'geothermal', null, null],
    ]);
  });
  it('the geothermal generator has no clock speed or Power Shards, whatever potential properties the save holds', () => {
    const geo = save(
      node('BP_ResourceNodeGeyser3', {}, 'BP_ResourceNodeGeyser'),
      building('Build_GeneratorGeoThermal', 4, 'BP_ResourceNodeGeyser3', { pending: 2, current: 2 }), potentialInventory('Build_GeneratorGeoThermal_C_4', 2),
    );
    expect(extractResourceNodes(geo).extractors).toEqual([['BP_ResourceNodeGeyser3', 'geothermal', null, null]]);
  });
  it('a Resource Well Extractor has no clock speed of its own: it is set at the pressurizer', () => {
    const well = save(
      node('BP_FrackingSatellite33', {}, 'BP_FrackingSatellite'),
      building('Build_FrackingExtractor', 3, 'BP_FrackingSatellite33', { pending: 2, current: 2 }), potentialInventory('Build_FrackingExtractor_C_3', 2),
    );
    expect(extractResourceNodes(well).extractors).toEqual([['BP_FrackingSatellite33', 'well', null, null]]);
  });
  it('a save without extractors has none', () => {
    expect(extractResourceNodes(save(node('BP_ResourceNode586'))).extractors).toEqual([]);
  });
});

describe('isRandomized and changedNodeSettings', () => {
  it('is false without settings or with both switched off', () => {
    expect(isRandomized(null)).toBe(false);
    expect(isRandomized({ randomization: 'NRM_None', purity: 'NPS_NoChange', seed: 7 })).toBe(false);
    expect(isRandomized({ randomization: '0', purity: 'ENodePuritySettings::NPS_NoChange', seed: 7 })).toBe(false);
    expect(isRandomized({ randomization: null, purity: null, seed: 1234 })).toBe(false);
    expect(isRandomized({ randomization: null, purity: 'NPS_AllPure', seed: null })).toBe(true);
  });
  it('names the changed settings by enum member, also from the enum value or a qualified name', () => {
    expect(changedNodeSettings({ randomization: 'NRM_BasicReach', purity: 'NPS_NoChange', seed: 5 })).toEqual([
      { setting: 'randomization', member: 'NRM_BasicReach', raw: 'NRM_BasicReach' },
    ]);
    expect(changedNodeSettings({ randomization: '1', purity: 'ENodePuritySettings::NPS_Decrease', seed: null })).toEqual([
      { setting: 'randomization', member: 'NRM_Strict', raw: '1' },
      { setting: 'purity', member: 'NPS_Decrease', raw: 'ENodePuritySettings::NPS_Decrease' },
    ]);
  });
  it('keeps values it does not know as stored (and counts them as changed)', () => {
    expect(changedNodeSettings({ randomization: 'NRM_Future', purity: '9', seed: null })).toEqual([
      { setting: 'randomization', member: null, raw: 'NRM_Future' },
      { setting: 'purity', member: null, raw: '9' },
    ]);
  });
  it('lists the enum members in the game\'s order, the default first', () => {
    expect(NODE_RANDOMIZATION_MODES[0]).toBe('NRM_None');
    expect(NODE_RANDOMIZATION_MODES.indexOf('NRM_FossilFuelRich')).toBe(4);
    expect(NODE_PURITY_SETTINGS[0]).toBe('NPS_NoChange');
    expect(NODE_PURITY_SETTINGS.indexOf('NPS_Decrease')).toBe(6);
  });
});

describe('limits', () => {
  it('allows 250 % clock speed: 100 % plus three Power Shards of 50 % each', () => {
    expect(MAX_SHARDS).toBe(3);
    expect(MAX_CLOCK).toBe(1 + MAX_SHARDS * 0.5);
  });
});

const fixture = process.env.FICSMAP_SAVE_FIXTURE;
describe('real save', () => {
  it.skipIf(!fixture || !existsSync(fixture))('a world without randomisation has no node overrides', () => {
    const buf = readFileSync(fixture!);
    const parsed = Parser.ParseSave('fixture', buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
    const r = extractResourceNodes(parsed as unknown as SaveNodesLike);
    expect(r).toMatchObject({ overrides: [], settings: null });
    // Every extractor has a known kind and, for buildings, a clock within range and at most three shards.
    for (const [node, kind, clock, shards] of r.extractors ?? []) {
      expect(node).toMatch(/^BP_(ResourceNode|FrackingCore|FrackingSatellite)/);
      if (kind === 'portable' || kind === 'geothermal' || kind === 'well') expect([clock, shards]).toEqual([null, null]);
      else if (clock !== null) {
        expect(clock).toBeGreaterThan(0);
        expect(clock).toBeLessThanOrEqual(2.5);
        expect(shards).toBeLessThanOrEqual(3);
      }
    }
  }, 30_000);
});
