import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMap } from 'react-leaflet';
import { buildingName, stationName, vehicleName, type Lang } from './names.js';
import type { Scene } from './scene.js';
import { ReasonIcon } from '../icons.js';
import { STATE_TEXT, stateKey } from '../parts.js';
import { productivityOf } from './style.js';
import type { FactorySelection } from './useFactoryMap.js';

const OFFSET = 14;

/**
 * The name of what is under the mouse, next to it: a building with its productivity and issues, a station with its
 * items per minute, a vehicle with its name; for a building of a production line the line's name and machines (`line`).
 * A click opens the full info (`FactoryInfo`).
 */
export function HoverTip({ scene, hit, lang, line }: { scene: Scene; hit: FactorySelection; lang: Lang; line?: string }) {
  const { t, i18n } = useTranslation();
  const map = useMap();
  const [, setTick] = useState(0);
  useEffect(() => {
    const update = () => setTick(n => n + 1);
    map.on('move zoomend', update);
    return () => { map.off('move zoomend', update); };
  }, [map]);
  const pct = new Intl.NumberFormat(i18n.language, { style: 'percent', maximumFractionDigits: 0 });
  const num = new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 0 });

  let at: { cx: number; cy: number } | undefined;
  let title = '';
  let body: React.ReactNode = null;
  if (hit.kind === 'vehicle') {
    const v = scene.vehicleById.get(hit.id);
    if (!v) return null;
    at = v;
    title = vehicleName(scene, hit.id, lang);
    body = <div className="text-muted">{t(v.v.autopilot ? 'factoryMap.vehicle.autopilotOn' : 'factoryMap.vehicle.autopilotOff')}</div>;
  } else {
    const sb = scene.byId.get(hit.id);
    if (!sb) return null;
    at = sb;
    const st = scene.stationById.get(hit.id);
    title = st ? stationName(scene, hit.id, lang) : buildingName(sb.entry, sb.b.cls, lang);
    if (st) {
      body = (
        <div className="tabular-nums">
          {t(st.s.loading === false ? 'factoryMap.station.unloading' : 'factoryMap.station.loading')}
          {' · '}
          {t('factoryMap.perMin', { value: num.format(st.flow.itemsPerMin ?? 0) })}
        </div>
      );
    } else if (sb.b.prod && sb.band) {
      const measured = sb.b.prod.productivity !== undefined;
      body = (
        <>
          <div className={`tabular-nums ${STATE_TEXT[sb.paused ? 'paused' : sb.band]}`}>
            {sb.paused ? t(stateKey('paused')) : t('factoryMap.productivityValue', { value: pct.format(productivityOf(sb.b.prod)) })}
            {!measured && <span className="text-muted"> · {t('factoryMap.noMeasurement')}</span>}
          </div>
          {sb.reasons.length > 0 && (
            <ul className="flex flex-wrap gap-x-2">
              {sb.reasons.map(r => <li key={r} className="flex items-center gap-1"><ReasonIcon reason={r} size={12} />{t(`factory.reason.${r}`)}</li>)}
            </ul>
          )}
        </>
      );
    }
  }
  const p = map.latLngToContainerPoint([-at.cy, at.cx]);
  const size = map.getSize();
  const right = p.x < size.x - 240;
  return (
    <div
      role="tooltip"
      data-testid="factory-hover"
      className="pointer-events-none absolute z-[800] w-max max-w-60 chamfer border border-line bg-panel/95 px-2 py-1.5 text-xs text-fg shadow"
      style={{ left: right ? p.x + OFFSET : undefined, right: right ? undefined : size.x - p.x + OFFSET, top: p.y, transform: 'translateY(-50%)' }}
    >
      <div className="font-semibold">{title}</div>
      {body}
      {line && <div className="mt-0.5 border-t border-line pt-0.5 text-muted" data-testid="factory-hover-line">{line}</div>}
    </div>
  );
}
