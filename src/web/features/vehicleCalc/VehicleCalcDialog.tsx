import { useTranslation } from 'react-i18next';
import type { WorldCtx } from '../../app/feature.js';
import { useUiStore } from '../../app/store.js';
import { Dialog } from '../../components/Dialog.js';
import { RoutePicker } from './RoutePicker.js';
import { PICK_MODE, useTransportData, useVehicleCalc } from './useVehicleCalc.js';
import { VehicleCalculator } from './VehicleCalculator.js';

/**
 * The calculator in a dialog, bound to `useVehicleCalc`. Fetches the vehicle data only once opened. Hidden while the
 * route is picked on the map (PICK_MODE), and back as soon as that mode ends.
 */
export function VehicleCalcDialog({ version }: { version: string }) {
  const { t } = useTranslation();
  const open = useVehicleCalc(s => s.open);
  const picking = useUiStore(s => s.interactionMode === PICK_MODE);
  const hide = useVehicleCalc(s => s.hide);
  const form = useVehicleCalc(s => s.form);
  const setForm = useVehicleCalc(s => s.setForm);
  const { data, failed } = useTransportData(version, open);
  return (
    <Dialog open={open && !picking} onClose={hide} title={t('vehicleCalc.title')}>
      {failed ? <p role="alert">{t('vehicleCalc.failed')}</p>
        : data === undefined ? <p>{t('common.loading')}</p>
          : data === null ? <p>{t('vehicleCalc.unavailable')}</p>
            : <VehicleCalculator data={data} form={form} onChange={setForm} picker={<RoutePicker version={version} />} />}
    </Dialog>
  );
}

/** The dialog for the world's dataset version, as a header item (it renders in the top layer). */
export function VehicleCalcHost({ ctx }: { ctx: WorldCtx }) {
  return <VehicleCalcDialog version={ctx.me.datasetVersion} />;
}
