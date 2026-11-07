import type { FeatureModule, Tool } from '../../app/feature.js';
import { useVehicleCalc } from './useVehicleCalc.js';
import { VehicleCalcHost } from './VehicleCalcDialog.js';

export { VehicleCalcDialog } from './VehicleCalcDialog.js';
export { useVehicleCalc } from './useVehicleCalc.js';

/** "Vehicles" in the tool navigation: opens the calculator. */
export const vehicleCalcTool: Tool = {
  id: 'vehicle-calc', order: 50, labelKey: 'vehicleCalc.open', hintKey: 'vehicleCalc.openHint', action: true,
  useTool: () => {
    const show = useVehicleCalc(s => s.show);
    return { available: true, run: () => show() };
  },
};

/**
 * Vehicle calculator: vehicles needed for a throughput on a route, or the throughput of a number of
 * vehicles, from the dataset's `transport.json`. Self-contained: its own open state (`useVehicleCalc`)
 * and dialog (a header item, so it renders in the top layer), opened from the tool navigation; anything
 * else can open it with `useVehicleCalc.getState().show(routeMeters?)`.
 */
export const vehicleCalcFeature: FeatureModule = {
  id: 'vehicleCalc',
  tools: [vehicleCalcTool],
  headerItems: [{ id: 'vehicle-calc-dialog', order: 1000, Component: VehicleCalcHost }],
};
