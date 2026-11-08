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

/**
 * Under the route length: [Pick on the map], and once start and destination are set, the straight line between them
 * with the height difference and the 3D length (from the dataset's height map, when it has one), [Pick again] and
 * [Clear points]. The route length is the straight line: exact for drones, a lower bound for wheeled vehicles.
 * Picking goes to the map in PICK_MODE (a history entry of its own, `PICK_STATE`); `PickReturn` comes back.
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
      <div className="flex flex-col items-start gap-1">
        <Button size="sm" onClick={startPicking}>{t('vehicleCalc.pick.button')}</Button>
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

  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-2 rounded border border-line p-3">
      <h3 id={titleId} className="text-sm font-medium">{t('vehicleCalc.routeInfo.title')}</h3>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="text-muted">{t('vehicleCalc.routeInfo.straight')}</dt>
        <dd className="font-semibold tabular-nums">{t('vehicleCalc.routeInfo.metres', { value: metres.format(g.meters) })}</dd>
        {heights !== null && (
          <>
            <dt className="text-muted">{t('vehicleCalc.routeInfo.climb')}</dt>
            <dd className="tabular-nums">{heights ?? t('vehicleCalc.routeInfo.metres', { value: signed.format(g.climbMeters!) })}</dd>
            <dt className="text-muted">{t('vehicleCalc.routeInfo.length3d')}</dt>
            <dd className="tabular-nums">{heights ?? t('vehicleCalc.routeInfo.metres', { value: metres.format(g.meters3d!) })}</dd>
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
