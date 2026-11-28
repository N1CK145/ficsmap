import type { RouteDto } from '../../src/shared/api.js';
import type { TFunction } from 'i18next';
import { indexDataset, type Dataset, type Item } from '../../src/shared/dataset.js';
import { toShapes } from '../../src/web/features/caves/useCaves.js';
import { caveStopText } from '../../src/web/features/routes/RouteEditor.js';
import { routeLine, stopCaves } from '../../src/web/features/routes/routeCaves.js';
import { MAX_ROUTE_STOPS } from '../../src/shared/route.js';
import {
  draftReducer, emptyDraft, nearestUncollected, replan, routeStats, type RouteDraft,
} from '../../src/web/features/routes/draft.js';

const draft = (over: Partial<RouteDraft> = {}): RouteDraft => ({ ...emptyDraft('Route 1'), ...over });
const names = (n: number, prefix = 'A') => Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`);
/** An item on the x axis, `m` metres from the origin. */
const at = (name: string, m: number): Item => ({ name, type: 'somersloop', x: m * 100, y: 0, z: 0, biome: 0, seq: 1 });

describe('draftReducer', () => {
  it('sets the start on the first click', () => {
    const { draft: d, notice } = draftReducer(draft(), { type: 'click', actor: 'S' });
    expect(d.start).toBe('S');
    expect(d.stops).toEqual([]);
    expect(notice).toBeUndefined();
  });

  it('ignores a second click on the start', () => {
    const before = draft({ start: 'S', stops: ['A'] });
    const { draft: d } = draftReducer(before, { type: 'click', actor: 'S' });
    expect(d).toEqual(before);
  });

  it('adds a stop on a click, and removes it on the next click', () => {
    const added = draftReducer(draft({ start: 'S' }), { type: 'click', actor: 'A' }).draft;
    expect(added.stops).toEqual(['A']);
    const removed = draftReducer(added, { type: 'click', actor: 'A' }).draft;
    expect(removed.stops).toEqual([]);
  });

  it('gives notice "full" for the 31st stop and keeps 30', () => {
    const full = draft({ start: 'S', stops: names(MAX_ROUTE_STOPS) });
    const byClick = draftReducer(full, { type: 'click', actor: 'X' });
    expect(byClick.notice).toEqual({ kind: 'full' });
    expect(byClick.draft.stops).toHaveLength(30);
    const byAdd = draftReducer(full, { type: 'add', actors: ['X'] });
    expect(byAdd.notice).toEqual({ kind: 'full' });
    expect(byAdd.draft.stops).toHaveLength(30);
  });

  it('fills up to 30 on a bulk add and reports the partial add', () => {
    const before = draft({ start: 'S', stops: names(18) });
    const { draft: d, notice } = draftReducer(before, { type: 'add', actors: names(40, 'B') });
    expect(d.stops).toHaveLength(30);
    expect(d.stops.slice(18)).toEqual(names(12, 'B'));
    expect(notice).toEqual({ kind: 'partial', added: 12, requested: 40 });
  });

  it('skips the start and present stops on add, without a notice when all fit', () => {
    const { draft: d, notice } = draftReducer(draft({ start: 'S', stops: ['A'] }), { type: 'add', actors: ['S', 'A', 'B'] });
    expect(d.stops).toEqual(['A', 'B']);
    expect(notice).toBeUndefined();
  });

  it('makes the first added item the start when there is none', () => {
    const { draft: d } = draftReducer(draft(), { type: 'add', actors: ['S', 'A'] });
    expect(d.start).toBe('S');
    expect(d.stops).toEqual(['A']);
  });

  it('removes a stop', () => {
    expect(draftReducer(draft({ start: 'S', stops: ['A', 'B'] }), { type: 'remove', actor: 'A' }).draft.stops).toEqual(['B']);
  });

  it('moves a stop and keeps the manual order', () => {
    const { draft: d } = draftReducer(draft({ start: 'S', stops: ['A', 'B', 'C'] }), { type: 'move', from: 0, to: 2 });
    expect(d.stops).toEqual(['B', 'C', 'A']);
    expect(d.manualOrder).toBe(true);
  });

  it('ignores a move out of range', () => {
    const before = draft({ start: 'S', stops: ['A', 'B'] });
    expect(draftReducer(before, { type: 'move', from: 1, to: 2 }).draft).toEqual(before);
  });

  it('takes an optimised order and drops the manual order', () => {
    const { draft: d } = draftReducer(draft({ start: 'S', stops: ['A', 'B'], manualOrder: true }), { type: 'optimize', order: ['B', 'A'] });
    expect(d.stops).toEqual(['B', 'A']);
    expect(d.manualOrder).toBe(false);
  });

  it('sets a new start and takes it out of the stops', () => {
    const { draft: d } = draftReducer(draft({ start: 'S', stops: ['A', 'B'] }), { type: 'setStart', actor: 'B' });
    expect(d.start).toBe('B');
    expect(d.stops).toEqual(['A']);
  });

  it('loads a saved route', () => {
    const route: RouteDto = {
      id: 'r1', name: 'North sloops', startActor: 'S', stops: ['A', 'B'], createdBy: 1, createdByName: 'Anna', createdAt: 0, updatedAt: 0,
    };
    expect(draftReducer(draft(), { type: 'load', route }).draft).toEqual({ id: 'r1', name: 'North sloops', start: 'S', stops: ['A', 'B'], manualOrder: false });
  });
});

describe('nearestUncollected', () => {
  it('returns uncollected items nearest first, without the excluded ones, up to the limit', () => {
    const items = [at('far', 50), at('done', 1), at('near', 2), at('start', 0), at('mid', 10)];
    const isDone = (n: string) => n === 'done';
    expect(nearestUncollected(at('start', 0), items, isDone, new Set(['start']), 2)).toEqual(['near', 'mid']);
    expect(nearestUncollected(at('start', 0), items, isDone, new Set(['start', 'mid']), 10)).toEqual(['near', 'far']);
  });
});

describe('replan', () => {
  it('keeps the done stops first, in their order, and optimises the rest from the last done one', () => {
    const start = at('S', 0);
    const stops = [at('A', 1), at('B', 3), at('C', 0.5), at('D', 10)];
    const done = new Set(['B', 'D']);
    // From D (10 m): A (9 m) is nearer than C (9.5 m), then C.
    expect(replan(start, stops, n => done.has(n))).toEqual(['B', 'D', 'A', 'C']);
  });

  it('optimises from the start when nothing is done', () => {
    expect(replan(at('S', 0), [at('A', 5), at('B', 1)], () => false)).toEqual(['B', 'A']);
  });
});

describe('routeStats', () => {
  it('measures the whole path and what is left from the last done stop through the undone ones', () => {
    const start = at('S', 0);
    const stops = [at('A', 1), at('B', 3), at('C', 6)];
    const stats = routeStats(start, stops, n => n === 'B');
    expect(stats.totalM).toBeCloseTo(6);
    // From B (3 m) back to A (1 m), then to C (6 m): 2 + 5.
    expect(stats.leftM).toBeCloseTo(7);
    expect(stats).toMatchObject({ done: 1, count: 3 });
  });

  it('counts what is left from the start when nothing is done', () => {
    const stats = routeStats(at('S', 0), [at('A', 2), at('B', 4)], () => false);
    expect(stats.leftM).toBeCloseTo(4);
    expect(stats.done).toBe(0);
  });

  it('has nothing left when every stop is done', () => {
    expect(routeStats(at('S', 0), [at('A', 2)], () => true).leftM).toBe(0);
  });
});

describe('routes through caves', () => {
  // A cave around x 50..60 m, y 10..20 m, with its entrance at (50 m, 0).
  const cave = { id: 'sc-007', n: 7, entrances: [{ x: 5000, y: 0, z: 0 }] };
  const inCave = (name: string, xm: number, ym: number): Item => ({ name, type: 'somersloop', x: xm * 100, y: ym * 100, z: 0, biome: 0, seq: 1, extra: { cave: true } });
  const caves = new Map([['C1', cave], ['C2', cave]]);

  it('measures a cave stop through the entrance, and two stops in one cave inside it', () => {
    const start = at('S', 0);
    const stops = [inCave('C1', 50, 10), inCave('C2', 50, 20)];
    expect(routeStats(start, stops, () => false, caves).totalM).toBeCloseTo(50 + 10 + 10);
    expect(routeStats(start, stops, () => false).totalM).toBeCloseTo(Math.hypot(50, 10) + 10);
  });

  it('re-plans with the cave legs', () => {
    // Straight-line C1 (40 m, 5 m, behind the cave wall) is nearer than O (45 m); through the entrance at 50 m it is
    // 61 m away, and from O only 16 m, so O comes first.
    const start = at('S', 0);
    const stops = [inCave('C1', 40, 5), at('O', 45)];
    expect(replan(start, stops, () => false, new Map([['C1', cave]]))).toEqual(['O', 'C1']);
    expect(replan(start, stops, () => false)).toEqual(['C1', 'O']);
  });
});

describe('stop caves', () => {
  const bounds = { minX: 0, minY: 0, maxX: 100_000, maxY: 100_000 };
  const ds: Dataset = {
    version: 't', build: 1, bounds, mapId: 'm', podRequirementsKnown: true, biomes: [{ id: 'b', name: { en: 'B', de: 'B' } }],
    items: [
      ['IN', 'somersloop', 1000, 1000, 0, 0, 1, { cave: true }], // inside the outline
      ['NEAR', 'somersloop', 3000, 0, 0, 0, 2, { cave: true }], // flagged, outside the outline, 10 m from its entrance
      ['FAR', 'somersloop', 60_000, 60_000, 0, 0, 3, { cave: true }], // flagged, far from every cave
      ['OPEN', 'somersloop', 1500, 1500, 0, 0, 4], // inside the outline but not in the cave (on the hill above)
    ],
    aliases: {},
  };
  const shapes = toShapes({
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', properties: { kind: 'cave', id: 'sc-007', n: 7 }, geometry: { type: 'Polygon', coordinates: [[[0, 0], [2000, 0], [2000, 2000], [0, 2000], [0, 0]]] } },
      { type: 'Feature', properties: { kind: 'entrance', cave: 'sc-007', z: 5 }, geometry: { type: 'Point', coordinates: [2000, 0] } },
    ],
  }, bounds);

  it('gives each item in a cave its cave with the entrances, by outline or by the nearest entrance', () => {
    const caves = stopCaves(indexDataset(ds), shapes);
    expect([...caves.keys()].sort()).toEqual(['IN', 'NEAR']);
    expect(caves.get('IN')).toEqual({ id: 'sc-007', n: 7, entrances: [{ x: 2000, y: 0, z: 5 }] });
  });

  it('names a cave stop and the entrance it is entered by', () => {
    const caves = stopCaves(indexDataset(ds), shapes);
    const t = ((key: string, o: Record<string, unknown>) => `${key} ${JSON.stringify(o)}`) as unknown as TFunction;
    const item = (name: string) => indexDataset(ds).byName.get(name)!;
    expect(caveStopText(at('S', 0), item('IN'), caves, t)).toBe('routes.caveStopVia {"n":7,"entrance":1}');
    expect(caveStopText(item('NEAR'), item('IN'), caves, t)).toBe('routes.caveStop {"n":7}');
    expect(caveStopText(at('S', 0), item('OPEN'), caves, t)).toBeUndefined();
  });

  it('draws the route line through the entrance into the cave', () => {
    const caves = stopCaves(indexDataset(ds), shapes);
    const item = (name: string) => indexDataset(ds).byName.get(name)!;
    const ll = (x: number, y: number) => [0 - (y / 100_000) * 256, (x / 100_000) * 256];
    expect(routeLine([item('OPEN'), item('IN')], caves, bounds)).toEqual([ll(1500, 1500), ll(2000, 0), ll(1000, 1000)]);
    expect(routeLine([item('OPEN'), item('IN')], null, bounds)).toEqual([ll(1500, 1500), ll(1000, 1000)]);
  });
});
