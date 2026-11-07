import { useTranslation } from 'react-i18next';
import type { WorldCtx } from '../../app/feature.js';
import { Button } from '../../components/Button.js';
import { Dialog } from '../../components/Dialog.js';
import { useTransportData, useVehicleCalc } from './useVehicleCalc.js';
import { VehicleCalculator } from './VehicleCalculator.js';

/** The calculator in a dialog, bound to `useVehicleCalc`. Fetches the vehicle data only once opened. */
export function VehicleCalcDialog({ version }: { version: string }) {
  const { t } = useTranslation();
  const open = useVehicleCalc(s => s.open);
  const hide = useVehicleCalc(s => s.hide);
  const form = useVehicleCalc(s => s.form);
  const setForm = useVehicleCalc(s => s.setForm);
  const { data, failed } = useTransportData(version, open);
  return (
    <Dialog open={open} onClose={hide} title={t('vehicleCalc.title')}>
      {failed ? <p role="alert">{t('vehicleCalc.failed')}</p>
        : data === undefined ? <p>{t('common.loading')}</p>
          : data === null ? <p>{t('vehicleCalc.unavailable')}</p>
            : <VehicleCalculator data={data} form={form} onChange={setForm} />}
    </Dialog>
  );
}

/** Header button that opens the calculator, plus the dialog itself (it renders in the top layer). */
export function VehicleCalcHeaderItem({ ctx }: { ctx: WorldCtx }) {
  const { t } = useTranslation();
  const show = useVehicleCalc(s => s.show);
  return (
    <>
      <Button size="sm" title={t('vehicleCalc.openHint')} onClick={() => show()}>{t('vehicleCalc.open')}</Button>
      <VehicleCalcDialog version={ctx.me.datasetVersion} />
    </>
  );
}
