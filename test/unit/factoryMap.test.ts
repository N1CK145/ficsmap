import { indexBuildings, type BuildingsFile } from '../../src/shared/buildings.js';
import type { FactorySnapshot } from '../../src/shared/factory/snapshot.js';
import { changesBox, diffGeometry, type DiffOverlay } from '../../src/web/features/factory/map/diff.js';
import { buildingLook, detailAt, metresPerMapUnit, PICTURE_MIN_PX, scaledLineWidth } from '../../src/web/features/factory/map/lod.js';
import { routePath, vehicleRoute } from '../../src/web/features/factory/map/routes.js';
import {
  boundsOfIds, buildScene, floorRect, insideOutline, mapTransform, pickBuilding, placeBuilding, rectCorners, splitBoxes,
} from '../../src/web/features/factory/map/scene.js';
import { BANDS } from '../../src/shared/factory/analysis.js';
import { bandLook, lineAlpha, lineStyle, lineWidthPx, machineBand, mapKind, productivityOf } from '../../src/web/features/factory/map/style.js';

/** A 256 000 cm square world: one map unit is 1000 cm (10 m). */
const BOUNDS = { minX: 0, minY: 0, maxX: 256_000, maxY: 256_000 };

const FILE: BuildingsFile = {
  version: 'test',
  buildings: {
    Build_ConstructorMk1_C: {
      name: { en: 'Constructor', de: 'Konstruktor' }, category: 'production', icon: 'Desc_ConstructorMk1_C',
      footprint: { source: 'clearance', boxes: [
        { min: [-400, -500, 0], max: [400, 500, 600] },
        { min: [-185, -485, 600], max: [-145, -445, 850], soft: true },
      ] },
    },
    Build_ConveyorAttachmentSplitter_C: {
      name: { en: 'Conveyor Splitter', de: 'Förderbandsplitter' }, category: 'logistics-belt',
      footprint: { source: 'clearance', boxes: [{ min: [-200, -200, -80], max: [200, 200, 180], soft: true }] },
    },
    Build_Foundation_8x4_01_C: {
      name: { en: 'Foundation', de: 'Fundament' }, category: 'structure', size: { w: 800, d: 800, h: 400 },
      footprint: { source: 'clearance', boxes: [{ min: [-400, -400, -200], max: [400, 400, 200], soft: true }] },
    },
    Build_Ramp_8x4_01_C: { name: { en: 'Ramp', de: 'Rampe' }, category: 'structure', size: { w: 800, d: 1600 } },
    Build_TruckStation_C: {
      name: { en: 'Truck Station', de: 'Lkw-Station' }, category: 'transport',
      footprint: { source: 'clearance', boxes: [{ min: [-600, -1300, 0], max: [1100, -400, 620] }] },
    },
    BP_Truck_C: {
      name: { en: 'Truck', de: 'Lkw' }, category: 'transport', vehicle: true,
      footprint: { source: 'clearance', boxes: [{ min: [-650, -350, 0], max: [450, 350, 550] }] },
    },
  },
};
const INDEX = indexBuildings(FILE);

function snapshot(patch: Partial<FactorySnapshot> = {}): FactorySnapshot {
  return {
    v: 1, meta: { sessionName: 'S', saveTime: 1, build: 1 },
    buildings: [], lightweight: [], splines: [], powerLines: [], pathNetworks: [], stations: [], vehicles: [], markers: [], crates: [],
    ...patch,
  };
}

