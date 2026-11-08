import { useQuery } from '@tanstack/react-query';
import { create } from 'zustand';
import { DEFAULT_FUEL, type TransportData, type VehicleId } from '../../../shared/transport.js';
import { routeLengthInput, type VehicleRoute, type WorldPoint } from '../../../shared/vehicleRoute.js';
import { api, ApiClientError } from '../../app/api.js';
import { queryKeys } from '../../app/queryKeys.js';
import { useUiStore, type InteractionMode } from '../../app/store.js';

/**
 * The vehicle data of a dataset version (`/data/<v>/transport.json`). `null` for a dataset built
 * without it; undefined while loading or while not `enabled` (only fetched once the calculator opens).
 */
export function useTransportData(version: string, enabled = true): { data: TransportData | null | undefined; failed: boolean } {
  const q = useQuery({
    queryKey: queryKeys.transport(version),
    enabled,
    queryFn: async () => {
      try {
        return await api<TransportData>('GET', `/data/${encodeURIComponent(version)}/transport.json`);
      } catch (e) {
        if (e instanceof ApiClientError && e.status === 404) return null;
        throw e;
      }
    },
    staleTime: Infinity,
  });
  return { data: q.data, failed: q.isError };
}

export type CalcGoal = 'vehicles' | 'rate';

/** The form as typed (strings, so a half-typed number stays as it is). Speed and stop time per vehicle. */
export interface CalcForm {
  route: string;
  vehicle: VehicleId;
  item: string;
  speed: Partial<Record<VehicleId, string>>;
  stop: Partial<Record<VehicleId, string>>;
  /** Fuel item class of the wheeled vehicles. */
  fuel: string;
  /** Fuel item class of the drone (it takes fewer fuels, and its speed depends on the fuel). */
  droneFuel: string;
  goal: CalcGoal;
  target: string;
  count: string;
}

export const EMPTY_FORM: CalcForm = { route: '', vehicle: 'truck', item: '', speed: {}, stop: {}, fuel: DEFAULT_FUEL, droneFuel: DEFAULT_FUEL, goal: 'vehicles', target: '', count: '' };

/** The map mode in which clicks on the map pick the route's start and destination. */
export const PICK_MODE = 'vehicle-route' satisfies InteractionMode;

interface VehicleCalcState {
  /**
   * The calculator is open. It stays true while points are picked on the map: the dialog is hidden for as long as
   * the map is in PICK_MODE and comes back when the mode ends, however it ends.
   */
  open: boolean;
  form: CalcForm;
  /** Start and destination picked on the map; shown on the map while set, the dialog closed or not. */
  route: VehicleRoute | null;
  /** While picking: the start picked so far, null while the map waits for it. */
  pickedStart: WorldPoint | null;
  /**
   * The route length follows the points: set by a pick, cleared once the length is typed (or set from elsewhere).
   * A new pick always sets the length; moving a point changes it only while this is true.
   */
  lengthFromRoute: boolean;
  /** Opens the calculator (ending a pick); a route length (m) from elsewhere (e.g. a route planner) replaces the typed one. */
  show(routeMeters?: number): void;
  hide(): void;
  setForm(patch: Partial<CalcForm>): void;
  /** Hides the dialog and waits for the start and the destination on the map (PICK_MODE). */
  startPicking(): void;
  /** A point picked on the map: the start, then the destination, which sets the route and its length and reopens the dialog. */
  pick(point: WorldPoint): void;
  /** Leaves PICK_MODE without a new route (the old one stays) and reopens the dialog. */
  cancelPicking(): void;
  /** Moves the start or the destination (dragged on the map). */
  moveRoutePoint(which: keyof VehicleRoute, point: WorldPoint): void;
  /** Sets the route length to the route's straight line again, and lets it follow the points. */
  applyRouteLength(): void;
  /** Forgets the points; the route length stays as it is. */
  clearRoute(): void;
}

function leavePickMode(): void {
  const ui = useUiStore.getState();
  if (ui.interactionMode === PICK_MODE) ui.setMode('inspect');
}

/**
 * The calculator's own open/close state, its form and the route picked on the map, kept while the dialog is closed
 * (for this tab only). Anything can open it with `useVehicleCalc.getState().show()`.
 */
export const useVehicleCalc = create<VehicleCalcState>()((set, get) => ({
  open: false,
  form: EMPTY_FORM,
  route: null,
  pickedStart: null,
  lengthFromRoute: false,
  show: routeMeters => {
    leavePickMode();
    set(s => routeMeters === undefined
      ? { open: true }
      : { open: true, form: { ...s.form, route: String(routeMeters) }, lengthFromRoute: false });
  },
  hide: () => set({ open: false }),
  setForm: patch => set(s => ({ form: { ...s.form, ...patch }, lengthFromRoute: 'route' in patch ? false : s.lengthFromRoute })),
  startPicking: () => {
    set({ open: true, pickedStart: null });
    const ui = useUiStore.getState();
    if (ui.interactionMode !== PICK_MODE) ui.setMode(PICK_MODE);
  },
  pick: point => {
    const start = get().pickedStart;
    if (start === null) {
      set({ pickedStart: point });
      return;
    }
    const route = { start, end: point };
    set(s => ({ route, pickedStart: null, form: { ...s.form, route: routeLengthInput(route) }, lengthFromRoute: true, open: true }));
    leavePickMode();
  },
  cancelPicking: () => {
    set({ pickedStart: null, open: true });
    leavePickMode();
  },
  moveRoutePoint: (which, point) => set(s => {
    if (!s.route) return {};
    const route = { ...s.route, [which]: point };
    return s.lengthFromRoute ? { route, form: { ...s.form, route: routeLengthInput(route) } } : { route };
  }),
  applyRouteLength: () => set(s => (s.route ? { form: { ...s.form, route: routeLengthInput(s.route) }, lengthFromRoute: true } : {})),
  clearRoute: () => set({ route: null, lengthFromRoute: false }),
}));
