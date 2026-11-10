import type L from 'leaflet';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMap } from 'react-leaflet';
import type { CreatureSpawner } from '../../../shared/creatures.js';
import { UNITS_PER_METER, worldToLatLng } from '../../../shared/geo.js';
import type { WorldCtx } from '../../app/feature.js';
import { markerClickClaims } from '../map/clickClaims.js';
import { CreatureCanvasLayer, type DrawCreature } from './CreatureCanvasLayer.js';
import { creatureIcon, useCreatureName } from './names.js';
import { filterSpawners, useCreatureData, useCreatureLayer } from './useCreatures.js';

const HOVER_CLASS = 'ficsmap-node-hover';
const BOX_OFFSET = 16;

/**
 * The creature spawners on the map while the layer is on, filtered by family and kill state, with the kills from the
 * save the timeline shows. Hovering a spawner shows its creature, how often it was killed and whether it is dead
 * right now; a click pins the box until a click elsewhere or Escape.
 */
export function CreatureLayer({ ctx }: { ctx: WorldCtx }) {
  const map = useMap();
  const visible = useCreatureLayer(s => s.visible);
  const hiddenList = useCreatureLayer(s => s.hidden);
  const kill = useCreatureLayer(s => s.kill);
  const version = ctx.me.datasetVersion;
  const data = useCreatureData(version, ctx.worldId, visible);
  const bounds = ctx.index.ds.bounds;
  const { t } = useTranslation();
  const name = useCreatureName();

  const shown = useMemo(() => (data && visible ? filterSpawners(data, new Set(hiddenList), kill) : []), [data, visible, hiddenList, kill]);
  const byName = useMemo(() => new Map(shown.map(s => [s.name, s])), [shown]);
  const draw = useMemo((): DrawCreature[] => shown.map(s => {
    const [lat, lng] = worldToLatLng(s.x, s.y, bounds);
    const k = data?.kills.get(s.name);
    return { id: s.name, lat, lng, family: s.family, icon: creatureIcon(version, s.creature), kills: k?.kills ?? 0, dead: k?.dead ?? 0 };
  // Killed and dead ones last, so they are drawn on top of untouched neighbours.
  }).sort((a, b) => a.kills - b.kills), [shown, bounds, data, version]);

  const [hover, setHover] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  const active = pinned ?? hover;
  const itemsRef = useRef(draw);
  const activeRef = useRef(active);
  const layerRef = useRef<CreatureCanvasLayer | null>(null);

  useEffect(() => {
    if (!visible) return;
    const layer = new CreatureCanvasLayer(() => itemsRef.current, () => activeRef.current);
    layer.addTo(map);
    layerRef.current = layer;
    const container = map.getContainer();
    let frame = 0;
    let point: L.Point | null = null;
    const onMove = (e: L.LeafletMouseEvent) => {
      point = e.containerPoint;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const id = point ? layer.pick(point.x, point.y) : null;
        container.classList.toggle(HOVER_CLASS, id !== null);
        setHover(id);
      });
    };
    const onOut = () => { point = null; container.classList.remove(HOVER_CLASS); setHover(null); };
    const onClick = (e: L.LeafletMouseEvent) => setPinned(layer.pick(e.containerPoint.x, e.containerPoint.y));
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPinned(null); };
    const claim = (x: number, y: number) => layer.pick(x, y) !== null;
    markerClickClaims.add(claim);
    map.on('mousemove', onMove);
    map.on('mouseout', onOut);
    map.on('click', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      map.off('mousemove', onMove);
      map.off('mouseout', onOut);
      map.off('click', onClick);
      document.removeEventListener('keydown', onKey);
      markerClickClaims.delete(claim);
      cancelAnimationFrame(frame);
      container.classList.remove(HOVER_CLASS);
      layer.remove();
      layerRef.current = null;
      setHover(null);
      setPinned(null);
    };
  }, [map, visible]);

  useLayoutEffect(() => {
    itemsRef.current = draw;
    activeRef.current = active;
    layerRef.current?.redraw();
  }, [draw, active]);

  const spawner = active === null ? undefined : byName.get(active);
  // A pinned spawner is read out (the canvas marker has no element of its own to focus).
  const pinnedSpawner = pinned === null ? undefined : byName.get(pinned);
  const pk = pinnedSpawner ? data?.kills.get(pinnedSpawner.name) : undefined;
  const announce = pinnedSpawner
    ? [name(pinnedSpawner.creature), pk && pk.kills > 0 ? t('creatures.killed', { count: pk.kills }) : t('creatures.neverKilled'), pk && pk.dead > 0 ? t('creatures.deadNow', { count: pk.dead }) : '']
      .filter(Boolean).join(', ')
    : '';
  const live = visible ? <div className="sr-only" aria-live="polite" data-testid="creature-announce">{announce}</div> : null;
  if (!visible || !spawner || !data) return live;
  const k = data.kills.get(spawner.name);
  return <>{live}<CreatureInfo spawner={spawner} kills={k?.kills ?? 0} dead={k?.dead ?? 0} hasKills={data.hasKills} ctx={ctx} /></>;
}

/**
 * The spawner's box next to it. A pinned box is also read out (a polite live region), since the canvas marker
 * itself has no element to focus.
 */
function CreatureInfo({ spawner, kills, dead, hasKills, ctx }: {
  spawner: CreatureSpawner; kills: number; dead: number; hasKills: boolean; ctx: WorldCtx;
}) {
  const { t, i18n } = useTranslation();
  const map = useMap();
  const name = useCreatureName();
  const [, setTick] = useState(0);
  useEffect(() => {
    const update = () => setTick(n => n + 1);
    map.on('move zoomend', update);
    return () => { map.off('move zoomend', update); };
  }, [map]);
  const [lat, lng] = worldToLatLng(spawner.x, spawner.y, ctx.index.ds.bounds);
  const p = map.latLngToContainerPoint([lat, lng]);
  const size = map.getSize();
  const metres = new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 0 });
  const m = (u: number) => metres.format(u / UNITS_PER_METER);
  const right = p.x < size.x - 240;
  // Kept on the map: a box left of a marker near the left edge of a phone would start off-screen.
  const rightEdge = Math.min(size.x - p.x + BOX_OFFSET, size.x - 248);
  const label = name(spawner.creature);
  return (
    <div
      role="tooltip"
      aria-label={label}
      data-testid="creature-info"
      className="pointer-events-none absolute z-[800] w-max max-w-60 chamfer border border-line bg-panel/95 px-2 py-1.5 text-xs text-fg shadow"
      style={{ left: right ? p.x + BOX_OFFSET : undefined, right: right ? undefined : Math.max(8, rightEdge), top: p.y, transform: 'translateY(-50%)' }}
    >
      <div className="flex items-center gap-1.5 font-semibold">
        <img src={creatureIcon(ctx.me.datasetVersion, spawner.creature)} alt="" width={20} height={20} className="chamfer bg-cr-disc p-px" />
        <span>{label}</span>
      </div>
      {hasKills ? (
        <>
          <div className="tabular-nums" data-testid="creature-kills">{kills > 0 ? t('creatures.killed', { count: kills }) : t('creatures.neverKilled')}</div>
          {dead > 0 && <div className="font-semibold text-conflict">{t('creatures.deadNow', { count: dead })}</div>}
        </>
      ) : (
        <div className="text-muted">{t('creatures.noKillData')}</div>
      )}
      <div className="tabular-nums text-muted">{t('item.coords', { x: m(spawner.x), y: m(spawner.y), z: m(spawner.z) })}</div>
    </div>
  );
}
