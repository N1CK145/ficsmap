import { readConnections } from '../../src/shared/factory/connections.js';
import { extractFactory, type FactoryObject } from '../../src/shared/factory/extract.js';

// Hand-made objects in the shapes parser 4.1.2 returns for 1.2 saves (port names as in the Letz Fetz save of 2026-11-08).

const P = 'Persistent_Level:PersistentLevel.';
const ID = { rotation: { x: 0, y: 0, z: 0, w: 1 }, translation: { x: 0, y: 0, z: 0 } };
const actor = (cls: string, n: number, extra: Partial<FactoryObject> = {}): FactoryObject => ({
  typePath: `/Game/FactoryGame/Buildable/Factory/X/${cls.replace(/_C$/, '')}.${cls}`, instanceName: `${P}${cls}_${n}`, type: 'SaveEntity', transform: ID, properties: {}, ...extra,
});
const ref = (path: string) => ({ value: { levelName: 'Persistent_Level', pathName: path } });
const port = (type: string, owner: string, name: string, to?: string, net?: number): FactoryObject => ({
  typePath: `/Script/FactoryGame.${type}`, instanceName: `${P}${owner}.${name}`, type: 'SaveComponent',
  properties: { ...(to ? { mConnectedComponent: ref(`${P}${to}`) } : {}), ...(net !== undefined ? { mPipeNetworkID: { value: net } } : {}) },
});
/** Both ends of a belt connection (the save stores it on both). */
const belt = (a: string, b: string) => [port('FGFactoryConnectionComponent', a.split('.')[0]!, a.split('.')[1]!, b), port('FGFactoryConnectionComponent', b.split('.')[0]!, b.split('.')[1]!, a)];
const pipe = (a: string, b: string, net = 7) => [port('FGPipeConnectionComponent', a.split('.')[0]!, a.split('.')[1]!, b, net), port('FGPipeConnectionComponent', b.split('.')[0]!, b.split('.')[1]!, a, net)];
const ids = (objs: FactoryObject[]) => new Set(objs.filter(o => o.type === 'SaveEntity').map(o => o.instanceName.slice(P.length)));

const SM = 'Build_SmelterMk1_C_1', B1 = 'Build_ConveyorBeltMk2_C_10', LIFT = 'Build_ConveyorLiftMk1_C_11', B2 = 'Build_ConveyorBeltMk3_C_12';
const SPL = 'Build_ConveyorAttachmentSplitter_C_2', CON = 'Build_ConstructorMk1_C_3', B3 = 'Build_ConveyorBeltMk1_C_13';

