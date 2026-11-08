import type { FeatureModule, MapMode, Tool } from '../../app/feature.js';
import { PickBanner } from './PickBanner.js';
import { PICK_MODE, useVehicleCalc } from './useVehicleCalc.js';
import { VehicleCalcHost } from './VehicleCalcDialog.js';
import { VehicleRouteLayer } from './VehicleRouteLayer.js';

export { VehicleCalcDialog } from './VehicleCalcDialog.js';
export { PICK_MODE, useVehicleCalc } from './useVehicleCalc.js';

/** "Vehicles" in the tool navigation: opens the calculator. */
export const vehicleCalcTool: Tool = {
  id: 'vehicle-calc', order: 50, labelKey: 'vehicleCalc.open', hintKey: 'vehicleCalc.openHint', action: true,
  useTool: () => {
    const show = useVehicleCalc(s => s.show);
    return { available: true, run: () => show() };
  },
};

/**
 * Picking the route's start and destination on the map: a click on the map gives that point, a click on a marker
 * the marker's position. The banner says which point is next; Esc or Cancel leave.
 */
export const pickRouteMode: MapMode = {
  id: PICK_MODE,
  onMarkerClick: item => useVehicleCalc.getState().pick({ x: item.x, y: item.y }),
  onMapClick: point => useVehicleCalc.getState().pick(point),
  Banner: PickBanner,
};

/**
 * Vehicle calculator: what one vehicle does on a route (trip times, fuel, stacks per minute), the vehicles needed for
 * a throughput, or the throughput of a number of vehicles, from the dataset's `transport.json`. The route length is
 * typed or picked on the map (PICK_MODE; the straight line between start and destination), and the picked route
 * stays on the map. Self-contained: its own open state, form and route (`useVehicleCalc`) and dialog (a header item,
 * so it renders in the top layer), opened from the tool navigation; anything else can open it with
 * `useVehicleCalc.getState().show(routeMeters?)`.
 */
export const vehicleCalcFeature: FeatureModule = {
  id: 'vehicleCalc',
  tools: [vehicleCalcTool],
  headerItems: [{ id: 'vehicle-calc-dialog', order: 1000, Component: VehicleCalcHost }],
  mapModes: [pickRouteMode],
  // Over the route planner's line (110).
  mapLayers: [{ id: 'vehicle-route', order: 115, Component: VehicleRouteLayer }],
};
