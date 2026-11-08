import { buildBuildingData, BuildingBuildError, buildingCategory, buildingIconClasses, buildingSummary, clearanceBox, docsClearanceBoxes, type RawBuildings } from '../../scripts/buildings.js';
import type { DocsClass } from '../../scripts/game-docs.js';
import { footprintRect, indexBuildings } from '../../src/shared/buildings.js';

// Cut-down copies of the extractor's buildings-raw.json and the Docs (1.2.5.0) for a few classes.
const v = (x: number, y: number, z: number) => ({ x, y, z });
const ID = { translation: v(0, 0, 0), rotation: [0, 0, 0, 1] as [number, number, number, number], scale: v(1, 1, 1) };
const box = (min: [number, number, number], max: [number, number, number], type: string | null = 'CT_Default', transform = ID) =>
  ({ min: v(...min), max: v(...max), type, excludeForSnapping: false, transform });
const raw = (over: Partial<RawBuildings['buildings'][string]>): RawBuildings['buildings'][string] => ({
  asset: '/Game/X', nativeClass: 'FGBuildable', parents: [], descriptor: null, displayName: null, clearance: null, grid: null, mesh: null, refs: [], ...over,
});
const desc = (cls: string) => ({ class: cls, category: null, subCategories: [], menuPriority: null });

const RAW = (): RawBuildings => ({
  gameVersion: '1.2.5.0',
  buildings: {
    Build_ConstructorMk1_C: raw({
      nativeClass: 'FGBuildableManufacturer', descriptor: desc('Desc_ConstructorMk1_C'),
      clearance: [
        box([-400, -500, 0], [400, 500, 600]),
        box([-20, -20, 0], [20, 20, 250], 'CT_Soft', { ...ID, translation: v(-165, -465, 600) }),
      ],
    }),
    Build_Foundation_8x4_01_C: raw({
      nativeClass: 'FGBuildableFoundationLightweight', descriptor: desc('Desc_Foundation_8x4_01_C'),
      clearance: [box([-400, -400, -200], [400, 400, 200], 'CT_Soft')],
      grid: { width: null, depth: null, height: 400, elevation: null, size: null },
    }),
    Build_ConveyorBeltMk1_C: raw({ nativeClass: 'FGBuildableConveyorBelt', descriptor: desc('Desc_ConveyorBeltMk1_C'), clearance: [] }),
    Build_ConveyorPole_C: raw({
      nativeClass: 'FGBuildablePoleConveyor', descriptor: desc('Desc_ConveyorPole_C'), clearance: [],
      mesh: { min: v(-44.958, -89.586, 0), max: v(44.958, 89.586, 92.019), source: 'mPoleVariations', meshes: ['SM_ConveyorPole_01'] },
    }),
    Build_TradingPost_C: raw({ nativeClass: 'FGBuildableTradingPost', descriptor: desc('Desc_TradingPost_C'), refs: ['Build_HubTerminal_C'] }),
    Build_HubTerminal_C: raw({
      nativeClass: 'FGBuildableHubTerminal',
      mesh: { min: v(-66.4, 10, 141.3), max: v(64.7, 103.3, 310.5), source: 'components', meshes: ['HubTerminalStage1and2_static'] },
    }),
    Build_CheatFluidPump_C: raw({ nativeClass: 'FGBuildablePipelinePump', displayName: 'Cheat Fluid Pump' }),
  },
  vehicles: {
    BP_Truck_C: raw({
      nativeClass: 'FGWheeledVehicle', descriptor: desc('Desc_Truck_C'),
      clearance: [box([-650, -350, 0], [450, 350, 550], 'CT_BlockEverything')],
    }),
  },
});

const clearanceText = '((ClearanceBox=(Min=(X=-400.000000,Y=-500.000000,Z=0.000000),Max=(X=400.000000,Y=500.000000,Z=600.000000),IsValid=True)),'
  + '(Type=CT_Soft,ClearanceBox=(Min=(X=-20.000000,Y=-20.000000,Z=0.000000),Max=(X=20.000000,Y=20.000000,Z=250.000000),IsValid=True),RelativeTransform=(Translation=(X=-165.000000,Y=-465.000000,Z=600.000000))))';
const docsClass = (NativeClass: string, ClassName: string, fields: Record<string, string>): DocsClass =>
  ({ NativeClass: `/Script/CoreUObject.Class'/Script/FactoryGame.${NativeClass}'`, ClassName, ...fields }) as DocsClass;