describe('factory map geometry', () => {
  it('places a local rectangle with the yaw (0 = +x, positive turns +x towards +y)', () => {
    const r = { minX: 0, minY: 0, maxX: 100, maxY: 50 };
    expect(rectCorners(1000, 2000, 0, r)).toEqual([1000, 2000, 1100, 2000, 1100, 2050, 1000, 2050]);
    const turned = rectCorners(0, 0, 90, r).map(v => Math.round(v));
    // +x of the actor points to +y of the world: its 100 cm long side runs along y.
    expect(turned).toEqual([0, 0, 0, 100, -50, 100, -50, 0]);
  });

  it('maps world cm to map units linearly over the bounds', () => {
    const t = mapTransform(BOUNDS);
    expect(t.x(0)).toBe(0);
    expect(t.x(256_000)).toBe(256);
    expect(t.y(128_000)).toBe(128);
    expect(metresPerMapUnit(BOUNDS)).toBe(10);
  });

  it('draws a machine body from its hard boxes and keeps soft boxes apart; all-soft footprints are the body', () => {
    const c = splitBoxes(INDEX.get('Build_ConstructorMk1_C'));
    expect(c.hard).toHaveLength(1);
    expect(c.soft).toHaveLength(1);
    const s = splitBoxes(INDEX.get('Build_ConveyorAttachmentSplitter_C'));
    expect(s.hard).toHaveLength(1);
    expect(s.soft).toHaveLength(0);
    expect(splitBoxes(undefined)).toEqual({ hard: [], soft: [] });
  });

  it('places a building: outline corners, centre, sides in map units, band and reasons', () => {
    const t = mapTransform(BOUNDS);
    const sb = placeBuilding(
      { id: 'c1', cls: 'Build_ConstructorMk1_C', x: 10_000, y: 20_000, z: 0, yaw: 0, prod: { clock: 1, productivity: 0.3, issues: ['blocked'] } },
      INDEX.get('Build_ConstructorMk1_C'), t,
    );
    expect(sb.cx).toBe(10);
    expect(sb.cy).toBe(20);
    expect(sb.minSide).toBeCloseTo(0.8);
    expect(sb.maxSide).toBeCloseTo(1);
    expect(sb.hard).toHaveLength(8);
    expect(sb.soft).toHaveLength(8);
    expect(sb.kind).toBe('production');
    expect(sb.band).toBe('throttled');
    expect(sb.reasons).toEqual(['blocked']);
    expect([sb.minX, sb.maxX, sb.minY, sb.maxY]).toEqual([9.6, 10.4, 19.5, 20.5]);
  });

  it('uses the footprint, else the grid size, else 8 m for floor pieces', () => {
    expect(floorRect(INDEX.get('Build_Foundation_8x4_01_C'))).toEqual({ minX: -400, minY: -400, maxX: 400, maxY: 400 });
    expect(floorRect(INDEX.get('Build_Ramp_8x4_01_C'))).toEqual({ minX: -400, minY: -800, maxX: 400, maxY: 800 });
    expect(floorRect(undefined)).toEqual({ minX: -400, minY: -400, maxX: 400, maxY: 400 });
  });

  it('tests points against the rotated outline', () => {
    const t = mapTransform(BOUNDS);
    const sb = placeBuilding({ id: 'c', cls: 'Build_ConstructorMk1_C', x: 50_000, y: 50_000, z: 0, yaw: 90 }, INDEX.get('Build_ConstructorMk1_C'), t);
    // Turned by 90°: 10 m along x, 8 m along y.
    expect(insideOutline(sb, 50.45, 50, t)).toBe(true);
    expect(insideOutline(sb, 50, 50.45, t)).toBe(false);
    expect(insideOutline(sb, 50, 50.45, t, 0.1)).toBe(true);
  });

  it('builds a scene: floor pieces apart from buildings, lines, stations with their flow, a hit grid', () => {
    const scene = buildScene(snapshot({
      buildings: [
        { id: 'c1', cls: 'Build_ConstructorMk1_C', x: 10_000, y: 10_000, z: 0, yaw: 0, prod: { clock: 1, productivity: 1 } },
        { id: 's1', cls: 'Build_ConveyorAttachmentSplitter_C', x: 10_000, y: 10_400, z: 0, yaw: 0 },
        { id: 'f1', cls: 'Build_Foundation_8x4_01_C', x: 0, y: 0, z: 0, yaw: 0 },
        { id: 'ts', cls: 'Build_TruckStation_C', x: 30_000, y: 30_000, z: 0, yaw: 0 },
      ],
      lightweight: [{ cls: 'Build_Foundation_8x4_01_C', xyzYaw: [10_000, 10_000, -200, 0, 10_800, 10_000, -200, 0] }],
      splines: [{ id: 'b1', cls: 'Build_ConveyorBeltMk3_C', pts: [0, 0, 0, 1000, 0, 0] }, { id: 'x', cls: 'Build_Unknown_C', pts: [0, 0, 0, 1, 1, 1] }],
      stations: [{ id: 'ts', cls: 'Build_TruckStation_C', x: 30_000, y: 30_000, z: 0, yaw: 0, loading: true, traffic: [{ vehicle: 'v', avgSecBetweenDocks: 60, avgItemsPerDock: 120 }] }],
      vehicles: [{ id: 'v', cls: 'BP_Truck_C', x: 5000, y: 5000, z: 0, yaw: 45, autopilot: true, route: ['ts'] }],
      powerLines: [0, 0, 0, 1000, 1000, 0],
    }), INDEX, BOUNDS);
    expect(scene.buildings.map(b => b.b.id).sort()).toEqual(['c1', 's1', 'ts']);
    expect(scene.floor).toHaveLength(3 * 8);
    expect(scene.lines.map(l => l.id)).toEqual(['b1']);
    expect(scene.power).toHaveLength(4);
    expect(scene.stationById.get('ts')!.flow.itemsPerMin).toBe(120);
    expect(scene.stationById.get('ts')!.state).toBe('active');
    // Where they overlap the machine wins (it is drawn on top); beyond its edge the splitter.
    expect(pickBuilding(scene, 10, 10.4)?.b.id).toBe('c1');
    expect(pickBuilding(scene, 10, 10.55)?.b.id).toBe('s1');
    expect(pickBuilding(scene, 10, 9.8)?.b.id).toBe('c1');
    expect(pickBuilding(scene, 100, 100)).toBeNull();
    expect(boundsOfIds(scene, ['c1', 'v'])).toEqual({ minX: 5, minY: 5, maxX: 10.4, maxY: 10.5 });
  });
});

