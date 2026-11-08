import type { FeatureModule, MapMode } from '../../app/feature.js';
import { pageTool } from '../../app/tools.js';
import { PickBanner } from './PickBanner.js';
import { PickReturn } from './PickReturn.js';
import { PICK_MODE, useVehicleCalc, VEHICLES_PAGE } from './useVehicleCalc.js';
import { VehicleCalcPage } from './VehicleCalcPage.js';
import { VehicleRouteLayer } from './VehicleRouteLayer.js';

export { VehicleCalcPage } from './VehicleCalcPage.js';
export { PICK_MODE, useVehicleCalc, VEHICLES_PAGE, vehiclesPath } from './useVehicleCalc.js';

/** "Vehicles" in the tool navigation: leads to the calculator page. */
export const vehicleCalcTool = pageTool({ id: 'vehicle-calc', order: 50, labelKey: 'vehicleCalc.open', hintKey: 'vehicleCalc.openHint', page: VEHICLES_PAGE });

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
 * Vehicle calculator: what one vehicle does on a route with a fuel (stacks per minute, round trip, fuel per trip), every
 * fuel compared, and the vehicles needed for a throughput, from the dataset's `transport.json`. A world page
 * (`/w/:id/vehicles`) at full width, reached from the tool navigation. The route length is typed or picked on the
 * map: "Pick on the map" goes to the map in PICK_MODE (the straight line between start and destination), and the
 * destination, Esc or Cancel bring the calculator page back (`PickReturn`). The picked route stays on the map.
 * Self-contained: its form and route live in `useVehicleCalc`; anything else can open it by navigating to
 * `vehiclesPath(worldId)`.
 */
export const vehicleCalcFeature: FeatureModule = {
  id: 'vehicleCalc',
  tools: [vehicleCalcTool],
  pages: [{ id: VEHICLES_PAGE, titleKey: 'vehicleCalc.title', Component: VehicleCalcPage }],
  mapModes: [pickRouteMode],
  mapLayers: [
    // Over the route planner's line (110).
    { id: 'vehicle-route', order: 115, Component: VehicleRouteLayer },
    { id: 'vehicle-pick-return', order: 116, Component: PickReturn },
  ],
};
