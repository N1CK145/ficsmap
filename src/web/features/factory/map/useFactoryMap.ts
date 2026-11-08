import { create } from 'zustand';
import { requestDetailZoom } from '../../map/zoom.js';

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
}

export type FactorySelection =
  | { kind: 'building'; id: string }
  | { kind: 'vehicle'; id: string };

interface FactoryMapState extends FactoryMapView {
  selection: FactorySelection | null;
  /** The last `useFactoryView.highlightSeq` the map fitted to. */
  fittedSeq: number;
  toggle(): void;
  setVisible(v: boolean): void;
  toggleLayer(l: FactoryLayer): void;
  setColorMode(m: ColorMode): void;
  setCompareMode(m: CompareMode): void;
  select(s: FactorySelection | null): void;
  setFittedSeq(seq: number): void;
}

const KEY = 'ficsmap:factoryMap';

export const DEFAULT_VIEW: FactoryMapView = {
  visible: false,
  layers: { floor: true, buildings: true, lines: true, power: false, roads: true, markers: true, crates: true, fog: false },
  colorMode: 'category',
  compareMode: 'previous',
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
  if (COLOR_MODES.includes(d.colorMode as ColorMode)) view.colorMode = d.colorMode as ColorMode;
  if (d.compareMode === 'previous' || d.compareMode === 'chosen') view.compareMode = d.compareMode;
  return view;
}

function save(v: FactoryMapView): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ visible: v.visible, layers: v.layers, colorMode: v.colorMode, compareMode: v.compareMode }));
  } catch {
    // Not remembering is fine.
  }
}

/** Key of the factory map's request for the detail zoom (map/zoom.ts). */
export const ZOOM_KEY = 'factory';

export const useFactoryMap = create<FactoryMapState>()((set, get) => {
  const initial = loadFactoryMapView();
  // Before the map is created: a remembered close-up view keeps its zoom.
  requestDetailZoom(ZOOM_KEY, initial.visible);
  const update = (patch: Partial<FactoryMapView>) => {
    set(patch);
    save(get());
  };
  return {
    ...initial,
    selection: null,
    fittedSeq: 0,
    toggle: () => update({ visible: !get().visible }),
    setVisible: visible => { if (visible !== get().visible) update({ visible }); },
    toggleLayer: l => update({ layers: { ...get().layers, [l]: !get().layers[l] } }),
    setColorMode: colorMode => update({ colorMode }),
    setCompareMode: compareMode => update({ compareMode }),
    select: selection => set({ selection }),
    setFittedSeq: fittedSeq => set({ fittedSeq }),
  };
});
