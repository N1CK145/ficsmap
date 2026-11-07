import type { FeatureModule } from '../../app/feature.js';
import { VehicleCalcHeaderItem } from './VehicleCalcDialog.js';

export { VehicleCalcDialog } from './VehicleCalcDialog.js';
export { useVehicleCalc } from './useVehicleCalc.js';

/**
 * Vehicle calculator: vehicles needed for a throughput on a route, or the throughput of a number of
 * vehicles, from the dataset's `transport.json`. Self-contained: its own open state (`useVehicleCalc`)
 * and dialog; for now opened from a header button. A tools menu can open it with
 * `useVehicleCalc.getState().show(routeMeters?)` and render `<VehicleCalcDialog version=... />`.
 */
export const vehicleCalcFeature: FeatureModule = {
  id: 'vehicleCalc',
  headerItems: [{ id: 'vehicle-calc', order: 35, Component: VehicleCalcHeaderItem }],
};