describe('belt links', () => {
  const objects: FactoryObject[] = [
    actor('Build_SmelterMk1_C', 1), actor('Build_ConveyorAttachmentSplitter_C', 2), actor('Build_ConstructorMk1_C', 3),
    actor('Build_ConveyorBeltMk2_C', 10), actor('Build_ConveyorLiftMk1_C', 11), actor('Build_ConveyorBeltMk3_C', 12), actor('Build_ConveyorBeltMk1_C', 13),
    actor('Build_ConveyorBeltMk1_C', 14), actor('Build_ConveyorPole_C', 15),
    // smelter → belt Mk2 → lift Mk1 → belt Mk3 → splitter → belt Mk1 → constructor
    ...belt(`${SM}.Output2`, `${B1}.ConveyorAny0`), ...belt(`${B1}.ConveyorAny1`, `${LIFT}.ConveyorAny0`),
    ...belt(`${LIFT}.ConveyorAny1`, `${B2}.ConveyorAny0`), ...belt(`${B2}.ConveyorAny1`, `${SPL}.Input1`),
    ...belt(`${SPL}.Output1`, `${B3}.ConveyorAny0`), ...belt(`${B3}.ConveyorAny1`, `${CON}.Input0`),
    // a loose belt from the splitter's second output leads nowhere
    ...belt(`${SPL}.Output2`, 'Build_ConveyorBeltMk1_C_14.ConveyorAny0'),
    port('FGFactoryConnectionComponent', 'Build_ConveyorPole_C_15', 'SnapOnly0'),
    port('FGFactoryConnectionComponent', SM, 'Input0'),
    // items on the belts: one chain over belt Mk2, the lift and belt Mk3 (lengths 0–100, 100–400, 400–500)
    {
      typePath: '/Script/FactoryGame.FGConveyorChainActor', instanceName: `${P}FGConveyorChainActor_1`, type: 'SaveEntity',
      specialProperties: {
        type: 'ConveyorChainActorSpecialProperties',
        beltsInChain: [
          { beltRef: { pathName: `${P}${B2}` }, startsAtLength: 400, endsAtLength: 500 },
          { beltRef: { pathName: `${P}${LIFT}` }, startsAtLength: 100, endsAtLength: 400 },
          { beltRef: { pathName: `${P}${B1}` }, startsAtLength: 0, endsAtLength: 100 },
        ],
        items: [10, 150, 390, 480, 502].map(position => ({ item: { itemReference: { pathName: '/Game/X/Desc_IronIngot.Desc_IronIngot_C' } }, position })),
      },
    },
  ];

  it('walks from an output along belts and lifts to the next building, upstream first, with the slowest class and the items on the way', () => {
    const { links } = readConnections(objects, ids(objects));
    expect(links).toEqual([
      { from: SPL, to: CON, fromPort: 'Output1', toPort: 'Input0', kind: 'belt', via: [B3], slowest: 'Build_ConveyorBeltMk1_C' },
      { from: SM, to: SPL, fromPort: 'Output2', toPort: 'Input1', kind: 'belt', via: [B1, LIFT, B2], slowest: 'Build_ConveyorLiftMk1_C', items: { Desc_IronIngot_C: 5 } },
    ]);
  });

  it('leaves out links to buildings that are not in the snapshot', () => {
    const known = ids(objects);
    known.delete(CON);
    expect(readConnections(objects, known).links.map(l => l.to)).toEqual([SPL]);
  });

  it('a lift splitter: Top/Bottom connections take their direction from the lift end they meet', () => {
    const S = 'Build_ConveyorAttachmentSplitterLift_C_4', LA = 'Build_ConveyorLiftMk2_C_20', LB = 'Build_ConveyorLiftMk2_C_21';
    const objs = [
      actor('Build_SmelterMk1_C', 1), actor('Build_ConveyorAttachmentSplitterLift_C', 4), actor('Build_ConstructorMk1_C', 3),
      actor('Build_ConveyorLiftMk2_C', 20), actor('Build_ConveyorLiftMk2_C', 21),
      ...belt(`${SM}.Output2`, `${LA}.ConveyorAny0`), ...belt(`${LA}.ConveyorAny1`, `${S}.BottomConnection`),
      ...belt(`${S}.TopConnection`, `${LB}.ConveyorAny0`), ...belt(`${LB}.ConveyorAny1`, `${CON}.Input0`),
    ];
    expect(readConnections(objs, ids(objs)).links.map(l => [l.from, l.fromPort, l.to, l.toPort])).toEqual([
      [S, 'TopConnection', CON, 'Input0'],
      [SM, 'Output2', S, 'BottomConnection'],
    ]);
  });
});

