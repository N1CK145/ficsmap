import './vehicleRoute.css';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { routeGeometry } from '../../../shared/vehicleRoute.js';
import type { WorldCtx } from '../../app/feature.js';
import { worldPath } from '../../app/pages.js';
import { useUiStore } from '../../app/store.js';
import { Button } from '../../components/Button.js';
import { useHeights } from '../coords/useHeights.js';
import { PICK_STATE } from './PickReturn.js';
import { useVehicleCalc } from './useVehicleCalc.js';

/** A letter in the route pins' style (vehicleRoute.css), so the text points at A and B on the map. */
function Pin({ letter }: { letter: 'A' | 'B' }) {
  return <span aria-hidden="true" className="ficsmap-vroute-letter">{letter}</span>;
}

/**
 * Step 1 of the calculator, above the route length: [Pick on the map]; once start and destination are set, the straight
 * line between them with the height difference and the 3D length (from the dataset's height map, when it has one),
 * [Pick again] and [Clear points]. The route length is the straight line: exact for drones, a lower bound for wheeled
 * vehicles. Picking goes to the map in PICK_MODE (a history entry of its own, `PICK_STATE`); `PickReturn` comes back.
 */
export function RoutePicker({ ctx }: { ctx: WorldCtx }) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const route = useVehicleCalc(s => s.route);
  const fromRoute = useVehicleCalc(s => s.lengthFromRoute);
  const { clearRoute, applyRouteLength } = useVehicleCalc.getState();
  const { available, heightAt } = useHeights(ctx.me.datasetVersion, route !== null);
  const titleId = useId();
  const startPicking = () => {
    useVehicleCalc.getState().startPicking();
    useUiStore.getState().setMainView('map');
    void navigate(worldPath(ctx.worldId), { state: PICK_STATE });
  };

  if (!route) {
    return (
      <div className="flex flex-col items-start gap-1.5">
        <Button variant="primary" onClick={startPicking}>{t('vehicleCalc.pick.button')}</Button>
        <p className="text-xs text-muted">{t('vehicleCalc.pick.hint')}</p>
      </div>
    );
  }

  const metres = new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 0 });
  const signed = new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 0, signDisplay: 'exceptZero' });
  const starts = available ? heightAt(route.start.x, route.start.y) : null;
  const ends = available ? heightAt(route.end.x, route.end.y) : null;
  const g = routeGeometry(route.start, route.end, starts, ends);
  // null: no height rows (a dataset without heights); a text in place of both values while the height map (or a
  // tile of it) loads or for a point off it; undefined: show the values.
  const heights = available === false ? null
    : available === undefined || starts === undefined || ends === undefined ? t('vehicleCalc.routeInfo.loading')
      : g.climbMeters === null ? t('vehicleCalc.routeInfo.unknown') : undefined;
  const fact = 'flex min-w-0 flex-col';
  const label = 'text-xs text-muted';
  const value = 'font-display text-xl font-semibold leading-tight tabular-nums';

  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-3 rounded border border-line bg-bg p-3">
      <h4 id={titleId} className="flex items-center gap-1.5 text-sm font-medium">
        <Pin letter="A" /><span aria-hidden="true" className="h-0.5 w-6 bg-cat-vehicles" /><Pin letter="B" />
        <span className="ml-1">{t('vehicleCalc.routeInfo.title')}</span>
      </h4>
      <dl className="flex flex-wrap gap-x-6 gap-y-2">
        <div className={fact}>
          <dt className={label}>{t('vehicleCalc.routeInfo.straight')}</dt>
          <dd className={value}>{t('vehicleCalc.routeInfo.metres', { value: metres.format(g.meters) })}</dd>
        </div>
        {heights !== null && (
          <>
            <div className={fact}>
              <dt className={label}>{t('vehicleCalc.routeInfo.climb')}</dt>
              <dd className={value}>{heights ?? t('vehicleCalc.routeInfo.metres', { value: signed.format(g.climbMeters!) })}</dd>
            </div>
            <div className={fact}>
              <dt className={label}>{t('vehicleCalc.routeInfo.length3d')}</dt>
              <dd className={value}>{heights ?? t('vehicleCalc.routeInfo.metres', { value: metres.format(g.meters3d!) })}</dd>
            </div>
          </>
        )}
      </dl>
      <p className="text-xs text-muted">{t('vehicleCalc.routeInfo.note')}</p>
      {!fromRoute && (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
          {t('vehicleCalc.routeInfo.typed')}
          <Button size="sm" variant="ghost" onClick={applyRouteLength}>{t('vehicleCalc.routeInfo.useStraight')}</Button>
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={startPicking}>{t('vehicleCalc.pick.again')}</Button>
        <Button size="sm" variant="ghost" onClick={clearRoute}>{t('vehicleCalc.pick.clear')}</Button>
      </div>
    </section>
  );
}
