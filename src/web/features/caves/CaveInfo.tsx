import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMap } from 'react-leaflet';
import type { WorldCtx } from '../../app/feature.js';
import { Button } from '../../components/Button.js';
import { WINDOW_FRAME, WindowTitleBar } from '../../components/Window.js';
import { caveContents, caveLabelNumber, caveModelId, useCaveModels, useCaveViewer } from './caveModels.js';
import { CaveViewerDialog } from './CaveViewerDialog.js';
import { useCaveLayer, useCaves } from './useCaves.js';

const BOX_OFFSET = 12;
const BOX_WIDTH = 240;

/**
 * Over the map: the box of the cave clicked on the cave layer (its number, collectibles and entrances, and the way into
 * its 3D view), and the 3D view itself.
 */
export function CaveInfo({ ctx }: { ctx: WorldCtx }) {
  const visible = useCaveLayer(s => s.visible);
  const popup = useCaveViewer(s => s.popup);
  const closePopup = useCaveViewer(s => s.closePopup);
  // The box belongs to the layer: switched off, it goes too.
  useEffect(() => { if (!visible) closePopup(); }, [visible, closePopup]);
  return (
    <>
      {visible && popup && <CaveBox ctx={ctx} id={popup.id} lat={popup.lat} lng={popup.lng} />}
      <CaveViewerDialog ctx={ctx} />
    </>
  );
}

function CaveBox({ ctx, id, lat, lng }: { ctx: WorldCtx; id: string; lat: number; lng: number }) {
  const { t } = useTranslation();
  const map = useMap();
  const closePopup = useCaveViewer(s => s.closePopup);
  const view = useCaveViewer(s => s.view);
  const version = ctx.me.datasetVersion;
  const models = useCaveModels(version);
  const shapes = useCaves(version, ctx.index.ds.bounds);
  const contents = useMemo(() => (shapes ? caveContents(id, shapes, ctx.index) : null), [id, shapes, ctx.index]);
  const [, setTick] = useState(0);
  useEffect(() => {
    const update = () => setTick(n => n + 1);
    map.on('move zoomend resize', update);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closePopup(); };
    document.addEventListener('keydown', onKey);
    return () => {
      map.off('move zoomend resize', update);
      document.removeEventListener('keydown', onKey);
    };
  }, [map, closePopup]);

  const p = map.latLngToContainerPoint([lat, lng]);
  const size = map.getSize();
  // Right of the click, or left of it near the right edge; kept on the map on a phone.
  const fitsRight = p.x + BOX_OFFSET + BOX_WIDTH <= size.x - 8;
  const left = Math.max(8, fitsRight ? p.x + BOX_OFFSET : Math.min(p.x - BOX_OFFSET - BOX_WIDTH, size.x - BOX_WIDTH - 8));
  const top = Math.max(8, Math.min(p.y - 20, size.y - 160));
  const title = t('caves.popup.title', { n: caveLabelNumber(id, shapes) });
  return (
    <section
      aria-label={title}
      data-testid="cave-box"
      className={`pointer-events-auto absolute z-[800] ${WINDOW_FRAME}`}
      style={{ left, top, width: BOX_WIDTH }}
    >
      <WindowTitleBar
        title={title}
        level={3}
        subtitle={contents ? t('caves.popup.contents', { items: contents.items.length, entrances: contents.entrances.length }) : undefined}
        onClose={closePopup}
      />
      {shapes && models?.has(caveModelId(id, shapes)) && (
        <div className="p-2">
          <Button variant="primary" size="sm" className="w-full" onClick={() => view(id)}>{t('caves.popup.view3d')}</Button>
        </div>
      )}
    </section>
  );
}