describe('pipe links', () => {
  const W = 'Build_WaterPump_C_1', PU = 'Build_PipelinePump_C_2', J1 = 'Build_PipelineJunction_Cross_C_3', J2 = 'Build_PipelineJunction_Cross_C_4';
  const RF = 'Build_OilRefinery_C_5', GEN = 'Build_GeneratorCoal_C_6', T = 'Build_PipeStorageTank_C_7';
  const p1 = 'Build_Pipeline_C_10', p2 = 'Build_PipelineMK2_C_11', p3 = 'Build_PipelineMK2_C_12', p4 = 'Build_Pipeline_C_13', p5 = 'Build_PipelineMK2_C_14';
  const objects: FactoryObject[] = [
    ...[W, PU, J1, J2, RF, GEN, T, p1, p2, p3, p4, p5].map(id => actor(id.replace(/_\d+$/, ''), Number(id.split('_').pop()))),
    // extractor → pipe Mk1 → pump (Connection0 in, Connection1 out) → pipe Mk2 → junction 1
    ...pipe(`${W}.FGPipeConnectionFactory`, `${p1}.PipelineConnection1`), ...pipe(`${p1}.PipelineConnection0`, `${PU}.Connection0`),
    ...pipe(`${PU}.Connection1`, `${p2}.PipelineConnection0`), ...pipe(`${p2}.PipelineConnection1`, `${J1}.Connection0`),
    // junction 1 → junction 2 (no direction of their own: away from the extractor) → generator
    ...pipe(`${J1}.Connection1`, `${p3}.PipelineConnection1`), ...pipe(`${p3}.PipelineConnection0`, `${J2}.Connection2`),
    ...pipe(`${J2}.Connection0`, `${p4}.PipelineConnection0`), ...pipe(`${p4}.PipelineConnection1`, `${GEN}.FGPipeConnectionFactory`),
    // the refinery's output goes into a fluid buffer: the buffer is downstream
    ...pipe(`${RF}.PipeOutputFactory`, `${p5}.PipelineConnection1`, 9), ...pipe(`${p5}.PipelineConnection0`, `${T}.ConnectionAny0`, 9),
    { typePath: '/Script/FactoryGame.FGPipeNetwork', instanceName: `${P}FGPipeNetwork_1`, type: 'SaveEntity', properties: { mPipeNetworkID: { value: 7 }, mFluidDescriptor: { value: { levelName: '', pathName: '/Game/X/Desc_Water.Desc_Water_C' } } } },
  ];

  it('orients pipes by producing and consuming ports, pumps (0 in, 1 out) and, between junctions, away from producers', () => {
    const { links } = readConnections(objects, ids(objects));
    const brief = links.map(l => [l.from, l.to, l.via.join(','), l.slowest, l.fluid]);
    expect(brief).toEqual([
      [RF, T, p5, 'Build_PipelineMK2_C', undefined],
      [J1, J2, p3, 'Build_PipelineMK2_C', 'Desc_Water_C'],
      [J2, GEN, p4, 'Build_Pipeline_C', 'Desc_Water_C'],
      [PU, J1, p2, 'Build_PipelineMK2_C', 'Desc_Water_C'],
      [W, PU, p1, 'Build_Pipeline_C', 'Desc_Water_C'],
    ]);
    expect(links.every(l => l.kind === 'pipe')).toBe(true);
    expect(links.find(l => l.from === J1)).toMatchObject({ fromPort: 'Connection1', toPort: 'Connection2' });
  });
});

describe('power circuits', () => {
  it('lists the buildings per circuit without poles, with a blown fuse', () => {
    const objects: FactoryObject[] = [
      actor('Build_ConstructorMk1_C', 1), actor('Build_PowerPoleMk1_C', 2), actor('Build_GeneratorCoal_C', 3),
      {
        typePath: '/Script/FactoryGame.FGPowerCircuit', instanceName: `${P}CircuitSubsystem.FGPowerCircuit_1`, type: 'SaveEntity',
        properties: {
          mCircuitID: { value: 4 }, mIsFuseTriggered: { value: false, flags: 0x10 },
          mComponents: { values: ['Build_ConstructorMk1_C_1.PowerInput', 'Build_PowerPoleMk1_C_2.PowerConnection', 'Build_GeneratorCoal_C_3.PowerConnection', 'Build_Gone_C_9.PowerInput'].map(c => ({ pathName: `${P}${c}` })) },
        },
      },
      { typePath: '/Script/FactoryGame.FGPowerCircuit', instanceName: `${P}CircuitSubsystem.FGPowerCircuit_2`, type: 'SaveEntity', properties: { mCircuitID: { value: 5 }, mComponents: { values: [{ pathName: `${P}Build_PowerPoleMk1_C_2.PowerConnection` }] } } },
    ];
    expect(readConnections(objects, ids(objects)).circuits).toEqual([
      { id: 4, buildings: ['Build_ConstructorMk1_C_1', 'Build_GeneratorCoal_C_3'], fuseTriggered: true },
    ]);
  });
});

describe('extractFactory', () => {
  it('fills links and circuits', () => {
    const objects: FactoryObject[] = [
      actor('Build_SmelterMk1_C', 1), actor('Build_ConstructorMk1_C', 3),
      ...belt(`${SM}.Output2`, `${B3}.ConveyorAny0`), ...belt(`${B3}.ConveyorAny1`, `${CON}.Input0`),
    ];
    const s = extractFactory({ header: { sessionName: 'T', saveDateTime: '1', buildVersion: 1 }, levels: { L: { objects } } });
    expect(s.links).toEqual([{ from: SM, to: CON, fromPort: 'Output2', toPort: 'Input0', kind: 'belt', via: [B3], slowest: 'Build_ConveyorBeltMk1_C' }]);
    expect(s.circuits).toEqual([]);
  });
});
