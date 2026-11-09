import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMap } from 'react-leaflet';
import { buildingName, stationName, vehicleName, type Lang } from './names.js';
import type { Scene, SceneBuilding } from './scene.js';
import { ReasonIcon } from '../icons.js';
import { STATE_TEXT, stateKey } from '../parts.js';
import { productivityOf } from './style.js';
import type { FactorySelection } from './useFactoryMap.js';
import { FLUID_BUFFER_M3, LITRES_PER_M3, usedSlots } from '../../../../shared/factory/inventory.js';
import { crateKey } from '../StorageWindow.js';

const OFFSET = 14;
/** The tip's widest (`max-w-60`), CSS px. */
const TIP_W = 240;
/** Buildings of the pointed line closer than this to the one pointed at (CSS px) form the cluster the tip stays clear of. */
const CLUSTER_PX = 220;

/** A box in container px. */
interface ScreenBox { left: number; top: number; right: number; bottom: number }

/**
 * Where the tip goes: right of the cluster (the pointed building with its line's buildings nearby, so the tip does not
 * cover the neighbouring machines), else left of it, else right of the building itself, else left of it.
 */
export function tipPlace(own: ScreenBox, cluster: ScreenBox, width: number): { left: number } | { right: number } {
  if (cluster.right + OFFSET + TIP_W <= width) return { left: cluster.right + OFFSET };
  if (cluster.left - OFFSET - TIP_W >= 0) return { right: width - cluster.left + OFFSET };
  if (own.right + OFFSET + TIP_W <= width) return { left: own.right + OFFSET };
  return { right: width - own.left + OFFSET };
}

/**
 * The name of what is under the mouse, next to it: a building with its productivity and issues, a station with its
 * items per minute, a vehicle with its name; for a building of a production line the line's name and machines (`line`),
 * placed clear of the line's buildings around it (`cluster`). A click opens the full info (`FactoryInfo`).
 */
export function HoverTip({ scene, hit, lang, line, cluster }: {
  scene: Scene; hit: FactorySelection; lang: Lang; line?: string; cluster?: readonly SceneBuilding[];
}) {
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

  let at: { cx: number; cy: number; minX?: number; minY?: number; maxX?: number; maxY?: number } | undefined;
  let title = '';
  let body: React.ReactNode = null;
  if (hit.kind === 'vehicle') {
    const v = scene.vehicleById.get(hit.id);
    if (!v) return null;
    at = v;
    title = vehicleName(scene, hit.id, lang);
    body = <div className="text-muted">{t(v.v.autopilot ? 'factoryMap.vehicle.autopilotOn' : 'factoryMap.vehicle.autopilotOff')}</div>;
  } else if (hit.kind === 'crate') {
    const c = scene.crateById.get(hit.id);
    if (!c) return null;
    at = c;
    title = t(crateKey(c.kind));
    if (c.c.inv) body = <div className="text-muted tabular-nums">{t('factory.inventory.fill', { used: usedSlots(c.c.inv), slots: c.c.inv.slots })}</div>;
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
    } else if (sb.b.inv && !sb.b.prod) {
      const cap = FLUID_BUFFER_M3[sb.b.cls];
      const m3 = sb.b.inv.items.reduce((n, [, c, times = 1]) => n + c * times, 0) / LITRES_PER_M3;
      body = (
        <div className="text-muted tabular-nums">
          {cap !== undefined
            ? t('factory.inventory.fluidFill', { amount: num.format(Math.min(cap, m3)), capacity: num.format(cap) })
            : t('factory.inventory.fill', { used: usedSlots(sb.b.inv), slots: sb.b.inv.slots })}
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
  const boxOf = (b: { minX: number; minY: number; maxX: number; maxY: number }): ScreenBox => {
    const a = map.latLngToContainerPoint([-b.minY, b.minX]), z = map.latLngToContainerPoint([-b.maxY, b.maxX]);
    return { left: Math.min(a.x, z.x), top: Math.min(a.y, z.y), right: Math.max(a.x, z.x), bottom: Math.max(a.y, z.y) };
  };
  const own: ScreenBox = at.minX !== undefined ? boxOf(at as { minX: number; minY: number; maxX: number; maxY: number }) : { left: p.x, top: p.y, right: p.x, bottom: p.y };
  const near = { ...own };
  for (const sb of cluster ?? []) {
    const q = boxOf(sb);
    if (Math.hypot((q.left + q.right) / 2 - p.x, (q.top + q.bottom) / 2 - p.y) > CLUSTER_PX) continue;
    near.left = Math.min(near.left, q.left); near.right = Math.max(near.right, q.right);
    near.top = Math.min(near.top, q.top); near.bottom = Math.max(near.bottom, q.bottom);
  }
  const place = tipPlace(own, near, size.x);
  return (
    <div
      role="tooltip"
      data-testid="factory-hover"
      className="pointer-events-none absolute z-[800] w-max max-w-60 chamfer border border-line bg-panel/95 px-2 py-1.5 text-xs text-fg shadow"
      style={{ ...place, top: Math.max(8, Math.min(size.y - 8, p.y)), transform: 'translateY(-50%)' }}
    >
      <div className="font-semibold">{title}</div>
      {body}
      {line && <div className="mt-0.5 border-t border-line pt-0.5 text-muted" data-testid="factory-hover-line">{line}</div>}
    </div>
  );
}
