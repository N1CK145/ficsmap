import { create } from 'zustand';
import { requestDetailZoom } from '../../map/zoom.js';
import { usePanelsCollapsed } from '../../worlds/SidebarPanelView.js';
import { useFactoryView } from '../view.js';
import type { HeightRange } from './height.js';

/**
 * The factory map's own state (the snapshot choice, comparison and highlight are shared with the Fabrik page in
 * `useFactoryView`): whether the factory layers show, which of them, the colour mode and whether changes are marked.
 * Remembered per device. What is selected on the map is not remembered.
 */

export const FACTORY_LAYERS = ['floor', 'buildings', 'lines', 'power', 'roads', 'markers', 'crates', 'fog'] as const;
export type FactoryLayer = (typeof FACTORY_LAYERS)[number];

export const COLOR_MODES = ['category', 'productivity'] as const;
export type ColorMode = (typeof COLOR_MODES)[number];

/** How "Änderungen" picks the snapshot compared against: always the one before the shown one, or a chosen one. */
export type CompareMode = 'previous' | 'chosen';

export interface FactoryMapView {
  visible: boolean;
  layers: Record<FactoryLayer, boolean>;
  colorMode: ColorMode;
  compareMode: CompareMode;
  /** With a height range: draw what lies below it as faint outlines ("Darunter blass zeigen"). */
  heightBelow: boolean;
}

/** A world's height range as remembered: the range in whole metres and the save session it was chosen for. */
export interface StoredHeight extends HeightRange { session: string }

export type FactorySelection =
  | { kind: 'building'; id: string }
  | { kind: 'vehicle'; id: string };

/** How a selection was made: from a button (focus moves to the info window and returns to `opener` on close). */
export interface SelectOptions {
  focus?: boolean;
  /** The control that opened the info window; focus returns to it when the window closes. */
  opener?: HTMLElement | null;
}

interface FactoryMapState extends FactoryMapView {
  selection: FactorySelection | null;
  /** The info window should move the focus to its title (it was opened from a button). */
  pendingFocus: boolean;
  /** Where the focus goes back when the info window closes (the button that opened it), or null. */
  returnFocus: HTMLElement | null;
  /** The height range per world id (`height.ts`), remembered per device; none: everything shows. */
  heights: Readonly<Record<string, StoredHeight>>;
  /** The last `useFactoryView.highlightSeq` the map fitted to. */
  fittedSeq: number;
  /** Bumped by "Go to the changes": the map fits to the area of changes `changeArea`. */
  fitChangesSeq: number;
  /** The area of changes "Go to the changes" last led to (`changeAreas`, densest first); -1 before the first. */
  changeArea: number;
  /** How many areas of changes the map found for the shown comparison (the timeline's "Area 1 of n"). */
  changeAreaCount: number;
  /**
   * The production line under the pointer or the focus (a building on the map, a row of the panel's list): it lights
   * up on the map over the selected one (`useFactoryView.lineId`). Not shared with the page.
   */
  hoverLineId: string | null;
  /**
   * The production line the map last brought into view, or chose itself (a click on it: no fit there). A chosen line
   * (`useFactoryView.lineId`, also from the line diagram's way to the map) that differs is fitted to once; null asks
   * for a fit to the chosen line again ("Zur Linie").
   */
  fittedLineId: string | null;
  /**
   * The building (or belt) a line was chosen by on the map: the map pans it clear of the line's card, so a second tap
   * reaches it. Null when the line was chosen elsewhere.
   */
  lineAnchor: string | null;
  /**
   * The line last opened on the map itself (`openLine`). A chosen line that differs came from elsewhere (the line
   * diagram's "Karte"): on arrival the map fits to it and moves the focus to its card.
   */
  openedLineId: string | null;
  toggle(): void;
  setVisible(v: boolean): void;
  toggleLayer(l: FactoryLayer): void;
  setColorMode(m: ColorMode): void;
  setCompareMode(m: CompareMode): void;
  /** Sets a world's height range (null: all heights) for the shown save's session. */
  setHeight(worldId: string, range: HeightRange | null, session?: string): void;
  setHeightBelow(on: boolean): void;
  select(s: FactorySelection | null, opts?: SelectOptions): void;
  focusHandled(): void;
  setFittedSeq(seq: number): void;
  /** "Go to the changes": on to the next area of changes (from the densest, round again after the last). */
  requestFitChanges(): void;
  /** The map found `count` areas of changes for a new comparison: stepping starts again at the densest. */
  setChangeAreaCount(count: number): void;
  hoverLine(id: string | null): void;
  setFittedLineId(id: string | null): void;
  /** Fit the map to the chosen line again. */
  requestLineFit(): void;
  /**
   * Opens a production line's card in the info window (closing a building's): `useFactoryView.selectLine` plus,
   * from a button, the focus moving to the window's title and back to `opener` on close; `reveal` fits the map to it
   * (without, the line is where the user clicked on the map).
   */
  openLine(id: string, opts?: SelectOptions & { reveal?: boolean; anchor?: string | null }): void;
}

