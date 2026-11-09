import { create } from 'zustand';

/**
 * Whether the server looks like it is in maintenance mode, as far as API answers tell (`api.ts` reports every 503).
 * `MaintenanceBanner` then asks `GET /api/version` and shows the banner while the server says so. Kept apart from the
 * banner so `api.ts` can report without importing it.
 */
interface MaintenanceSuspicion {
  /** Bumped by every 503 answer. */
  seq: number;
}

export const useMaintenanceSuspicion = create<MaintenanceSuspicion>(() => ({ seq: 0 }));

export function suspectMaintenance(): void {
  useMaintenanceSuspicion.setState(s => ({ seq: s.seq + 1 }));
}