describe('factory map levels of detail', () => {
  it('shows dots zoomed out, then boxes, pictures and names as the building grows', () => {
    expect(detailAt(3).dots).toBe(true);
    expect(detailAt(4).dots).toBe(false);
    expect(detailAt(4).outlines).toBe(false);
    expect(detailAt(5).outlines).toBe(true);
    expect(detailAt(3).lines).toBe(false);
    expect(detailAt(4).lines).toBe(true);
    expect(detailAt(7).softBoxes).toBe(false);
    expect(detailAt(8).softBoxes).toBe(true);
    // A Constructor is 8 m wide; in 1.2 a map unit is about 29.3 m.
    const side = 8 / 29.3;
    expect(buildingLook(3, side)).toBe('dot');
    expect(buildingLook(5, side)).toBe('box');
    expect(buildingLook(7, side)).toBe('picture');
    expect(side * 2 ** 7).toBeGreaterThanOrEqual(PICTURE_MIN_PX);
    expect(buildingLook(9, side)).toBe('labelled');
  });

  it('widens lines from zoom 7 on', () => {
    expect(scaledLineWidth(2, 5)).toBe(2);
    expect(scaledLineWidth(2, 7)).toBe(2);
    expect(scaledLineWidth(2, 9)).toBeCloseTo(2 * 2 ** 1.5);
  });
});

describe('factory map styles', () => {
  it('knows belts, pipes, hypertubes, roads and rails with their tier', () => {
    expect(lineStyle('Build_ConveyorBeltMk6_C')).toEqual({ kind: 'belt', tier: 6 });
    expect(lineStyle('Build_PipelineMK2_C')).toEqual({ kind: 'pipe', tier: 2 });
    expect(lineStyle('Build_Pipeline_NoIndicator_C')).toEqual({ kind: 'pipe', tier: 1 });
    expect(lineStyle('Build_PipeHyper_C')?.kind).toBe('hyper');
    expect(lineStyle('Build_VehiclePath_Universal_C')?.kind).toBe('road');
    expect(lineStyle('Build_RailroadTrack_C')?.kind).toBe('rail');
    expect(lineStyle('Build_Nothing_C')).toBeNull();
    expect(lineWidthPx({ kind: 'belt', tier: 6 })).toBeGreaterThan(lineWidthPx({ kind: 'belt', tier: 1 }));
    expect(lineAlpha({ kind: 'belt', tier: 6 })).toBeGreaterThan(lineAlpha({ kind: 'belt', tier: 1 }));
  });

  it('bands machines like the factory page (measured, else producing = 100 %)', () => {
    expect(machineBand(undefined)).toBeNull();
    expect(machineBand({ clock: 1, productivity: 0.005 })).toBe('idle');
    expect(machineBand({ clock: 1, productivity: 0.5 })).toBe('throttled');
    expect(machineBand({ clock: 1, productivity: 0.95 })).toBe('high');
    expect(machineBand({ clock: 1, productivity: 0.995 })).toBe('full');
    expect(productivityOf({ clock: 1, producing: true })).toBe(1);
    expect(productivityOf({ clock: 1 })).toBe(0);
    expect(mapKind('power-storage')).toBe('power');
    expect(mapKind('power-pole')).toBe('logistics');
    expect(mapKind(undefined)).toBe('building');
  });
});