const KEY = 'ficsmap:factoryMap';
/**
 * Version of the remembered view. Version 1 stored the colour mode on every change while "category" was the default,
 * so a stored "category" there says nothing about a choice: from version 2 on the productivity mode is the default
 * and a version 1 colour mode is ignored.
 */
const VERSION = 2;

export const DEFAULT_VIEW: FactoryMapView = {
  visible: false,
  layers: { floor: true, buildings: true, lines: true, power: false, roads: true, markers: true, crates: true, fog: false },
  colorMode: 'productivity',
  compareMode: 'previous',
  heightBelow: false,
};

/** The remembered view, keeping only valid fields. */
export function loadFactoryMapView(): FactoryMapView {
  const view: FactoryMapView = { ...DEFAULT_VIEW, layers: { ...DEFAULT_VIEW.layers } };
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    // Storage can be blocked; remembering is best effort.
  }
  if (raw === null) return view;
  let d: Record<string, unknown>;
  try {
    const data: unknown = JSON.parse(raw);
    if (data === null || typeof data !== 'object') return view;
    d = data as Record<string, unknown>;
  } catch {
    return view;
  }
  if (typeof d.visible === 'boolean') view.visible = d.visible;
  if (d.layers && typeof d.layers === 'object') {
    for (const l of FACTORY_LAYERS) {
      const v = (d.layers as Record<string, unknown>)[l];
      if (typeof v === 'boolean') view.layers[l] = v;
    }
  }
  if (d.v === VERSION && COLOR_MODES.includes(d.colorMode as ColorMode)) view.colorMode = d.colorMode as ColorMode;
  if (d.compareMode === 'previous' || d.compareMode === 'chosen') view.compareMode = d.compareMode;
  if (typeof d.heightBelow === 'boolean') view.heightBelow = d.heightBelow;
  return view;
}

function save(v: FactoryMapView): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({
      v: VERSION, visible: v.visible, layers: v.layers, colorMode: v.colorMode, compareMode: v.compareMode, heightBelow: v.heightBelow,
    }));
  } catch {
    // Not remembering is fine.
  }
}

/** Where the height ranges are remembered: `{ v: 1, worlds: { [worldId]: { lo, hi, session } } }`. */
export const HEIGHT_KEY = 'ficsmap:factoryMap:height';

/** The remembered height ranges per world, keeping only valid entries. */
export function loadHeights(): Record<string, StoredHeight> {
  const out: Record<string, StoredHeight> = {};
  try {
    const data: unknown = JSON.parse(localStorage.getItem(HEIGHT_KEY) ?? 'null');
    const worlds = data && typeof data === 'object' ? (data as { v?: unknown; worlds?: unknown }).worlds : null;
    if ((data as { v?: unknown } | null)?.v !== 1 || !worlds || typeof worlds !== 'object') return out;
    for (const [id, r] of Object.entries(worlds as Record<string, unknown>)) {
      const { lo, hi, session } = (r ?? {}) as Record<string, unknown>;
      if (Number.isInteger(lo) && Number.isInteger(hi) && (lo as number) <= (hi as number) && typeof session === 'string') {
        out[id] = { lo: lo as number, hi: hi as number, session };
      }
    }
  } catch {
    // Blocked or broken storage: nothing remembered.
  }
  return out;
}

