import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { shouldIgnoreGlobalKey } from '../../app/keyboard.js';
import { useIsMobile } from '../../app/useMediaQuery.js';
import { Button } from '../../components/Button.js';
import { useVehicleCalc } from './useVehicleCalc.js';

/**
 * The banner of the vehicle route's pick mode: what to pick next (a status region, so it is announced), and Cancel
 * (a raised plate on the orange banner, 44 px high on a phone). Esc cancels as well; both leave the mode and go back to
 * the calculator page with the route it had (`PickReturn`).
 */
export function PickBanner() {
  const { t } = useTranslation();
  const waitingForEnd = useVehicleCalc(s => s.pickedStart !== null);
  const cancel = useVehicleCalc(s => s.cancelPicking);
  const mobile = useIsMobile();

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
    // The accent focus ring would vanish on the orange banner: a dark outline around it instead.
    <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 [&>button:focus-visible]:outline-2 [&>button:focus-visible]:outline-offset-4 [&>button:focus-visible]:outline-bg">
      <span role="status">{t(waitingForEnd ? 'vehicleCalc.pick.end' : 'vehicleCalc.pick.start')}</span>
      <Button size={mobile ? 'touch' : 'sm'} onClick={cancel} aria-keyshortcuts="Escape">{t('vehicleCalc.pick.cancel')}</Button>
    </div>
  );
}
