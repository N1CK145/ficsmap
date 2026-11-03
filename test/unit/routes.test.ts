import { openDb } from '../../src/server/db/db.js';
import { createWorld, deleteWorld, getWorld } from '../../src/server/domain/worlds.js';
import { createRoute, deleteRoute, listRoutes, RouteInputSchema, updateRoute } from '../../src/server/domain/routes.js';
import { MAX_ROUTE_STOPS } from '../../src/shared/route.js';
import { createUserForTest } from '../api/helpers.js';

function setup() {
  const db = openDb(':memory:');
  const u = createUserForTest(db, 'u1');
  const w = createWorld(db, u, 'W', 'v1', 1);
  return { db, u, w };
}

describe('RouteInputSchema', () => {
  const ok = { name: 'R', startActor: 'S', stops: ['A', 'B'] };
  it('accepts a valid input and trims the name', () => {
    expect(RouteInputSchema.parse({ ...ok, name: '  Hi  ' }).name).toBe('Hi');
  });
  it('accepts exactly MAX_ROUTE_STOPS and rejects one more', () => {
    const stops = (n: number) => Array.from({ length: n }, (_, i) => `A${i}`);
    expect(RouteInputSchema.safeParse({ ...ok, stops: stops(MAX_ROUTE_STOPS) }).success).toBe(true);
    expect(RouteInputSchema.safeParse({ ...ok, stops: stops(MAX_ROUTE_STOPS + 1) }).success).toBe(false);
  });
  it('rejects empty stops, duplicates, start in stops, bad names', () => {
    expect(RouteInputSchema.safeParse({ ...ok, stops: [] }).success).toBe(false);
    expect(RouteInputSchema.safeParse({ ...ok, stops: ['A', 'A'] }).success).toBe(false);
    expect(RouteInputSchema.safeParse({ ...ok, stops: ['S'] }).success).toBe(false);
    expect(RouteInputSchema.safeParse({ ...ok, stops: ['a.b'] }).success).toBe(false);
    expect(RouteInputSchema.safeParse({ ...ok, startActor: 'a b' }).success).toBe(false);
    expect(RouteInputSchema.safeParse({ ...ok, name: '   ' }).success).toBe(false);
    expect(RouteInputSchema.safeParse({ ...ok, name: 'x'.repeat(81) }).success).toBe(false);
  });
});

describe('routes domain', () => {
  it('create, list, update, delete bump rev and round trip', () => {
    const { db, u, w } = setup();
    const c = createRoute(db, w.id, { name: 'R', startActor: 'S', stops: ['A', 'B'] }, u, 10);
    expect(c.rev).toBe(1);
    expect(c.route).toMatchObject({
      name: 'R', startActor: 'S', stops: ['A', 'B'], createdBy: u, createdByName: 'user-u1', createdAt: 10, updatedAt: 10,
    });
    expect(listRoutes(db, w.id)).toEqual([c.route]);
    const up = updateRoute(db, w.id, c.route.id, { name: 'R2', startActor: 'S', stops: ['B', 'A'] }, 20);
    expect(up.rev).toBe(2);
    expect(up.route).toMatchObject({ name: 'R2', stops: ['B', 'A'], createdAt: 10, updatedAt: 20 });
    expect(deleteRoute(db, w.id, c.route.id)).toEqual({ rev: 3 });
    expect(listRoutes(db, w.id)).toEqual([]);
    expect(getWorld(db, w.id)!.rev).toBe(3);
  });

  it('orders by updated_at desc and shows null createdByName once the creator is gone', () => {
    const { db, u, w } = setup();
    const u2 = createUserForTest(db, 'u2');
    const a = createRoute(db, w.id, { name: 'A', startActor: 'S', stops: ['X'] }, u, 10).route;
    const b = createRoute(db, w.id, { name: 'B', startActor: 'S', stops: ['X'] }, u2, 20).route;
    expect(listRoutes(db, w.id).map(r => r.id)).toEqual([b.id, a.id]);
    db.prepare('DELETE FROM users WHERE id = ?').run(u2);
    expect(listRoutes(db, w.id)[0]).toMatchObject({ id: b.id, createdBy: null, createdByName: null });
  });

  it('update and delete of an unknown or foreign-world route give 404 and do not bump rev', () => {
    const { db, u, w } = setup();
    const w2 = createWorld(db, u, 'W2', 'v1', 1);
    const r = createRoute(db, w2.id, { name: 'R', startActor: 'S', stops: ['A'] }, u, 1).route;
    const input = { name: 'R', startActor: 'S', stops: ['A'] };
    expect(() => updateRoute(db, w.id, r.id, input, 2)).toThrow(expect.objectContaining({ status: 404 }));
    expect(() => deleteRoute(db, w.id, r.id)).toThrow(expect.objectContaining({ status: 404 }));
    expect(getWorld(db, w.id)!.rev).toBe(0);
  });

  it('deleting the world cascades its routes', () => {
    const { db, u, w } = setup();
    createRoute(db, w.id, { name: 'R', startActor: 'S', stops: ['A'] }, u, 1);
    deleteWorld(db, w.id);
    expect(db.prepare('SELECT COUNT(*) AS n FROM routes').get()).toEqual({ n: 0 });
  });
});
