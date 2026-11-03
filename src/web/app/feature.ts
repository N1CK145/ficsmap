import type { QueryClient } from '@tanstack/react-query';
import type { FC } from 'react';
import type { RouteObject } from 'react-router';
import type { MeDto, WorldDto } from '../../shared/api.js';
import type { DatasetIndex, Item } from '../../shared/dataset.js';
import type { SseEvent } from '../../shared/sse.js';
import type { ToastApi } from '../components/Toast.js';
import type { InteractionMode } from './store.js';

/**
 * Everything a world-scoped extension point gets (spec §4.2). `navigate` and `toast` let code outside
 * components (SSE handlers, map modes) act without hooks.
 */
export interface WorldCtx {
  worldId: string; world: WorldDto; me: MeDto; index: DatasetIndex; queryClient: QueryClient;
  navigate: (to: string, opts?: { replace?: boolean }) => void; toast: ToastApi;
}

export interface SidebarPanel {
  id: string; order: number; titleKey: string; Component: FC<{ worldId: string }>; visible?: (ctx: WorldCtx) => boolean;
  /** Only in the desktop sidebar, not in the mobile bottom sheet (e.g. the Map | List switch: there the sheet's full height is the list). */
  desktopOnly?: boolean;
}
export interface MapLayer { id: string; order: number; Component: FC<{ ctx: WorldCtx }> }
export interface MapMode { id: InteractionMode; onMarkerClick(item: Item, ctx: WorldCtx): void; cursor?: string; Banner?: FC }
export interface MapControl { id: string; order: number; Component: FC<{ ctx: WorldCtx }> }
export interface ItemDetailSection { id: string; order: number; applies(item: Item): boolean; Component: FC<{ item: Item; ctx: WorldCtx }> }
export interface ItemAction { id: string; order: number; Component: FC<{ item: Item; ctx: WorldCtx }> }
export interface HeaderItem { id: string; order: number; Component: FC<{ ctx: WorldCtx }> }
export interface SettingsSection { id: string; order: number; ownerOnly: boolean; Component: FC<{ ctx: WorldCtx }> }
export type SseHandlerMap = { [K in SseEvent['type']]: (e: Extract<SseEvent, { type: K }>, ctx: WorldCtx) => void };

export interface FeatureModule {
  id: string;
  routes?: RouteObject[];
  sidebarPanels?: SidebarPanel[];
  /** Rendered inside the map's react-leaflet `MapContainer` (MapView), so they can use `useMap()`. */
  mapLayers?: MapLayer[];
  /** Exclusive click modes; the active one gets marker clicks and shows its `Banner` across the map top. */
  mapModes?: MapMode[];
  /** Stacked top right under the zoom buttons, inside the map; clicks on them do not reach the map. */
  mapControls?: MapControl[];
  itemDetailSections?: ItemDetailSection[];
  itemActions?: ItemAction[];
  headerItems?: HeaderItem[];
  settingsSections?: SettingsSection[];
  sseHandlers?: Partial<SseHandlerMap>;
}

export type ExtensionPoint = Exclude<keyof FeatureModule, 'id'>;

type AnySseHandler = (e: SseEvent, ctx: WorldCtx) => void;

const orderOf = (x: unknown): number => (x as { order?: number }).order ?? 0;

/**
 * All contributions to one extension point, flattened over the features and sorted by `order`
 * (stable, so entries without an order, like routes, keep feature order). `sseHandlers` are merged
 * into one map whose handlers call every contributing feature in feature order; one failing handler
 * is logged and does not stop the others.
 */
export function collect<K extends ExtensionPoint>(features: readonly FeatureModule[], key: K): NonNullable<FeatureModule[K]> {
  if (key === 'sseHandlers') return mergeSseHandlers(features) as NonNullable<FeatureModule[K]>;
  const items = features.flatMap(f => (f[key] as readonly unknown[] | undefined) ?? []);
  return items.sort((a, b) => orderOf(a) - orderOf(b)) as NonNullable<FeatureModule[K]>;
}

function mergeSseHandlers(features: readonly FeatureModule[]): Partial<SseHandlerMap> {
  const byType = new Map<string, AnySseHandler[]>();
  for (const f of features) {
    for (const [type, handler] of Object.entries(f.sseHandlers ?? {})) {
      byType.set(type, [...(byType.get(type) ?? []), handler as AnySseHandler]);
    }
  }
  const merged: Record<string, AnySseHandler> = {};
  for (const [type, handlers] of byType) {
    merged[type] = (e, ctx) => {
      for (const h of handlers) {
        try {
          h(e, ctx);
        } catch (err) {
          console.error(`SSE handler for "${type}" failed`, err);
        }
      }
    };
  }
  return merged as Partial<SseHandlerMap>;
}

/** Calls the handler for `e.type`, if any. The map is keyed by type, so the lookup needs one cast. */
export function dispatchSse(handlers: Partial<SseHandlerMap>, e: SseEvent, ctx: WorldCtx): void {
  (handlers[e.type] as AnySseHandler | undefined)?.(e, ctx);
}