describe('factory map changes', () => {
  it('compares floor pieces by class and position and lines by id', () => {
    const before = snapshot({
      lightweight: [{ cls: 'F', xyzYaw: [0, 0, 0, 0, 800, 0, 0, 0] }],
      splines: [{ id: 'a', cls: 'Build_ConveyorBeltMk1_C', pts: [0, 0, 0, 1, 0, 0] }, { id: 'gone', cls: 'Build_ConveyorBeltMk1_C', pts: [0, 0, 0, 1, 0, 0] }],
    });
    const after = snapshot({
      lightweight: [{ cls: 'F', xyzYaw: [0, 0, 0, 0, 0, 800, 0, 0] }],
      splines: [{ id: 'a', cls: 'Build_ConveyorBeltMk1_C', pts: [0, 0, 0, 1, 0, 0] }, { id: 'new', cls: 'Build_ConveyorBeltMk1_C', pts: [0, 0, 0, 1, 0, 0] }],
    });
    const d = diffGeometry(before, after);
    expect(d.floorAdded.map(p => [p.x, p.y])).toEqual([[0, 800]]);
    expect(d.floorRemoved.map(p => [p.x, p.y])).toEqual([[800, 0]]);
    expect([...d.linesAdded]).toEqual(['new']);
    expect(d.linesRemoved.map(l => l.id)).toEqual(['gone']);
  });
});

describe('vehicle routes on the roads', () => {
  const road = (id: string, ...xy: number[]) => ({ id, cls: 'Build_VehiclePath_Universal_C', pts: xy.flatMap((v, i) => (i % 2 === 1 ? [v, 0] : [v])) });
  const station = (id: string, x: number, y: number) => ({ id, cls: 'Build_TruckStation_C', x, y, z: 0, yaw: 0, traffic: [] });

  it('follows the shortest way along the road segments between consecutive stops, back to the first', () => {
    const s = snapshot({
      // A–B straight (10 m), B–C, and a long detour A–D–C.
      splines: [road('ab', 0, 0, 1000, 0), road('bc', 1000, 0, 2000, 0), road('ad', 0, 0, 0, 5000), road('dc', 0, 5000, 2000, 0)],
      stations: [station('A', 0, 100), station('C', 2000, 100)],
    });
    const legs = routePath(s, ['A', 'C']);
    expect(legs).toHaveLength(2);
    // Station, road A → B → C, station.
    expect(legs[0]!.map(p => p.x)).toEqual([0, 0, 1000, 1000, 2000, 2000]);
    expect(legs[1]![0]).toEqual({ x: 2000, y: 100 });
  });

  it('draws a straight line where no road connects the stops', () => {
    const s = snapshot({ splines: [road('ab', 0, 0, 1000, 0)], stations: [station('A', 0, 0), station('Z', 90_000, 0)] });
    expect(routePath(s, ['A', 'Z'])[0]).toEqual([{ x: 0, y: 0 }, { x: 90_000, y: 0 }]);
    expect(routePath(s, ['A'])).toEqual([]);
  });
});

