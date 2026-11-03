import { useQuery, type QueryClient } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import { useMemo } from 'react';
import { create } from 'zustand';
import type { MeDto, RouteDto, RouteInput, WorldDto } from '../../../shared/api.js';
import type { DatasetIndex } from '../../../shared/dataset.js';
import { MAX_ROUTE_STOPS } from '../../../shared/route.js';
import { api } from '../../app/api.js';
import { queryKeys } from '../../app/queryKeys.js';
import { useUiStore, type InteractionMode } from '../../app/store.js';
import type { ToastApi } from '../../components/Toast.js';
import {
  draftFromRoute, draftReducer, dropUnknown, emptyDraft, optimizeDraft, sameRoute, type DraftAction, type DraftNotice, type RouteDraft,
} from './draft.js';

const routesPath = (worldId: string) => `/api/worlds/${encodeURIComponent(worldId)}/routes`;

export function useRoutesQuery(worldId: string, enabled = true) {
  return useQuery({ queryKey: queryKeys.routes(worldId), queryFn: () => api<RouteDto[]>('GET', routesPath(worldId)), enabled });
}

/** The creator or the world owner may change a route; a route not saved yet is the user's own. */
export function canEditRoute(route: RouteDto | undefined, draftId: string | null, me: MeDto, world: WorldDto): boolean {
  if (draftId === null) return true;
  return world.isOwner || (route?.createdBy ?? null) === me.id;
}

/** "Route N" for a new route, N = the saved routes + 1. */
export function defaultRouteName(queryClient: QueryClient, worldId: string, t: TFunction): string {
  const count = queryClient.getQueryData<RouteDto[]>(queryKeys.routes(worldId))?.length ?? 0;
  return t('routes.defaultName', { n: count + 1 });
}

/** What a draft action needs from the world: the item positions, and a way to tell the user. */
export interface DraftEnv { index: DatasetIndex; toast: ToastApi; t: TFunction }

/** These change which stops there are; the optimiser runs after them unless the order is manual. */
const RESHAPING = new Set<DraftAction['type']>(['click', 'add', 'remove', 'setStart']);

export function noticeMessage(n: DraftNotice, t: TFunction): string {
  return n.kind === 'full'
    ? t('routes.full', { max: MAX_ROUTE_STOPS })
    : t('routes.partial', { added: n.added, requested: n.requested, max: MAX_ROUTE_STOPS });
}

export interface Leave { mode: InteractionMode; close: boolean }

export interface RouteDraftState {
  /** The route open in the panel; null shows the route list. */
  draft: RouteDraft | null;
  /** The draft as last loaded or saved: a difference is an unsaved change. */
  baseline: RouteDraft | null;
  /** The saved route drawn on the map while not editing. */
  activeRouteId: string | null;
  /** [Change] start: the next marker click in route mode sets the start. */
  pickingStart: boolean;
  /** A request to fly the map to a stop; `n` makes repeated requests for the same stop distinct. */
  focus: { actor: string; n: number } | null;
  /** Leaving the editor with unsaved changes waits for "Discard?": then go to `mode`, and close the route if `close`. */
  leaving: Leave | null;
  /** A new, empty route in the editor (not yet in route mode). */
  newDraft(name: string): void;
  /** Opens a saved route (not editing): it becomes the draft, its baseline and the active route. */
  load(route: RouteDto): void;
  /** Runs one action through `draftReducer`, toasts its notice, drops actors that are no longer on the map and re-optimises. */
  apply(action: DraftAction, env: DraftEnv): void;
  /** Starts editing the open route: actors no longer on the map are dropped (with a toast), and the map goes to route mode. */
  beginEdit(env: DraftEnv): void;
  /** Back to the baseline; a draft never saved closes. */
  revert(): void;
  requestLeave(leave: Leave | null): void;
  close(): void;
  setPickingStart(on: boolean): void;
  flyTo(actor: string): void;
  reset(): void;
}

const initial = { draft: null, baseline: null, activeRouteId: null, pickingStart: false, focus: null, leaving: null };

