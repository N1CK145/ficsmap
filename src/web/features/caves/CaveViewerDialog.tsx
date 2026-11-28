import { lazy, Suspense, useEffect, useId, useMemo, useState, type ComponentType } from 'react';
import { useTranslation } from 'react-i18next';
import { COLLECTIBLE_TYPES } from '../../../shared/collectibleTypes.js';
import { caveModelUrl } from '../../../shared/caveModels.js';
import type { WorldCtx } from '../../app/feature.js';
import { Button } from '../../components/Button.js';
import { Dialog } from '../../components/Dialog.js';
import { mapStyle } from '../map/mapStyle.js';
import { caveContents, caveLabelNumber, caveModelId, useCaveModels, useCaveViewer, type ViewerMarker } from './caveModels.js';
import type { CaveViewer3dProps, ViewerStatus } from './CaveViewer3d.js';
import { useCaves } from './useCaves.js';

function LoadFailed({ onStatus }: { onStatus(s: ViewerStatus): void }) {
  // The viewer's code could not be fetched (offline, a new deploy): reported like a model that failed to load.
  useEffect(() => onStatus({ kind: 'error', reason: 'load' }), [onStatus]);
  return null;
}

/** three.js and the viewer load only when a cave is opened in 3D. */
const CaveViewer3d = lazy((): Promise<{ default: ComponentType<CaveViewer3dProps> }> => import('./CaveViewer3d.js').catch(() => ({ default: LoadFailed })));

/** Marker colours from the dark palette, as the 3D view stays dark like the map. */
const token = (name: string) => mapStyle().getPropertyValue(name).trim() || '#ffffff';

/**
 * The 3D view of the cave `useCaveViewer.viewing`: its model from the dataset part `cave-models`, turned and zoomed by
 * hand, with a switch for the landscape, a cut from above, and its entrances and collectibles as dots.
 */
export function CaveViewerDialog({ ctx }: { ctx: WorldCtx }) {
  const { t } = useTranslation();
  const viewing = useCaveViewer(s => s.viewing);
  const close = useCaveViewer(s => s.closeViewer);
  const version = ctx.me.datasetVersion;
  const models = useCaveModels(version, viewing !== null);
  const shapes = useCaves(version, ctx.index.ds.bounds, viewing !== null);
  const entry = viewing === null || !shapes ? undefined : models?.get(caveModelId(viewing, shapes));
  const [cut, setCut] = useState(1);
  const [surface, setSurface] = useState(true);
  const [resetKey, setResetKey] = useState(0);
  const [status, setStatus] = useState<ViewerStatus>({ kind: 'loading', progress: null });
  const cutId = useId();

  const contents = useMemo(() => (viewing && shapes ? caveContents(viewing, shapes, ctx.index) : null), [viewing, shapes, ctx.index]);
  const markers = useMemo((): ViewerMarker[] => {
    if (!contents) return [];
    // Entrances off-white: the cave colour is too close to the yellow slugs'.
    const entrance = token('--color-fg');
    return [
      ...contents.entrances.map(e => ({ x: e.x, y: e.y, z: e.z, color: entrance, kind: 'entrance' as const })),
      ...contents.items.map(i => ({ x: i.x, y: i.y, z: i.z, color: token(`--color-${COLLECTIBLE_TYPES.find(c => c.id === i.type)?.colorToken ?? 'fg'}`), kind: 'item' as const })),
    ];
  }, [contents]);
  const legend = useMemo(() => {
    if (!contents) return [];
    const types = COLLECTIBLE_TYPES.filter(c => contents.items.some(i => i.type === c.id));
    return [
      ...(contents.entrances.length ? [{ key: 'entrance', label: t('caves.viewer.entrance'), color: 'var(--color-fg)' }] : []),
      ...types.map(c => ({ key: c.id, label: t(c.labelKey), color: `var(--color-${c.colorToken})` })),
    ];
  }, [contents, t]);

  const onClose = () => {
    close();
    setCut(1);
    setSurface(true);
    setStatus({ kind: 'loading', progress: null });
  };
  const missing = models === null || (models !== undefined && shapes !== undefined && viewing !== null && entry === undefined);
  const message = missing ? t('caves.viewer.missing')
    : status.kind === 'error' ? t(status.reason === 'webgl' ? 'caves.viewer.noWebgl' : 'caves.viewer.loadFailed')
      : status.kind === 'loading' || !entry
        ? (status.kind === 'loading' && status.progress !== null ? t('caves.viewer.loadingPercent', { progress: status.progress }) : t('caves.viewer.loading'))
        : null;

  return (
    <Dialog
      open={viewing !== null}
      onClose={onClose}
      title={viewing ? t('caves.viewer.title', { n: caveLabelNumber(viewing, shapes) }) : ''}
      widthClass="max-w-5xl"
    >
      <div className="relative -mx-4 -mt-4 h-[min(52dvh,640px)] min-h-56 sm:h-[min(62dvh,640px)] overflow-hidden bg-bg">
        {entry && !missing && (
          <Suspense fallback={null}>
            <CaveViewer3d
              url={caveModelUrl(version, entry)}
              cut={cut}
              surface={surface}
              markers={markers}
              resetKey={resetKey}
              onStatus={setStatus}
            />
          </Suspense>
        )}
        {message && (
          <p role="status" className="absolute inset-0 flex items-center justify-center p-6 text-center text-muted">{message}</p>
        )}
        {legend.length > 0 && (
          <ul className="pointer-events-none absolute top-2 left-2 flex flex-col gap-1 bg-panel/80 px-2 py-1 text-xs" aria-label={t('caves.popup.view3d')}>
            {legend.map(l => (
              <li key={l.key} className="flex items-center gap-1.5">
                <span aria-hidden="true" className="inline-block size-2.5 rounded-full" style={{ background: l.color }} />
                {l.label}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2">
        <label className="flex min-h-11 items-center gap-2 text-sm min-[900px]:min-h-8">
          <input type="checkbox" className="size-4 accent-accent focus-ring" checked={surface} onChange={e => setSurface(e.target.checked)} />
          {t('caves.viewer.landscape')}
        </label>
        <div className="flex w-full items-center gap-2 text-sm sm:w-auto sm:min-w-48 sm:flex-1">
          <label htmlFor={cutId} className="shrink-0">{t('caves.viewer.cut')}</label>
          <input
            id={cutId}
            type="range"
            min={0}
            max={100}
            step={1}
            // 100 is no cut: the slider says how much of the height is kept.
            value={Math.round(cut * 100)}
            onChange={e => setCut(Number(e.target.value) / 100)}
            className="h-11 w-full accent-accent focus-ring min-[900px]:h-8"
          />
        </div>
        <Button size="sm" onClick={() => setResetKey(k => k + 1)} disabled={status.kind !== 'ready'}>{t('caves.viewer.reset')}</Button>
      </div>
      <p className="mt-2 text-xs text-muted">{t('caves.viewer.hint')}</p>
    </Dialog>
  );
}
