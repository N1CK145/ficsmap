import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { shouldIgnoreGlobalKey } from '../../app/keyboard.js';
import { useVehicleCalc } from './useVehicleCalc.js';

/**
 * The banner of the vehicle route's pick mode: what to pick next (a status region, so it is announced), and Cancel.
 * Esc cancels as well; both leave the mode and go back to the calculator page with the route it had (`PickReturn`).
 */
export function PickBanner() {
  const { t } = useTranslation();
  const waitingForEnd = useVehicleCalc(s => s.pickedStart !== null);
  const cancel = useVehicleCalc(s => s.cancelPicking);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.ctrlKey || e.metaKey || e.altKey || shouldIgnoreGlobalKey(e)) return;
      // Handled here, so the item panel's Esc does not also act on this press.
      e.preventDefault();
      cancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [cancel]);

  return (
    <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
      <span role="status">{t(waitingForEnd ? 'vehicleCalc.pick.end' : 'vehicleCalc.pick.start')}</span>
      <button
        type="button"
        onClick={cancel}
        aria-keyshortcuts="Escape"
        className="min-h-8 rounded border border-bg/60 px-3 text-sm font-semibold hover:bg-bg/15 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bg"
      >
        {t('vehicleCalc.pick.cancel')}
      </button>
    </div>
  );
}
