import { indexBuildings, type BuildingsFile } from '../../src/shared/buildings.js';
import type { FactorySnapshot, SnapshotBuilding } from '../../src/shared/factory/snapshot.js';
import {
  belowScene, detectFloors, filterDiff, filterScene, floorStops, heightProfile, nextStop, normalizeRange, outsideIds, profileOf,
  rangeFits, widenTo, type HeightProfile,
} from '../../src/web/features/factory/map/height.js';
import { keyStep, rangeText } from '../../src/web/features/factory/map/HeightSlider.js';
import { buildScene, floorLevel, placeBuilding, zExtent, type Scene } from '../../src/web/features/factory/map/scene.js';
import type { DiffOverlay } from '../../src/web/features/factory/map/diff.js';

/** A 256 000 cm square world: one map unit is 1000 cm (10 m). */
const BOUNDS = { minX: 0, minY: 0, maxX: 256_000, maxY: 256_000 };

const FILE: BuildingsFile = {
  version: 'test',
  buildings: {
    Build_ConstructorMk1_C: {
      name: { en: 'Constructor', de: 'Konstruktor' }, category: 'production',
      footprint: { source: 'clearance', boxes: [
        { min: [-400, -500, 0], max: [400, 500, 600] },
        { min: [-185, -485, 600], max: [-145, -445, 850], soft: true },
      ] },
    },
    Build_OilRefinery_C: {
      name: { en: 'Refinery', de: 'Raffinerie' }, category: 'production',
      footprint: { source: 'clearance', boxes: [{ min: [-500, -1100, 0], max: [500, 1100, 3000] }] },
    },
    Build_PowerPoleMk1_C: {
      name: { en: 'Power Pole', de: 'Strommast' }, category: 'power-pole',
      footprint: { source: 'clearance', boxes: [{ min: [-40, -40, 0], max: [40, 40, 760], soft: true }] },
    },
    Build_ConveyorLiftMk1_C: { name: { en: 'Lift', de: 'Förderlift' }, category: 'logistics-belt' },
    Build_Foundation_8x4_01_C: {
      name: { en: 'Foundation', de: 'Fundament' }, category: 'structure', size: { w: 800, d: 800, h: 400 },
      footprint: { source: 'clearance', boxes: [{ min: [-400, -400, -200], max: [400, 400, 200], soft: true }] },
    },
    Build_Wall_8x4_01_C: {
      name: { en: 'Wall', de: 'Wand' }, category: 'structure', size: { w: 800, h: 400 },
      footprint: { source: 'clearance', boxes: [{ min: [-25, -400, 0], max: [25, 400, 400], soft: true }] },
    },
    Build_TruckStation_C: {
      name: { en: 'Truck Station', de: 'Lkw-Station' }, category: 'transport',
      footprint: { source: 'clearance', boxes: [{ min: [-600, -1300, 0], max: [1100, -400, 620] }] },
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

const ctor = (id: string, x: number, z: number, extra: Partial<SnapshotBuilding> = {}): SnapshotBuilding =>
  ({ id, cls: 'Build_ConstructorMk1_C', x, y: 10_000, z, yaw: 0, prod: { clock: 1, productivity: 1 }, ...extra });

/** Foundations (8 × 4 m) whose top is at `top` cm, `n` of them in a row. */
const foundations = (top: number, n: number, x0 = 0): number[] =>
  Array.from({ length: n }, (_, i) => [x0 + i * 800, 20_000, top - 200, 0]).flat();

/**
 * A factory on three floors: the ground at 0 m (20 foundations), a floor at 12 m (15) and one at 24 m (12). Machines
 * on each, a refinery from the ground through the 12 m floor, belts on each floor and one rising from 0 to 12 m.
 */
function floors(): FactorySnapshot {
  return snapshot({
    lightweight: [
      { cls: 'Build_Foundation_8x4_01_C', xyzYaw: [...foundations(0, 20), ...foundations(1200, 15), ...foundations(2400, 12)] },
      { cls: 'Build_Wall_8x4_01_C', xyzYaw: [5000, 5000, 1200, 0] },
    ],
    buildings: [
      ctor('g1', 10_000, 0), ctor('g2', 12_000, 0),
      ctor('f1', 10_050, 1200), ctor('f2', 12_000, 1200),
      ctor('t1', 10_000, 2400),
      { id: 'ref', cls: 'Build_OilRefinery_C', x: 30_000, y: 10_000, z: 0, yaw: 0, prod: { clock: 1, productivity: 1 } },
      { id: 'pole', cls: 'Build_PowerPoleMk1_C', x: 40_000, y: 10_000, z: 1200, yaw: 0 },
      { id: 'lift', cls: 'Build_ConveyorLiftMk1_C', x: 41_000, y: 10_000, z: 100, yaw: 0, height: 1200 },
      { id: 'st', cls: 'Build_TruckStation_C', x: 50_000, y: 10_000, z: 1200, yaw: 0 },
    ],
    splines: [
      { id: 'belt0', cls: 'Build_ConveyorBeltMk1_C', pts: [0, 0, 100, 1000, 0, 100, 2000, 0, 100] },
      { id: 'belt12', cls: 'Build_ConveyorBeltMk1_C', pts: [0, 0, 1300, 1000, 0, 1300, 2000, 0, 1300] },
      // Rises from the ground to the 12 m floor: no point of it lies between 3 and 11 m, but it passes there.
      { id: 'ramp', cls: 'Build_ConveyorBeltMk1_C', pts: [0, 0, 100, 3000, 0, 1300, 3100, 0, 1300] },
    ],
    powerLines: [0, 0, 760, 1000, 0, 760, /* */ 0, 0, 1960, 1000, 0, 1960],
    stations: [{ id: 'st', cls: 'Build_TruckStation_C', x: 50_000, y: 10_000, z: 1200, yaw: 0, traffic: [] }],
    vehicles: [{ id: 'v0', cls: 'BP_Truck_C', x: 60_000, y: 10_000, z: 50, yaw: 0, autopilot: true, route: [] }],
    markers: [{ name: 'up', x: 1, y: 1, z: 2500, kind: 'RT_MapMarker', iconId: 1, color: '#ffffff', scale: 1 }],
    crates: [{ x: 1, y: 1, z: 1250, kind: 'CT_DeathCrate' }],
  });
}

describe('height data in the scene', () => {
  it('gives buildings their body\'s vertical extent: hard boxes, soft ones only without, a lift to its other end', () => {
    expect(zExtent({ z: 1000 }, INDEX.get('Build_ConstructorMk1_C'))).toEqual({ zMin: 1000, zMax: 1600 });
    expect(zExtent({ z: 1000 }, INDEX.get('Build_PowerPoleMk1_C'))).toEqual({ zMin: 1000, zMax: 1760 });
    expect(zExtent({ z: 1000, height: -800 }, undefined)).toEqual({ zMin: 200, zMax: 1000 });
    expect(zExtent({ z: 1000 }, undefined)).toEqual({ zMin: 1000, zMax: 1000 });
  });

  it('puts a floor piece at the surface one stands on: a foundation\'s top, a wall\'s foot', () => {
    expect(floorLevel(INDEX.get('Build_Foundation_8x4_01_C'), 1000)).toBe(1200);
    expect(floorLevel(INDEX.get('Build_Wall_8x4_01_C'), 1000)).toBe(1000);
    expect(floorLevel(undefined, 1000)).toBe(1000);
    const scene = buildScene(floors(), INDEX, BOUNDS);
    expect([...new Set(scene.floorZ)].sort((a, b) => a - b)).toEqual([0, 1200, 2400]);
    expect(scene.lines.find(l => l.id === 'ramp')).toMatchObject({ zMin: 100, zMax: 1300 });
    expect([...scene.powerZ]).toEqual([760, 760, 1960, 1960]);
  });
});

describe('floor detection', () => {
  it('finds a floor where more stand than at the metres around it', () => {
    const counts = [0, 30, 2, 0, 1, 0, 0, 0, 25, 0, 0, 0, 12];
    expect(detectFloors(counts, 400)).toEqual([401, 408, 412]);
  });

  it('counts a level split over two metres once (tolerance 1 m) and needs enough pieces within 1 m', () => {
    // 6 + 6 at 400 and 401 m make one floor (at the lower metre); 9 alone is no floor, 9 + 1 is.
    expect(detectFloors([6, 6, 0, 0, 9, 0, 0, 0], 400)).toEqual([400]);
    expect(detectFloors([6, 6, 0, 0, 9, 1, 0, 0], 400)).toEqual([400, 404]);
  });

  it('tells floors two metres apart apart, not one', () => {
    expect(detectFloors([20, 0, 20], 0)).toEqual([0, 2]);
    expect(detectFloors([20, 15], 0)).toEqual([0]);
  });

  it('trims outliers from the span, so lone buildings far up or down do not squeeze the floors', () => {
    const levels = [...Array(400).fill(0), ...Array(300).fill(1200), -13_300, 17_700];
    const p = profileOf(levels)!;
    expect([p.min, p.max]).toEqual([0, 12]);
    expect(p.floors).toEqual([0, 12]);
    expect(p.counts[0]).toBe(400);
    expect(profileOf([])).toBeNull();
  });

  it('profiles a scene from its foundations and non-logistics buildings', () => {
    const p = heightProfile(buildScene(floors(), INDEX, BOUNDS))!;
    expect(p.floors).toEqual([0, 12, 24]);
    expect([p.min, p.max]).toEqual([0, 24]);
  });
});

describe('range filtering', () => {
  const scene = buildScene(floors(), INDEX, BOUNDS);
  const p = heightProfile(scene)!;
  const ids = (s: Scene) => s.buildings.map(sb => sb.b.id).sort();

  it('draws everything (the scene itself) without a range or with one covering the span', () => {
    expect(filterScene(scene, null, p)).toBe(scene);
    expect(filterScene(scene, { lo: -5, hi: 40 }, p)).toBe(scene);
    expect(normalizeRange({ lo: 0, hi: 24 }, p)).toBeNull();
  });

  it('keeps buildings whose body overlaps the range: the floor\'s machines and a tall one from below', () => {
    // The 12 m floor up to just below the 24 m one.
    const s = filterScene(scene, { lo: 12, hi: 23 }, p);
    expect(ids(s)).toEqual(['f1', 'f2', 'lift', 'pole', 'ref', 'st']);
    // The ground floor: the constructors there end at 6 m, so nothing of the floor above.
    expect(ids(filterScene(scene, { lo: 0, hi: 11 }, p))).toEqual(['g1', 'g2', 'lift', 'ref']);
  });

  it('keeps floor pieces by their level', () => {
    expect([...new Set(filterScene(scene, { lo: 12, hi: 23 }, p).floorZ)]).toEqual([1200]);
    expect(filterScene(scene, { lo: 12, hi: 23 }, p).floor.length).toBe((15 + 1) * 8);
  });

  it('draws a belt, pipe or power line whole when any part lies in the range', () => {
    const lines = (lo: number, hi: number) => filterScene(scene, { lo, hi }, p).lines.map(l => l.id).sort();
    expect(lines(12, 23)).toEqual(['belt12', 'ramp']);
    expect(lines(0, 11)).toEqual(['belt0', 'ramp']);
    // Between the floors only the rising belt passes.
    expect(lines(4, 8)).toEqual(['ramp']);
    expect([...filterScene(scene, { lo: 12, hi: 23 }, p).power]).toHaveLength(4);
  });

  it('keeps stations by their building, vehicles, markers and crates by their height', () => {
    const s = filterScene(scene, { lo: 12, hi: 23 }, p);
    expect(s.stations.map(st => st.s.id)).toEqual(['st']);
    expect(s.vehicles).toHaveLength(0);
    expect(s.crates).toHaveLength(1);
    expect(s.markers).toHaveLength(0);
    const ground = filterScene(scene, { lo: 0, hi: 11 }, p);
    expect(ground.vehicles.map(v => v.v.id)).toEqual(['v0']);
    expect(ground.stationById.has('st')).toBe(false);
  });

  it('leaves an end at the span\'s edge open: the top floor keeps what stands above its feet', () => {
    const top = filterScene(scene, { lo: 24, hi: 24 }, p);
    expect(ids(top)).toEqual(['ref', 't1']);
    expect(top.markers).toHaveLength(1);
  });

  it('works out the stacking within the range only', () => {
    expect(scene.byId.get('g1')!.under).toBe(true);
    const ground = filterScene(scene, { lo: 0, hi: 11 }, p);
    expect(ground.byId.get('g1')!.under).toBe(false);
    // The scene's own buildings are not touched.
    expect(scene.byId.get('g1')!.under).toBe(true);
  });

  it('makes the filtered scene once per range', () => {
    expect(filterScene(scene, { lo: 0, hi: 11 }, p)).toBe(filterScene(scene, { lo: 0, hi: 11 }, p));
    expect(filterScene(scene, { lo: 0, hi: 11 }, p)).not.toBe(filterScene(scene, { lo: 0, hi: 12 }, p));
  });

  it('keeps only what lies wholly below the range for "Darunter blass zeigen"', () => {
    const below = belowScene(scene, { lo: 12, hi: 23 }, p)!;
    expect(ids(below)).toEqual(['g1', 'g2']);
    expect([...new Set(below.floorZ)]).toEqual([0]);
    expect(below.lines.map(l => l.id)).toEqual(['belt0']);
    expect(belowScene(scene, { lo: 0, hi: 11 }, p)).toBeNull();
    expect(belowScene(scene, null, p)).toBeNull();
  });

  it('filters the changes\' removed buildings and lines', () => {
    const gone = placeBuilding(ctor('gone', 1, 2000), INDEX.get('Build_ConstructorMk1_C'), scene.t);
    const diff = { removed: [gone], linesRemoved: [scene.lines[0]!] } as unknown as DiffOverlay;
    expect(filterDiff(diff, { lo: 0, hi: 11 }, p).removed).toHaveLength(0);
    expect(filterDiff(diff, null, p)).toBe(diff);
  });
});

describe('marked buildings outside the range', () => {
  const scene = buildScene(floors(), INDEX, BOUNDS);
  const p = heightProfile(scene)!;

  it('lists them and widens the range to show them with their floor', () => {
    const shown = filterScene(scene, { lo: 12, hi: 23 }, p);
    expect(outsideIds(scene, shown, ['f1', 'g1', 't1', 'v0', 'unknown'])).toEqual(['g1', 't1', 'v0']);
    expect(outsideIds(scene, scene, ['g1'])).toEqual([]);
    expect(widenTo({ lo: 12, hi: 15 }, p, scene, ['g1'])).toEqual({ lo: 0, hi: 15 });
    expect(widenTo({ lo: 12, hi: 15 }, p, scene, ['t1'])).toEqual({ lo: 12, hi: 24 });
    // Both: the whole span, no range.
    expect(widenTo({ lo: 12, hi: 15 }, p, scene, ['g1', 't1'])).toBeNull();
  });
});

describe('the slider', () => {
  const p: HeightProfile = { min: 400, max: 440, counts: new Uint32Array(41), floors: [404, 412, 420] };

  it('stops the lower handle at floor levels and the upper one just below the next floor', () => {
    expect(floorStops(p, 'lo')).toEqual([400, 404, 412, 420, 440]);
    expect(floorStops(p, 'hi')).toEqual([400, 403, 411, 419, 440]);
    expect(nextStop([400, 404, 412], 405, 1)).toBe(412);
    expect(nextStop([400, 404, 412], 405, -1)).toBe(404);
    expect(nextStop([400, 404, 412], 412, 1)).toBe(412);
  });

  it('moves a handle a metre per arrow key, floor to floor with PageUp and PageDown, to its ends with Home and End', () => {
    const v = { lo: 404, hi: 419 };
    expect(keyStep('ArrowUp', 'lo', v, p)).toBe(405);
    expect(keyStep('ArrowRight', 'hi', v, p)).toBe(420);
    expect(keyStep('ArrowLeft', 'lo', v, p)).toBe(403);
    expect(keyStep('ArrowDown', 'hi', v, p)).toBe(418);
    expect(keyStep('PageUp', 'lo', v, p)).toBe(412);
    expect(keyStep('PageDown', 'lo', v, p)).toBe(400);
    expect(keyStep('PageUp', 'hi', v, p)).toBe(440);
    expect(keyStep('PageDown', 'hi', v, p)).toBe(411);
    expect(keyStep('Home', 'lo', v, p)).toBe(400);
    expect(keyStep('End', 'lo', v, p)).toBe(419);
    expect(keyStep('Home', 'hi', v, p)).toBe(404);
    expect(keyStep('End', 'hi', v, p)).toBe(440);
    // The lower handle never passes the upper one.
    expect(keyStep('PageUp', 'lo', { lo: 412, hi: 415 }, p)).toBe(415);
    expect(keyStep('Enter', 'lo', v, p)).toBeNull();
  });

  it('says the range in words, with open ends', () => {
    const t = (k: string, o?: Record<string, unknown>) => `${k.split('.').pop()}${o ? JSON.stringify(o) : ''}`;
    expect(rangeText(null, p, t, 'de')).toBe('all');
    expect(rangeText({ lo: 412, hi: 419 }, p, t, 'de')).toBe('range{"lo":"412","hi":"419"}');
    expect(rangeText({ lo: 400, hi: 419 }, p, t, 'de')).toBe('upTo{"value":"419"}');
    expect(rangeText({ lo: 412, hi: 440 }, p, t, 'de')).toBe('atLeast{"value":"412"}');
    expect(rangeText({ lo: 412, hi: 412 }, p, t, 'de')).toBe('one{"value":"412"}');
    const neg = { ...p, min: -60, max: 0 };
    expect(rangeText({ lo: -36, hi: -22 }, neg, t, 'de')).toBe('rangeWords{"lo":"−36","hi":"−22"}');
  });

  it('keeps a remembered range while it overlaps the span', () => {
    expect(rangeFits({ lo: 430, hi: 450 }, p)).toBe(true);
    expect(rangeFits({ lo: 450, hi: 460 }, p)).toBe(false);
  });
});

describe('height filter performance', () => {
  it('filters a large factory in a few milliseconds and costs nothing without a range', () => {
    // 30 000 foundations on 10 floors, 6 000 machines, 6 000 belts.
    const lw: number[] = [];
    const buildings: SnapshotBuilding[] = [];
    const splines: FactorySnapshot['splines'] = [];
    for (let f = 0; f < 10; f++) {
      const top = f * 1200;
      for (let i = 0; i < 3000; i++) lw.push((i % 60) * 800, 20_000 + Math.floor(i / 60) * 800, top - 200, 0);
      for (let i = 0; i < 600; i++) {
        const x = (i % 30) * 1600, y = 20_000 + Math.floor(i / 30) * 2000;
        buildings.push(ctor(`m${f}-${i}`, x, top, { y }));
        splines.push({ id: `s${f}-${i}`, cls: 'Build_ConveyorBeltMk1_C', pts: [x, y, top + 100, x + 800, y, top + 100] });
      }
    }
    const scene = buildScene(snapshot({ lightweight: [{ cls: 'Build_Foundation_8x4_01_C', xyzYaw: lw }], buildings, splines }), INDEX, BOUNDS);
    const p = heightProfile(scene)!;
    expect(p.floors).toHaveLength(10);
    let t = performance.now();
    expect(filterScene(scene, null, p)).toBe(scene);
    expect(performance.now() - t).toBeLessThan(1);
    t = performance.now();
    const s = filterScene(scene, { lo: 36, hi: 47 }, p);
    const ms = performance.now() - t;
    expect(s.buildings).toHaveLength(600);
    expect(s.floorZ.length).toBe(3000);
    // Generous for slow CI machines; about 10 ms on a laptop.
    expect(ms).toBeLessThan(250);
  });
});
