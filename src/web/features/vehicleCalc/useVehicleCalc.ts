import { useQuery } from '@tanstack/react-query';
import { create } from 'zustand';
import { DEFAULT_FUEL, type TransportData, type VehicleId } from '../../../shared/transport.js';
import { routeLengthInput, type VehicleRoute, type WorldPoint } from '../../../shared/vehicleRoute.js';
import { api, ApiClientError } from '../../app/api.js';
import { worldPath } from '../../app/pages.js';
import { queryKeys } from '../../app/queryKeys.js';
import { useUiStore, type InteractionMode } from '../../app/store.js';

/**
 * The vehicle data of a dataset version (`/data/<v>/transport.json`). `null` for a dataset built
 * without it; undefined while loading or while not `enabled` (fetched when the calculator page opens).
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

/** The calculator page's id, its path under the world (`/w/:id/vehicles`). */
export const VEHICLES_PAGE = 'vehicles';

/** `/w/<world>/vehicles`. */
export const vehiclesPath = (worldId: string) => worldPath(worldId, VEHICLES_PAGE);

interface VehicleCalcState {
  form: CalcForm;
  /** Start and destination picked on the map; shown on the map while set, on the calculator page or not. */
  route: VehicleRoute | null;
  /** While picking: the start picked so far, null while the map waits for it. */
  pickedStart: WorldPoint | null;
  /**
   * The route length follows the points: set by a pick, cleared once the length is typed (or set from elsewhere).
   * A new pick always sets the length; moving a point changes it only while this is true.
   */
  lengthFromRoute: boolean;
  /**
   * Set when picking ends with the destination or a cancel: the map goes back to the calculator page (`PickReturn`)
   * and clears it. Not set when another map mode takes over.
   */
  returnRequest: boolean;
  /** The form; a route length (m) set from elsewhere (e.g. a route planner) replaces the typed one: `setForm({ route })`. */
  setForm(patch: Partial<CalcForm>): void;
  /** Waits for the start and the destination on the map (PICK_MODE); the caller shows the map. */
  startPicking(): void;
  /** A point picked on the map: the start, then the destination, which sets the route and its length and asks to go back. */
  pick(point: WorldPoint): void;
  /** Leaves PICK_MODE without a new route (the old one stays) and asks to go back to the calculator. */
  cancelPicking(): void;
  /** Leaves PICK_MODE without a new route and without going anywhere (the calculator page is already shown). */
  stopPicking(): void;
  clearReturnRequest(): void;
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
 * The calculator's form and the route picked on the map, kept while the calculator page is not shown (for this tab
 * only). Anything can open the calculator by navigating to `vehiclesPath(worldId)`, with a route length after
 * `setForm({ route })`.
 */
export const useVehicleCalc = create<VehicleCalcState>()((set, get) => ({
  form: EMPTY_FORM,
  route: null,
  pickedStart: null,
  lengthFromRoute: false,
  returnRequest: false,
  setForm: patch => set(s => ({ form: { ...s.form, ...patch }, lengthFromRoute: 'route' in patch ? false : s.lengthFromRoute })),
  startPicking: () => {
    set({ pickedStart: null, returnRequest: false });
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
    set(s => ({ route, pickedStart: null, form: { ...s.form, route: routeLengthInput(route) }, lengthFromRoute: true, returnRequest: true }));
    leavePickMode();
  },
  cancelPicking: () => {
    set({ pickedStart: null, returnRequest: true });
    leavePickMode();
  },
  stopPicking: () => {
    set({ pickedStart: null, returnRequest: false });
    leavePickMode();
  },
  clearReturnRequest: () => set({ returnRequest: false }),
  moveRoutePoint: (which, point) => set(s => {
    if (!s.route) return {};
    const route = { ...s.route, [which]: point };
    return s.lengthFromRoute ? { route, form: { ...s.form, route: routeLengthInput(route) } } : { route };
  }),
  applyRouteLength: () => set(s => (s.route ? { form: { ...s.form, route: routeLengthInput(s.route) }, lengthFromRoute: true } : {})),
  clearRoute: () => set({ route: null, lengthFromRoute: false }),
}));