const DOCS = (lang: 'en' | 'de'): DocsClass[] => [
  docsClass('FGBuildableManufacturer', 'Build_ConstructorMk1_C', { mDisplayName: lang === 'en' ? 'Constructor' : 'Konstruktor', mClearanceData: clearanceText }),
  docsClass('FGBuildableFoundationLightweight', 'Build_Foundation_8x4_01_C', {
    mDisplayName: lang === 'en' ? 'Foundation (4 m)' : 'Fundament (4 m)',
    mClearanceData: '((Type=CT_Soft,ClearanceBox=(Min=(X=-400.000000,Y=-400.000000,Z=-200.000000),Max=(X=400.000000,Y=400.000000,Z=200.000000),IsValid=True)))',
    mWidth: '800.000000', mDepth: '800.000000', mHeight: '400.000000', mElevation: '0.000000',
  }),
  docsClass('FGBuildableConveyorBelt', 'Build_ConveyorBeltMk1_C', { mDisplayName: lang === 'en' ? 'Conveyor Belt Mk.1' : 'Förderband Mk.1', mClearanceData: '' }),
  docsClass('FGBuildablePoleConveyor', 'Build_ConveyorPole_C', { mDisplayName: lang === 'en' ? 'Conveyor Pole' : 'Förderbandstütze', mClearanceData: '' }),
  docsClass('FGBuildableTradingPost', 'Build_TradingPost_C', { mDisplayName: lang === 'en' ? 'The HUB' : 'Der HUB' }),
  docsClass('FGVehicleDescriptor', 'Desc_Truck_C', { mDisplayName: lang === 'en' ? 'Truck' : 'Lkw' }),
];
const ICONS = new Set(['Desc_ConstructorMk1_C', 'Desc_Foundation_8x4_01_C', 'Desc_ConveyorBeltMk1_C', 'Desc_Truck_C']);
const build = (r = RAW(), en = DOCS('en'), de = DOCS('de'), icons: ReadonlySet<string> | undefined = ICONS) => buildBuildingData(r, en, de, icons);
const problems = (f: () => unknown): string[] => {
  try { f(); } catch (e) { if (e instanceof BuildingBuildError) return e.problems; throw e; }
  return [];
};

describe('buildings dataset part', () => {
  it('builds the Constructor: Docs names, clearance boxes moved by their transform, soft flag, picture', () => {
    expect(build().buildings.Build_ConstructorMk1_C).toEqual({
      name: { en: 'Constructor', de: 'Konstruktor' },
      category: 'production',
      footprint: {
        boxes: [
          { min: [-400, -500, 0], max: [400, 500, 600] },
          { min: [-185, -485, 600], max: [-145, -445, 850], soft: true },
        ],
        source: 'clearance',
      },
      icon: 'Desc_ConstructorMk1_C',
    });
  });

  it('gives structural pieces their grid size, from the paks or else the Docs', () => {
    const f = build().buildings.Build_Foundation_8x4_01_C!;
    expect(f.category).toBe('structure');
    expect(f.size).toEqual({ w: 800, d: 800, h: 400 }); // mElevation 0 is left out
    expect(f.footprint?.boxes).toEqual([{ min: [-400, -400, -200], max: [400, 400, 200], soft: true }]);
    // no size for machines
    expect(build().buildings.Build_ConstructorMk1_C!.size).toBeUndefined();
  });

  it('gives belts no footprint and poles their mesh bounds', () => {
    const b = build().buildings;
    expect(b.Build_ConveyorBeltMk1_C).toEqual({ name: { en: 'Conveyor Belt Mk.1', de: 'Förderband Mk.1' }, category: 'logistics-belt', icon: 'Desc_ConveyorBeltMk1_C' });
    expect(b.Build_ConveyorPole_C!.footprint).toEqual({ boxes: [{ min: [-45, -89.6, 0], max: [45, 89.6, 92] }], source: 'mesh' });
    expect(b.Build_ConveyorPole_C!.icon).toBeUndefined(); // not in the icon set
  });

  it('names vehicles by their descriptor', () => {
    expect(build().buildings.BP_Truck_C).toMatchObject({ name: { en: 'Truck', de: 'Lkw' }, category: 'transport', vehicle: true, icon: 'Desc_Truck_C' });
  });

  it('marks names the game files do not have, and parts with their owner', () => {
    const b = build().buildings;
    expect(b.Build_HubTerminal_C).toMatchObject({
      name: { en: 'Build_HubTerminal_C', de: 'Build_HubTerminal_C' }, category: 'special', partOf: ['Build_TradingPost_C'], missing: ['name'],
    });
    expect(b.Build_CheatFluidPump_C).toMatchObject({ name: { en: 'Cheat Fluid Pump', de: 'Cheat Fluid Pump' }, missing: ['nameDe'] });
    expect(b.Build_ConstructorMk1_C!.missing).toBeUndefined();
  });

  it('adds pictures only for descriptors in the icon set', () => {
    const f = buildBuildingData(RAW(), DOCS('en'), DOCS('de'));
    expect(Object.values(f.buildings).some(b => b.icon)).toBe(false);
    expect([...buildingIconClasses(build())].sort()).toEqual([...ICONS].sort());
  });

  it('fails when the paks and the Docs disagree or a Docs buildable is missing', () => {
    const r = RAW();
    r.buildings.Build_ConstructorMk1_C!.clearance![0]!.max.z = 700;
    expect(problems(() => build(r))).toEqual([expect.stringMatching(/Build_ConstructorMk1_C: clearance boxes differ/)]);

    const g = RAW();
    g.buildings.Build_Foundation_8x4_01_C!.grid!.height = 200;
    expect(problems(() => build(g))).toEqual(['Build_Foundation_8x4_01_C: mHeight is 200 in the paks but 400 in the Docs']);

    const m = RAW();
    delete m.buildings.Build_ConveyorPole_C;
    expect(problems(() => build(m))).toEqual(['Build_ConveyorPole_C (FGBuildablePoleConveyor) is in the Docs but not in buildings-raw.json']);

    expect(problems(() => build(RAW(), DOCS('en'), DOCS('de').filter(c => c.ClassName !== 'Build_ConstructorMk1_C'))))
      .toEqual(['Build_ConstructorMk1_C is in en-US.json but not in de.json']);
  });

  it('summarises footprint sources, pictures and name gaps', () => {
    const s = buildingSummary(build());
    expect(s).toMatchObject({ total: 8, vehicles: 1, bySource: { clearance: 3, mesh: 2, none: 3 }, withIcon: 4, nameGaps: ['Build_HubTerminal_C'] });
  });
});

