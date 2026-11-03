import type { RouteDto } from '../../../shared/api.js';
import type { DatasetIndex, Item } from '../../../shared/dataset.js';
import { distance3d, UNITS_PER_METER } from '../../../shared/geo.js';
import { MAX_ROUTE_STOPS, optimizeRoute, pathLength } from '../../../shared/route.js';
import type { Vec3 } from '../../../shared/types.js';

/** A route being looked at or edited (spec §10.6). `id` is null until the route is saved. */
export interface RouteDraft { id: string | null; name: string; start: string | null; stops: string[]; manualOrder: boolean }

export type DraftAction = { type: 'click'; actor: string } | { type: 'add'; actors: string[] } | { type: 'remove'; actor: string }
  | { type: 'move'; from: number; to: number } | { type: 'setStart'; actor: string } | { type: 'optimize'; order: string[] } | { type: 'load'; route: RouteDto }
  | { type: 'rename'; name: string };

/** `full`: nothing could be added; `partial`: a bulk add was cut at the route limit. */
export type DraftNotice = { kind: 'full' } | { kind: 'partial'; added: number; requested: number };

export const emptyDraft = (name: string): RouteDraft => ({ id: null, name, start: null, stops: [], manualOrder: false });

export function draftFromRoute(route: RouteDto): RouteDraft {
  return { id: route.id, name: route.name, start: route.startActor, stops: [...route.stops], manualOrder: false };
}

/** Adds `actors` (nearest first, as the caller ordered them) after the stops, up to the route limit. */
function addStops(d: RouteDraft, actors: readonly string[]): { draft: RouteDraft; notice?: DraftNotice } {
  let start = d.start;
  const present = new Set(d.stops);
  const fresh: string[] = [];
  for (const a of actors) {
    if (start === null) {
      if (!present.has(a)) start = a;
      continue;
    }
    if (a === start || present.has(a)) continue;
    present.add(a);
    fresh.push(a);
  }
  const room = Math.max(0, MAX_ROUTE_STOPS - d.stops.length);
  const added = fresh.slice(0, room);
  const draft = start === d.start && added.length === 0 ? d : { ...d, start, stops: [...d.stops, ...added] };
  if (fresh.length === 0 || added.length === fresh.length) return { draft };
  return { draft, notice: added.length === 0 ? { kind: 'full' } : { kind: 'partial', added: added.length, requested: fresh.length } };
}

/**
 * The draft after one user action (spec §10.6). A click sets the start first, then adds or removes a
 * stop; clicking the start does nothing. Adding stops past the limit gives a notice instead. A move
 * keeps the manual order; an optimised order ends it. Unchanged drafts come back as the same object.
 */
export function draftReducer(d: RouteDraft, a: DraftAction): { draft: RouteDraft; notice?: DraftNotice } {
  switch (a.type) {
    case 'click':
      if (d.start === null) return draftReducer(d, { type: 'setStart', actor: a.actor });
      if (a.actor === d.start) return { draft: d };
      if (d.stops.includes(a.actor)) return draftReducer(d, { type: 'remove', actor: a.actor });
      return addStops(d, [a.actor]);
    case 'add':
      return addStops(d, a.actors);
    case 'remove':
      return d.stops.includes(a.actor) ? { draft: { ...d, stops: d.stops.filter(s => s !== a.actor) } } : { draft: d };
    case 'move': {
      const { from, to } = a;
      if (from === to || from < 0 || to < 0 || from >= d.stops.length || to >= d.stops.length) return { draft: d };
      const stops = [...d.stops];
      const [moved] = stops.splice(from, 1);
      stops.splice(to, 0, moved!);
      return { draft: { ...d, stops, manualOrder: true } };
    }
    case 'setStart':
      if (a.actor === d.start) return { draft: d };
      return { draft: { ...d, start: a.actor, stops: d.stops.filter(s => s !== a.actor) } };
    case 'optimize':
      return { draft: { ...d, stops: [...a.order], manualOrder: false } };
    case 'load':
      return { draft: draftFromRoute(a.route) };
    case 'rename':
      return { draft: { ...d, name: a.name } };
  }
}

/** Whether two drafts would save the same route. */
export function sameRoute(a: RouteDraft, b: RouteDraft): boolean {
  return a.name === b.name && a.start === b.start && a.stops.length === b.stops.length && a.stops.every((s, i) => s === b.stops[i]);
}

/** The draft without actors that are not on the map (any more), and how many were dropped. */
export function dropUnknown(d: RouteDraft, index: DatasetIndex): { draft: RouteDraft; dropped: number } {
  const startKnown = d.start === null || index.has(d.start);
  const stops = d.stops.filter(s => index.has(s));
  const dropped = (startKnown ? 0 : 1) + d.stops.length - stops.length;
  if (dropped === 0) return { draft: d, dropped };
  return { draft: { ...d, start: startKnown ? d.start : null, stops }, dropped };
}

const point = (i: Item) => ({ id: i.name, x: i.x, y: i.y, z: i.z });

/** The draft in optimised order; all its actors must be on the map (see `dropUnknown`). */
export function optimizeDraft(d: RouteDraft, index: DatasetIndex): RouteDraft {
  const start = d.start === null ? undefined : index.byName.get(d.start);
  if (!start || d.stops.length === 0) return d;
  const stops = d.stops.flatMap(s => index.byName.get(s) ?? []);
  return draftReducer(d, { type: 'optimize', order: optimizeRoute(start, stops.map(point)) }).draft;
}

/** Up to `limit` names of uncollected `items` nearest to `from` (straight line), without `exclude`. */
export function nearestUncollected(from: Vec3, items: Item[], isDone: (n: string) => boolean, exclude: Set<string>, limit: number): string[] {
  return items
    .filter(i => !exclude.has(i.name) && !isDone(i.name))
    .map(i => ({ name: i.name, d: distance3d(from, i) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, Math.max(0, limit))
    .map(i => i.name);
}

/** Done stops first in their current order, then the rest optimised from the last done stop (or the start). */
export function replan(start: Item, stops: Item[], isDone: (n: string) => boolean): string[] {
  const done = stops.filter(s => isDone(s.name));
  const undone = stops.filter(s => !isDone(s.name));
  return [...done.map(s => s.name), ...optimizeRoute(done.at(-1) ?? start, undone.map(point))];
}

/**
 * Metres of the whole path, and of what is left: from the last done stop (or the start) through the
 * undone stops in route order.
 */
export function routeStats(start: Item, stops: Item[], isDone: (n: string) => boolean): { totalM: number; leftM: number; done: number; count: number } {
  const undone = stops.filter(s => !isDone(s.name));
  const lastDone = stops.findLast(s => isDone(s.name)) ?? start;
  return {
    totalM: pathLength(start, stops) / UNITS_PER_METER,
    leftM: pathLength(lastDone, undone) / UNITS_PER_METER,
    done: stops.length - undone.length,
    count: stops.length,
  };
}
