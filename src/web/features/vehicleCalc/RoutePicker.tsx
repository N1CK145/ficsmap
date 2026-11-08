import './vehicleRoute.css';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { routeGeometry } from '../../../shared/vehicleRoute.js';
import type { WorldCtx } from '../../app/feature.js';
import { worldPath } from '../../app/pages.js';
import { useUiStore } from '../../app/store.js';
import { useIsMobile } from '../../app/useMediaQuery.js';
import { Button } from '../../components/Button.js';
import { IconButton } from '../../components/IconButton.js';
import { CloseIcon, PinIcon } from '../../components/icons.js';
import { useHeights } from '../coords/useHeights.js';
import { PICK_STATE } from './PickReturn.js';
import { useVehicleCalc } from './useVehicleCalc.js';

/** A letter in the route pins' style (vehicleRoute.css), so the text points at A and B on the map. */
function Pin({ letter }: { letter: 'A' | 'B' }) {
  return <span aria-hidden="true" className="ficsmap-vroute-letter">{letter}</span>;
}

/**
 * Step 1 of the calculator, above the route length: [Pick on the map]; once start and destination are set, one line
 * with the straight line between them and the height difference (from the dataset's height map, when it has one),
 * [Pick again] and [×] (clear the points). The route length field below says what the straight line means for the
 * vehicle. Picking goes to the map in PICK_MODE (a history entry of its own, `PICK_STATE`); `PickReturn` comes back.
 * On a phone the buttons are 44 px high.
 */
export function RoutePicker({ ctx }: { ctx: WorldCtx }) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const mobile = useIsMobile();
  const route = useVehicleCalc(s => s.route);
  const { clearRoute } = useVehicleCalc.getState();
  const { available, heightAt } = useHeights(ctx.me.datasetVersion, route !== null);
  const size = mobile ? 'touch' : 'sm';
  const startPicking = () => {
    useVehicleCalc.getState().startPicking();
    useUiStore.getState().setMainView('map');
    void navigate(worldPath(ctx.worldId), { state: PICK_STATE });
  };

  if (!route) {
    return (
      <div className="flex flex-col items-start gap-1.5">
        <Button variant="primary" size={mobile ? 'touch' : 'md'} onClick={startPicking}><PinIcon />{t('vehicleCalc.pick.button')}</Button>
        <p className="text-xs text-muted">{t('vehicleCalc.pick.hint')}</p>
      </div>
    );
  }

  const metres = new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 0 });
  const signed = new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 0, signDisplay: 'exceptZero' });
  const starts = available ? heightAt(route.start.x, route.start.y) : null;
  const ends = available ? heightAt(route.end.x, route.end.y) : null;
  const g = routeGeometry(route.start, route.end, starts, ends);
  // Nothing without a height map, an ellipsis while it (or a tile of it) loads, nothing for a point off it.
  const climb = available === false ? null
    : available === undefined || starts === undefined || ends === undefined ? t('vehicleCalc.routeInfo.loading')
      : g.climbMeters === null ? null : t('vehicleCalc.routeInfo.metres', { value: signed.format(g.climbMeters) });
  const fact = 'inline-flex items-baseline gap-1.5 whitespace-nowrap';
  const value = 'font-display text-base font-semibold text-fg tabular-nums';

  return (
    <section aria-label={t('vehicleCalc.routeInfo.title')}
      className="flex flex-wrap items-center gap-x-3 gap-y-2 chamfer border border-line bg-bg py-1.5 pr-1.5 pl-3">
      {/* At least 12rem wide, so on a phone the buttons move under the facts instead of covering them. */}
      <p className="flex min-w-48 flex-1 flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
        <span className="inline-flex items-center gap-1">
          <Pin letter="A" /><span aria-hidden="true" className="h-0.5 w-4 bg-cat-vehicles" /><Pin letter="B" />
        </span>
        <span className={fact}>{t('vehicleCalc.routeInfo.straight')}<span className={value}>{t('vehicleCalc.routeInfo.metres', { value: metres.format(g.meters) })}</span></span>
        {climb !== null && <span className={fact}>{t('vehicleCalc.routeInfo.climb')}<span className={value}>{climb}</span></span>}
      </p>
      <div className="flex shrink-0 gap-1">
        <Button size={size} onClick={startPicking}><PinIcon />{t('vehicleCalc.pick.again')}</Button>
        <IconButton size={size} aria-label={t('vehicleCalc.pick.clear')} title={t('vehicleCalc.pick.clear')} onClick={clearRoute}><CloseIcon /></IconButton>
      </div>
    </section>
  );
}