describe('factory map productivity looks', () => {
  it('draws problems on top and gives every band a second cue besides its colour', () => {
    const ranks = BANDS.map(b => bandLook(b).rank);
    expect(new Set(ranks).size).toBe(BANDS.length);
    expect(bandLook('idle').rank).toBe(Math.max(...ranks));
    expect(bandLook('full').tint).toBeLessThan(bandLook('idle').tint);
    // Full and nearly full differ by more than their colour (dots), as do throttled (stripes) and standing (cross).
    expect(new Set(BANDS.map(b => bandLook(b).pattern)).size).toBe(BANDS.length);
    expect(new Set(BANDS.map(b => bandLook(b).dot)).size).toBe(BANDS.length);
  });

  it('keeps paused machines and their product apart in the scene', () => {
    const analysis = {
      byId: new Map([['c1', { outputs: [{ item: 'Desc_IronScrew_C', nominal: 60, actual: 30, lost: 30 }], reasons: ['starved'] }]]),
    } as unknown as Parameters<typeof buildScene>[3];
    const scene = buildScene(snapshot({
      buildings: [
        { id: 'c1', cls: 'Build_ConstructorMk1_C', x: 10_000, y: 10_000, z: 0, yaw: 0, prod: { clock: 1, productivity: 0.5 } },
        { id: 'c2', cls: 'Build_ConstructorMk1_C', x: 20_000, y: 10_000, z: 0, yaw: 0, prod: { clock: 1, productivity: 0, paused: true } },
      ],
    }), INDEX, BOUNDS, analysis);
    expect(scene.byId.get('c1')).toMatchObject({ paused: false, product: 'Desc_IronScrew_C', reasons: ['starved'] });
    expect(scene.byId.get('c2')).toMatchObject({ paused: true, product: undefined });
  });
});

describe('the selected vehicle\'s route', () => {
  it('marks the legs into stops where the vehicle moves nothing', () => {
    const traffic = (items: number) => [{ vehicle: 'v', avgSecBetweenDocks: 60, avgItemsPerDock: items }];
    const scene = buildScene(snapshot({
      stations: [
        { id: 'A', cls: 'Build_TruckStation_C', x: 10_000, y: 10_000, z: 0, yaw: 0, loading: true, traffic: traffic(100) },
        { id: 'B', cls: 'Build_TruckStation_C', x: 50_000, y: 10_000, z: 0, yaw: 0, loading: false, traffic: traffic(0) },
      ],
      vehicles: [{ id: 'v', cls: 'BP_Truck_C', x: 5000, y: 5000, z: 0, yaw: 0, autopilot: true, route: ['A', 'B'] }],
    }), INDEX, BOUNDS);
    const route = vehicleRoute(scene, 'v')!;
    // A → B ends where nothing moves, B → A does not.
    expect(route.legs.map(l => l.zero)).toEqual([true, false]);
    expect(route.stops.map(s => [s.label, s.zero])).toEqual([['1', false], ['2', true]]);
    expect(vehicleRoute(scene, 'nope')).toBeNull();
  });
});

describe('going to the changes', () => {
  const empty = { added: new Set<string>(), removed: [], productivity: new Map(), floorAdded: new Float32Array(), floorRemoved: new Float32Array(), linesAdded: new Set<string>(), linesRemoved: [] };
  it('frames the busiest area of added, removed and changed buildings, else the changed floor', () => {
    const scene = buildScene(snapshot({
      buildings: [
        { id: 'c1', cls: 'Build_ConstructorMk1_C', x: 10_000, y: 10_000, z: 0, yaw: 0, prod: { clock: 1, productivity: 1 } },
        { id: 'c2', cls: 'Build_ConstructorMk1_C', x: 90_000, y: 10_000, z: 0, yaw: 0, prod: { clock: 1, productivity: 1 } },
      ],
    }), INDEX, BOUNDS);
    const ghost = (id: string, x: number) => placeBuilding({ id, cls: 'Build_ConstructorMk1_C', x, y: 10_000, z: 0, yaw: 0 }, INDEX.get('Build_ConstructorMk1_C'), scene.t);
    // c1 and a ghost next to it outweigh the lone change at c2, 80 map units away.
    const diff: DiffOverlay = { ...empty, added: new Set(['c1', 'c2']), removed: [ghost('g', 14_000)] };
    const box = changesBox(scene, diff)!;
    expect([box.minX, box.minY, box.maxX, box.maxY].map(v => Math.round(v * 10) / 10)).toEqual([9.6, 9.5, 14.4, 10.5]);
    expect(changesBox(scene, { ...empty, floorAdded: new Float32Array([1, 2, 3, 2, 3, 4, 1, 4]) })).toEqual({ minX: 1, minY: 2, maxX: 3, maxY: 4 });
    expect(changesBox(scene, empty)).toBeNull();
  });
});
