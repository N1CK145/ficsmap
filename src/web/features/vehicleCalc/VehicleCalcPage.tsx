import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { WorldCtx } from '../../app/feature.js';
import { RoutePicker } from './RoutePicker.js';
import { useTransportData, useVehicleCalc } from './useVehicleCalc.js';
import { VehicleCalculator } from './VehicleCalculator.js';

/**
 * The calculator page (`/w/:id/vehicles`), bound to `useVehicleCalc`, for the world's dataset version. Coming here
 * (the tool, Back) ends a pick on the map that is still going on, keeping the route it had.
 */
export function VehicleCalcPage({ ctx }: { ctx: WorldCtx }) {
  const { t } = useTranslation();
  const form = useVehicleCalc(s => s.form);
  const setForm = useVehicleCalc(s => s.setForm);
  const { data, failed } = useTransportData(ctx.me.datasetVersion);
  useEffect(() => {
    useVehicleCalc.getState().stopPicking();
  }, []);
  if (failed) return <p role="alert">{t('vehicleCalc.failed')}</p>;
  if (data === undefined) return <p>{t('common.loading')}</p>;
  if (data === null) return <p>{t('vehicleCalc.unavailable')}</p>;
  return <VehicleCalculator data={data} form={form} onChange={setForm} picker={<RoutePicker ctx={ctx} />} />;
}
