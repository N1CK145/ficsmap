import type { QueryClient } from '@tanstack/react-query';
import type { FC, ReactNode } from 'react';
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
export interface MapMode {
  id: InteractionMode;
  onMarkerClick(item: Item, ctx: WorldCtx): void;
  /**
   * A mode with this takes points anywhere on the map (a crosshair cursor): a click away from the markers gives the
   * world position (units), a click on a marker goes to `onMarkerClick`. Markers count only where they are icons
   * (from DOT_ZOOM); a click on a dot is a point, and does not zoom in.
   */
  onMapClick?(point: { x: number; y: number }, ctx: WorldCtx): void;
  cursor?: string;
  Banner?: FC;
}
export interface MapControl { id: string; order: number; Component: FC<{ ctx: WorldCtx }> }
export interface MapOverlay { id: string; order: number; Component: FC<{ ctx: WorldCtx }> }
export interface ItemDetailSection { id: string; order: number; applies(item: Item): boolean; Component: FC<{ item: Item; ctx: WorldCtx }> }
export interface ItemAction { id: string; order: number; Component: FC<{ item: Item; ctx: WorldCtx }> }
/**
 * `slot`: where in the top bar the item goes. `start` (default) follows the world name; `center` is
 * centred in the bar (the search). On mobile both sit in one row.
 */
export interface HeaderItem { id: string; order: number; slot?: 'start' | 'center'; Component: FC<{ ctx: WorldCtx }> }

/** What a tool shows and does right now; returned by `Tool.useTool` on every render. */
export interface ToolState {
  /** False hides the tool, e.g. the caves switch for a dataset without caves (also while that is still loading). */
  available: boolean;
  /** For a switch: whether it is on (aria-pressed, a filled button). Leave it out for a plain action. */
  pressed?: boolean;
  /** A click: flip the switch, or run the action. Not used by a tool that leads to a world page (`Tool.page`): that one is a link. */
  run?(): void;
}

/**
 * A tool in the top bar's tool navigation (next to the search): a switch such as a map layer or a
 * mode, or an action. Shown as buttons on wide screens and in a "Tools" menu on narrow ones and on
 * mobile, so a tool only describes itself. `toggleTool()` (app/tools.ts) builds one for a
 * `{ visible, toggle }` store.
 */
export interface Tool {
  id: string; order: number; labelKey: string;
  /** Tooltip (title) and the description in the menu. */
  hintKey?: string;
  /** A small decorative glyph or SVG in front of the label (hidden from assistive technology). */
  icon?: ReactNode;
  /** `aria-keyshortcuts`, e.g. "Q"; the feature handles the key itself. */
  shortcut?: string;
  /**
   * Not a map switch (a world page such as the planner, or something else of its own). On wide screens such tools are
   * listed in the Tools menu next to the map switches' buttons, so the top bar stays short.
   */
  action?: boolean;
  /**
   * The id of the world page (`FeatureModule.pages`) the tool leads to: the tool is a link to that page, marked as the
   * current page (`aria-current="page"`) while it is shown. `pageTool()` (app/tools.ts) builds one.
   */
  page?: string;
  /** A hook, called by the tool's own button component on every render. */
  useTool(ctx: WorldCtx): ToolState;
}

/**
 * One result of the header search. Every source of results (collectibles, biomes, caves, crash
 * sites, later recipes) is a `SearchProvider` that returns these; the search box matches, ranks,
 * lists and highlights them without knowing where they come from.
 */
export interface SearchEntry {
  /** Unique over all providers, e.g. `item:BP_WAT139`. */
  id: string;
  /** The result's name in the current language; also matched. */
  label: string;
  /** Second line, e.g. the actor ID or what lies at a crash site. */
  detail?: string;
  /** i18n key of the kind shown next to the result ("Biome", "Cave", ...). */
  kindKey: string;
  /** More text the query is matched against: IDs, the name in the other language, synonyms. */
  terms: readonly string[];
  /** Map items the entry stands for: highlighted on the map while it matches and after it is chosen. */
  actors?: readonly string[];
  /** Between equally good matches, lower comes first; defaults to the provider's `order`. */
  weight?: number;
  /** A small icon in front of the label (decorative). */
  icon?: ReactNode;
  /**
   * What choosing the entry does besides highlighting its `actors` (select the item, scope the biome, ...). An entry
   * with `actors` is about the map: chosen on a world page, the search shows the map first, then calls this. Act on the
   * map through requests the map carries out once it is shown (`focusItem`, `setBiomeScope`, `useMapFit`).
   */
  onSelect?(ctx: WorldCtx): void;
}

export interface SearchProvider {
  id: string; order: number;
  /**
   * A hook returning the provider's entries, or undefined while its data loads. Called on every
   * render of the search box, in feature order (the list is fixed, so the hook order is too).
   * `active` turns true once the user opens the search and stays true: wait for it before loading
   * large files. Return the same array while nothing changed; the search prepares it once.
   */
  useEntries(ctx: WorldCtx, active: boolean): readonly SearchEntry[] | undefined;
}
/**
 * A page of its own under the world's URL, `/w/:id/<id>` (the production planner: `/w/:id/planner`). It takes the
 * whole main area at full width instead of the sidebar, the map and the item panel (on mobile also the bottom sheets),
 * under a page heading with a way back to the map. The world layout around it stays mounted (event stream, stores,
 * header with the search and the tools), so a page keeps its state in a store and finds it again on the next visit.
 */
export interface WorldPage {
  /** Unique; also the page's path segment under `/w/:id`: short, lower-case English (`planner`, `vehicles`, `wiki`). */
  id: string;
  /**
   * A route path below the page's own segment for deep links into the page, e.g. `:entry?` for `/w/:id/wiki/:entry?`.
   * The page reads it with `useParams()`.
   */
  subPath?: string;
  /** The page heading (also the name of its `main` landmark). */
  titleKey: string;
  Component: FC<{ ctx: WorldCtx }>;
}
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
  /** Stacked top right under the zoom buttons, inside the map; clicks on them do not reach the map. On/off switches belong in `tools`. */
  mapControls?: MapControl[];
  /** Free-standing boxes over the map (each positions itself, absolutely), under the item panel; clicks on them do not reach the map. */
  mapOverlays?: MapOverlay[];
  itemDetailSections?: ItemDetailSection[];
  itemActions?: ItemAction[];
  headerItems?: HeaderItem[];
  /** Switches and actions in the top bar's tool navigation (desktop: buttons, mobile: a menu). */
  tools?: Tool[];
  /** Pages of their own under the world's URL (`/w/:id/<id>`), shown at full width in place of the map. */
  pages?: WorldPage[];
  /** Sources of results for the header search. */
  searchProviders?: SearchProvider[];
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
