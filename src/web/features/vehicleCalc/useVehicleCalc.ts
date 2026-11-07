import { useQuery } from '@tanstack/react-query';
import { create } from 'zustand';
import { DEFAULT_FUEL, type TransportData, type VehicleId } from '../../../shared/transport.js';
import { api, ApiClientError } from '../../app/api.js';
import { queryKeys } from '../../app/queryKeys.js';

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

interface VehicleCalcState {
  open: boolean;
  form: CalcForm;
  /** Opens the calculator; a route length (m) from elsewhere (e.g. a route planner) replaces the typed one. */
  show(routeMeters?: number): void;
  hide(): void;
  setForm(patch: Partial<CalcForm>): void;
}

/**
 * The calculator's own open/close state and its form, kept while the dialog is closed (for this tab
 * only). Anything can open it with `useVehicleCalc.getState().show()`.
 */
export const useVehicleCalc = create<VehicleCalcState>()(set => ({
  open: false,
  form: EMPTY_FORM,
  show: routeMeters => set(s => ({ open: true, form: routeMeters === undefined ? s.form : { ...s.form, route: String(routeMeters) } })),
  hide: () => set({ open: false }),
  setForm: patch => set(s => ({ form: { ...s.form, ...patch } })),
}));
