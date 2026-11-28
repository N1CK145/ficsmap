import L from 'leaflet';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useMap } from 'react-leaflet';
import type { CreatureSpawner } from '../../../shared/creatures.js';
import { UNITS_PER_METER, worldToLatLng } from '../../../shared/geo.js';
import type { WorldCtx } from '../../app/feature.js';
import { markerClickClaims } from '../map/clickClaims.js';
import { CREATURE_PANE_Z, CreatureCanvasLayer, creatureRadius, type DrawCreature } from './CreatureCanvasLayer.js';
import { focusOrder } from './focusOrder.js';
import { creatureIcon, useCreatureName } from './names.js';
import { filterSpawners, useCreatureData, useCreatureLayer } from './useCreatures.js';

const HOVER_CLASS = 'ficsmap-node-hover';
const BOX_OFFSET = 16;
/** The pane of the keyboard's focus stops, just above the creature canvas. */
const FOCUS_PANE = 'ficsmap-creature-focus';

/**
 * The creature spawners on the map while the layer is on, filtered by family and kill state, with the kills from the
 * save the timeline shows. Hovering a spawner shows its creature, how often it was killed and whether it is dead
 * right now; a click pins the box until a click elsewhere or Escape. By keyboard, every spawner in view is a focus
 * stop (in reading order): focusing one shows its box, Enter pins it.
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
  const [focused, setFocused] = useState<string | null>(null);
  const active = pinned ?? hover ?? focused;
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
      setFocused(null);
    };
  }, [map, visible]);

  useLayoutEffect(() => {
    itemsRef.current = draw;
    activeRef.current = active;
    layerRef.current?.redraw();
  }, [draw, active]);

  /** A spawner in words: its creature, then (with kill data) its kills and whether it is dead right now. */
  const describe = (s: CreatureSpawner) => {
    const k = data?.kills.get(s.name);
    if (!data?.hasKills) return name(s.creature);
    return [name(s.creature), k && k.kills > 0 ? t('creatures.killed', { count: k.kills }) : t('creatures.neverKilled'), k && k.dead > 0 ? t('creatures.deadNow', { count: k.dead }) : '']
      .filter(Boolean).join(', ');
  };
  const spawner = active === null ? undefined : byName.get(active);
  // A pinned spawner is read out (also when it was pinned by a click, which moves no focus).
  const pinnedSpawner = pinned === null ? undefined : byName.get(pinned);
  const announce = pinnedSpawner ? describe(pinnedSpawner) : '';
  const live = visible ? <div className="sr-only" aria-live="polite" data-testid="creature-announce">{announce}</div> : null;
  if (!visible || !data) return live;
  const k = spawner && data.kills.get(spawner.name);
  return (
    <>
      {live}
      <CreatureFocusStops
        items={draw}
        focused={focused}
        pinned={pinned}
        label={id => { const s = byName.get(id); return s ? describe(s) : id; }}
        onFocus={setFocused}
        onToggle={id => setPinned(p => (p === id ? null : id))}
      />
      {spawner && <CreatureInfo spawner={spawner} kills={k?.kills ?? 0} dead={k?.dead ?? 0} hasKills={data.hasKills} ctx={ctx} />}
    </>
  );
}

/**
 * The keyboard's way to single spawners (the canvas markers have no elements): a transparent button over each spawner
 * wholly in view, in reading order, in a pane of its own that moves with the map. They take no pointer events, so
 * the mouse still goes to the map; the list follows the view when a move or zoom ends.
 */
function CreatureFocusStops({ items, focused, pinned, label, onFocus, onToggle }: {
  items: readonly DrawCreature[];
  focused: string | null;
  pinned: string | null;
  label: (id: string) => string;
  onFocus: (id: string | null) => void;
  onToggle: (id: string) => void;
}) {
  const map = useMap();
  const { t } = useTranslation();
  const [pane, setPane] = useState<HTMLElement | null>(null);
  const [, setView] = useState(0);
  useEffect(() => {
    const p = map.getPane(FOCUS_PANE) ?? map.createPane(FOCUS_PANE);
    p.style.zIndex = String(CREATURE_PANE_Z + 1);
    p.style.pointerEvents = 'none';
    // Hidden while a zoom animates: the stops jump to their new places when it ends.
    p.classList.add('leaflet-zoom-hide');
    setPane(p);
    const update = () => setView(n => n + 1);
    map.on('moveend zoomend viewreset resize', update);
    return () => { map.off('moveend zoomend viewreset resize', update); };
  }, [map]);
  if (!pane) return null;
  const size = map.getSize();
  const r = creatureRadius(map.getZoom());
  const points = items.map(c => { const p = map.latLngToContainerPoint([c.lat, c.lng]); return { id: c.id, x: p.x, y: p.y }; });
  const stops = focusOrder(points, size.x, size.y, r, focused);
  return createPortal(
    // Leaflet leaves the stops' clicks (Enter, Space) alone: its map click would unpin.
    <div role="group" aria-label={t('creatures.title')} ref={el => { if (el) L.DomEvent.disableClickPropagation(el); }}>
      {stops.map(s => {
        const at = map.containerPointToLayerPoint([s.x, s.y]);
        return (
          <button
            key={s.id}
            type="button"
            aria-label={label(s.id)}
            aria-pressed={pinned === s.id}
            className="pointer-events-none absolute rounded-full focus-ring"
            style={{ left: at.x - r, top: at.y - r, width: 2 * r, height: 2 * r }}
            onFocus={() => onFocus(s.id)}
            onBlur={() => onFocus(null)}
            onClick={() => onToggle(s.id)}
          />
        );
      })}
    </div>,
    pane,
  );
}

/** The spawner's box next to it; a pinned one is also read out (a polite live region). */
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