function saveHeights(heights: Readonly<Record<string, StoredHeight>>): void {
  try {
    localStorage.setItem(HEIGHT_KEY, JSON.stringify({ v: 1, worlds: heights }));
  } catch {
    // Not remembering is fine.
  }
}

/** The id of the sidebar panel "Fabrikplan". */
export const FACTORY_PANEL_ID = 'factory-map';

/** Key of the factory map's request for the detail zoom (map/zoom.ts). */
export const ZOOM_KEY = 'factory';

export const useFactoryMap = create<FactoryMapState>()((set, get) => {
  const initial = loadFactoryMapView();
  // Before the map is created: a remembered close-up view keeps its zoom.
  requestDetailZoom(ZOOM_KEY, initial.visible);
  const update = (patch: Partial<FactoryMapView>) => {
    const was = get().visible;
    set(patch);
    save(get());
    // Switched on: the Fabrikplan panel gets the room in the sidebar (the other panels fold, it scrolls into view), so
    // its legend and lines are in sight; switched off, the panels go back to how the user had them. Only for as long
    // as the plan is on and never remembered, so nothing the user folded or unfolded is lost.
    if (patch.visible !== undefined && patch.visible !== was) usePanelsCollapsed.getState().setSolo(patch.visible ? FACTORY_PANEL_ID : null);
  };
  return {
    ...initial,
    selection: null,
    pendingFocus: false,
    returnFocus: null,
    heights: loadHeights(),
    fittedSeq: 0,
    fitChangesSeq: 0,
    changeArea: -1,
    changeAreaCount: 0,
    hoverLineId: null,
    fittedLineId: null,
    lineAnchor: null,
    openedLineId: null,
    toggle: () => update({ visible: !get().visible }),
    setVisible: visible => { if (visible !== get().visible) update({ visible }); },
    toggleLayer: l => update({ layers: { ...get().layers, [l]: !get().layers[l] } }),
    setColorMode: colorMode => update({ colorMode }),
    setCompareMode: compareMode => update({ compareMode }),
    setHeight: (worldId, range, session = '') => {
      const was = get().heights[worldId];
      if (!range && !was) return;
      if (range && was && was.lo === range.lo && was.hi === range.hi && was.session === session) return;
      const heights = { ...get().heights };
      if (range) heights[worldId] = { lo: range.lo, hi: range.hi, session };
      else delete heights[worldId];
      set({ heights });
      saveHeights(heights);
    },
    setHeightBelow: heightBelow => update({ heightBelow }),
    select: (selection, opts = {}) => {
      const was = get();
      if (selection === null) { set({ selection, pendingFocus: false }); return; }
      // Opened from a button: the first opener (a list in the panel) stays the place to return to, also when the
      // window then moves on (a route stop in the window selects its station).
      const returnFocus = opts.focus ? (was.selection && was.returnFocus ? was.returnFocus : opts.opener ?? null) : null;
      set({ selection, pendingFocus: opts.focus === true, returnFocus });
    },
    focusHandled: () => set({ pendingFocus: false }),
    setFittedSeq: fittedSeq => set({ fittedSeq }),
    requestFitChanges: () => {
      const { changeArea, changeAreaCount, fitChangesSeq } = get();
      set({ changeArea: changeAreaCount > 0 ? (changeArea + 1) % changeAreaCount : -1, fitChangesSeq: fitChangesSeq + 1 });
    },
    setChangeAreaCount: changeAreaCount => set({ changeAreaCount, changeArea: -1 }),
    hoverLine: hoverLineId => { if (hoverLineId !== get().hoverLineId) set({ hoverLineId }); },
    setFittedLineId: fittedLineId => set({ fittedLineId }),
    requestLineFit: () => set({ fittedLineId: null }),
    openLine: (id, opts = {}) => {
      const was = get();
      const returnFocus = opts.focus ? (was.returnFocus ?? opts.opener ?? null) : was.returnFocus;
      set({
        selection: null, pendingFocus: opts.focus === true, returnFocus, hoverLineId: null, fittedLineId: opts.reveal ? null : id,
        lineAnchor: opts.reveal ? null : opts.anchor ?? null, openedLineId: id,
      });
      useFactoryView.getState().selectLine(id);
    },
  };
});
