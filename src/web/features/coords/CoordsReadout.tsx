import type { LatLng, LeafletMouseEvent } from 'leaflet';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMap } from 'react-leaflet';
import { latLngToWorld, UNITS_PER_METER } from '../../../shared/geo.js';
import type { WorldCtx } from '../../app/feature.js';
import { useIsMobile } from '../../app/useMediaQuery.js';
import { useHeights } from './useHeights.js';

/**
 * The world coordinates under the mouse, bottom left on the map: X and Y, and Z, the highest surface there
 * (landscape, rocks and other placed meshes; no foliage) from the dataset's height map. Hidden while the mouse
 * is not over the map, and on phones (no hover). Does not take pointer events.
 */
export function CoordsReadout({ ctx }: { ctx: WorldCtx }) {
  const { t, i18n } = useTranslation();
  const map = useMap();
  const mobile = useIsMobile();
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const { available, heightAt } = useHeights(ctx.me.datasetVersion, !mobile);
  const bounds = ctx.index.ds.bounds;

  useEffect(() => {
    if (mobile) return;
    let frame = 0;
    let last: LatLng | null = null;
    const move = (e: LeafletMouseEvent) => {
      last = e.latlng;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (last) setPos(latLngToWorld(last.lat, last.lng, bounds));
      });
    };
    const out = () => { last = null; setPos(null); };
    map.on('mousemove', move);
    map.on('mouseout', out);
    return () => {
      map.off('mousemove', move);
      map.off('mouseout', out);
      cancelAnimationFrame(frame);
    };
  }, [map, bounds, mobile]);

  if (mobile || !pos) return null;
  // Whole metres, as the item panel shows an item's position.
  const metres = new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 0 });
  const m = (units: number) => metres.format(units / UNITS_PER_METER);
  const z = available === false ? null : heightAt(pos.x, pos.y);
  return (
    <div
      className="pointer-events-none absolute bottom-2 left-2 z-[800] rounded border border-line bg-panel/90 px-2 py-1 text-xs text-fg tabular-nums"
      title={t('coords.hint')}
      data-testid="coords-readout"
    >
      {t('item.coords', { x: m(pos.x), y: m(pos.y), z: z === undefined ? '…' : z === null ? '–' : m(z) })}
    </div>
  );
}