/** The open route and its unsaved changes (spec §10.6). The UI store's `route` mode says whether it is being edited. */
export const useRouteDraft = create<RouteDraftState>()((set, get) => ({
  ...initial,
  newDraft: name => {
    const draft = emptyDraft(name);
    set({ draft, baseline: draft, activeRouteId: null, pickingStart: false });
  },
  load: route => {
    const draft = draftFromRoute(route);
    set({ draft, baseline: draft, activeRouteId: route.id, pickingStart: false });
  },
  apply: (action, { index, toast, t }) => {
    const current = get().draft ?? emptyDraft('');
    const { draft: reduced, notice } = draftReducer(current, action);
    if (notice) toast.show({ message: noticeMessage(notice, t) });
    const { draft: known, dropped } = dropUnknown(reduced, index);
    if (dropped > 0) toast.show({ message: t('routes.dropped', { count: dropped }) });
    const next = RESHAPING.has(action.type) && !known.manualOrder && known !== current ? optimizeDraft(known, index) : known;
    if (next !== current) set({ draft: next });
  },
  beginEdit: ({ index, toast, t }) => {
    const current = get().draft;
    if (!current) return;
    const { draft, dropped } = dropUnknown(current, index);
    if (dropped > 0) toast.show({ message: t('routes.dropped', { count: dropped }) });
    set({ draft });
    const ui = useUiStore.getState();
    if (ui.interactionMode !== 'route') ui.setMode('route');
  },
  revert: () => set(s => (s.baseline?.id
    ? { draft: s.baseline, pickingStart: false }
    : { draft: null, baseline: null, activeRouteId: null, pickingStart: false })),
  close: () => set({ draft: null, baseline: null, activeRouteId: null, pickingStart: false }),
  requestLeave: leaving => set({ leaving }),
  setPickingStart: on => set({ pickingStart: on }),
  flyTo: actor => set(s => ({ focus: { actor, n: (s.focus?.n ?? 0) + 1 } })),
  reset: () => set(initial),
}));

export function isDirty(s: Pick<RouteDraftState, 'draft' | 'baseline'>): boolean {
  return s.draft !== null && (s.baseline === null || !sameRoute(s.draft, s.baseline));
}

/**
 * The route on the map (spec §10.6): the draft while editing, else the active saved route. Map code
 * (markers, polyline) reads it; it fetches the routes only when a saved route is active.
 */
export function useShownRoute(worldId: string): { start: string | null; stops: readonly string[] } | null {
  const editing = useUiStore(s => s.interactionMode === 'route');
  const draft = useRouteDraft(s => s.draft);
  const activeId = useRouteDraft(s => s.activeRouteId);
  const routes = useRoutesQuery(worldId, activeId !== null).data;
  return useMemo(() => {
    if (editing && draft) return draft;
    const active = activeId === null ? undefined : routes?.find(r => r.id === activeId);
    return active ? { start: active.startActor, stops: active.stops } : null;
  }, [editing, draft, activeId, routes]);
}

/** Stop numbers on the markers: the start is 0 (badge "S"), stops count from 1. */
export function useRouteIndex(worldId: string): ReadonlyMap<string, number> {
  const shown = useShownRoute(worldId);
  return useMemo(() => {
    const m = new Map<string, number>();
    if (!shown) return m;
    shown.stops.forEach((s, i) => m.set(s, i + 1));
    if (shown.start !== null) m.set(shown.start, 0);
    return m;
  }, [shown]);
}

/** POST for a new route, PUT for a saved one; the answer goes into the routes cache at once. */
export async function saveRoute(worldId: string, draft: RouteDraft, queryClient: QueryClient): Promise<RouteDto> {
  const body: RouteInput = { name: draft.name.trim(), startActor: draft.start ?? '', stops: draft.stops };
  const saved = draft.id === null
    ? await api<RouteDto>('POST', routesPath(worldId), body)
    : await api<RouteDto>('PUT', `${routesPath(worldId)}/${encodeURIComponent(draft.id)}`, body);
  // The server lists the most recently changed route first.
  queryClient.setQueryData<RouteDto[]>(queryKeys.routes(worldId), list => [saved, ...(list ?? []).filter(r => r.id !== saved.id)]);
  void queryClient.invalidateQueries({ queryKey: queryKeys.routes(worldId) });
  return saved;
}

export async function deleteRoute(worldId: string, routeId: string, queryClient: QueryClient): Promise<void> {
  await api<void>('DELETE', `${routesPath(worldId)}/${encodeURIComponent(routeId)}`);
  queryClient.setQueryData<RouteDto[]>(queryKeys.routes(worldId), list => list?.filter(r => r.id !== routeId));
  void queryClient.invalidateQueries({ queryKey: queryKeys.routes(worldId) });
}