describe('building categories', () => {
  it('sorts by native class, shared native classes by name, vehicles as transport', () => {
    expect(buildingCategory('Build_SmelterMk1_C', 'FGBuildableManufacturer')).toBe('production');
    expect(buildingCategory('Build_Wall_8x4_01_C', 'FGBuildableWallLightweight')).toBe('structure');
    expect(buildingCategory('Build_PipeHyperSupport_C', 'FGBuildablePolePipe')).toBe('hypertube');
    expect(buildingCategory('Build_PipelineSupport_C', 'FGBuildablePolePipe')).toBe('logistics-pipe');
    expect(buildingCategory('Build_ConveyorPoleWall_C', 'FGBuildable')).toBe('logistics-belt');
    expect(buildingCategory('Build_FoundationPassthrough_Lift_C', 'FGBuildablePassthrough')).toBe('logistics-belt');
    expect(buildingCategory('Build_LookoutTower_C', 'FGBuildable')).toBe('special');
    expect(buildingCategory('Build_LargeFan_C', 'FGBuildable')).toBe('other');
    expect(buildingCategory('Build_StreetLight_C', 'FGBuildableLightSource')).toBe('other');
    expect(buildingCategory('BP_Truck_C', 'FGWheeledVehicle', true)).toBe('transport');
    expect(buildingCategory('Build_X_C', null)).toBe('other');
  });
});

describe('clearance geometry', () => {
  it('scales, rotates and moves a box', () => {
    // 90° about z: (x, y) -> (-y, x)
    const q = [0, 0, Math.SQRT1_2, Math.SQRT1_2] as [number, number, number, number];
    expect(clearanceBox(box([0, -10, 0], [100, 10, 50], 'CT_Default', { translation: v(1000, 0, 0), rotation: q, scale: v(2, 1, 1) })))
      .toEqual({ min: [990, 0, 0], max: [1010, 200, 50] });
    // the game's Miner Mk.2 has a soft box with z scale 0; kept as the data says
    expect(clearanceBox(box([-30, -30, 0], [30, 30, 100], 'CT_Soft', { ...ID, scale: v(1, 1, 0) }))).toEqual({ min: [-30, -30, 0], max: [30, 30, 0], soft: true });
    expect(clearanceBox(box([-1, -2, -3], [1, 2, 3], null, null as never))).toEqual({ min: [-1, -2, -3], max: [1, 2, 3] });
  });

  it('reads the boxes of a Docs mClearanceData text', () => {
    expect(docsClearanceBoxes(clearanceText)).toEqual([[-400, -500, 0, 400, 500, 600], [-20, -20, 0, 20, 20, 250]]);
    expect(docsClearanceBoxes('')).toEqual([]);
    expect(docsClearanceBoxes(undefined)).toEqual([]);
  });
});

describe('buildings reader', () => {
  it('finds classes case-insensitively and lists them per category', () => {
    const idx = indexBuildings({ version: '1.2.5.0', buildings: { BUILD_Potty_mk1_C: { name: { en: 'x', de: 'x' }, category: 'special' }, Build_A_C: { name: { en: 'a', de: 'a' }, category: 'special' } } });
    expect(idx.get('BUILD_Potty_mk1_C')?.name.en).toBe('x');
    expect(idx.get('Build_Potty_Mk1_C')?.name.en).toBe('x');
    expect(idx.get('Build_None_C')).toBeUndefined();
    expect(idx.byCategory.get('special')).toEqual(['BUILD_Potty_mk1_C', 'Build_A_C']);
  });

  it('outlines a footprint without soft boxes unless all are soft', () => {
    const b = build().buildings;
    expect(footprintRect(b.Build_ConstructorMk1_C!)).toEqual({ minX: -400, minY: -500, maxX: 400, maxY: 500 });
    expect(footprintRect(b.Build_Foundation_8x4_01_C!)).toEqual({ minX: -400, minY: -400, maxX: 400, maxY: 400 });
    expect(footprintRect(b.Build_ConveyorBeltMk1_C!)).toBeNull();
  });
});
