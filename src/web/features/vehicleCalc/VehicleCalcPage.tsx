import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { routeGeometry } from '../../../shared/vehicleRoute.js';
import type { WorldCtx } from '../../app/feature.js';
import { IconsContext, useItemIcons } from '../machineWiki/icons.js';
import { RoutePicker } from './RoutePicker.js';
import { useTransportData, useVehicleCalc, useVehicleCalcWorld } from './useVehicleCalc.js';
import { VehicleCalculator, type StraightLine } from './VehicleCalculator.js';

/**
 * The calculator page (`/w/:id/vehicles`), bound to `useVehicleCalc` (this world's state), for the world's dataset
 * version, with the game's pictures of vehicles and fuels (dataset part `icons`; without it the page has none).
 * Coming here (the tool, Back) ends a pick on the map that is still going on, keeping the route it had.
 */
export function VehicleCalcPage({ ctx }: { ctx: WorldCtx }) {
  const { t } = useTranslation();
  useVehicleCalcWorld(ctx.worldId);
  const form = useVehicleCalc(s => s.form);
  const setForm = useVehicleCalc(s => s.setForm);
  const route = useVehicleCalc(s => s.route);
  const following = useVehicleCalc(s => s.lengthFromRoute);
  const { data, failed } = useTransportData(ctx.me.datasetVersion);
  const icons = useItemIcons(ctx.me.datasetVersion);
  useEffect(() => {
    useVehicleCalc.getState().stopPicking();
  }, []);
  if (failed) return <p role="alert">{t('vehicleCalc.failed')}</p>;
  if (data === undefined) return <p>{t('common.loading')}</p>;
  if (data === null) return <p>{t('vehicleCalc.unavailable')}</p>;
  const straightLine: StraightLine | null = route && {
    metres: Math.round(routeGeometry(route.start, route.end).meters), following, onApply: useVehicleCalc.getState().applyRouteLength,
  };
  return (
    <IconsContext.Provider value={icons}>
      <VehicleCalculator data={data} form={form} onChange={setForm} picker={<RoutePicker ctx={ctx} />} straightLine={straightLine} />
    </IconsContext.Provider>
  );
}
