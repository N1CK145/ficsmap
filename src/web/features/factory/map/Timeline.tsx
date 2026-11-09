import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { canAdmin } from '../../../../shared/roles.js';
import type { WorldCtx } from '../../../app/feature.js';
import { useIsMobile } from '../../../app/useMediaQuery.js';
import { useFormatDate } from '../../../app/dates.js';
import { Button } from '../../../components/Button.js';
import { fieldClass } from '../../../components/Field.js';
import { IconButton } from '../../../components/IconButton.js';
import { WINDOW_FRAME } from '../../../components/Window.js';
import { useImportDialog } from '../../import/ImportDialog.js';
import { useFactoryView } from '../view.js';
import { defaultCompareId } from '../timeline.js';
import { axisPositions, labelIndices } from '../Timeline.js';
import { diffSummary } from '../changes.js';
import { diffCounts } from './diff.js';
import { useMapData, type MapData } from './mapData.js';
import { PLAY_SPEEDS, PLAY_STEP_MS, useFactoryMap, type PlaySpeed } from './useFactoryMap.js';

const Chevron = ({ dir }: { dir: 'left' | 'right' }) => (
  <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    <path d={dir === 'left' ? 'M10 3.5L5.5 8l4.5 4.5' : 'M6 3.5L10.5 8 6 12.5'} />
  </svg>
);

/** While the slider is dragged, the save under it is shown once the pointer rests this long (ms), not every one passed. */
const DRAG_SHOW_MS = 120;

/** The save nearest to a point of the time axis (`pct` 0..100), by the axis positions (`axisPositions`). */
export function nearestIndex(positions: readonly number[], pct: number): number {
  let best = 0;
  for (let i = 1; i < positions.length; i++) if (Math.abs(positions[i]! - pct) < Math.abs(positions[best]! - pct)) best = i;
  return best;
}

/**
 * The factory map's timeline at the bottom of the map while the factory layers are on, in the Fabrik page's design:
 * older and newer buttons, the shown save's date, and a slider over the time axis with a diamond per save (hollow:
 * compared). The slider's handle can be dragged (it snaps to the nearest save) or the track clicked; a play button
 * steps through the saves from the shown one to the newest (from the oldest when the newest is shown), each staying
 * at least `PLAY_STEP_MS` divided by the chosen speed and until it is drawn. "Changes" compares with the save before (or a chosen one): new buildings are outlined green, removed ones
 * are red ghosts and productivity changes get a triangle, everything else turns grey; a counter says how many and
 * "Go to the changes" steps the map through the areas of changes, densest first ("Area 1 of 4 ›"). Arrow keys step
 * through the saves. On phones the slider has no dates under it and the first row is older, date, newer, changes as
 * an icon toggle; the timeline hides while the info window
 * (a building's, or a line's card) is open. Without snapshots it explains how to get some.
 */
export function FactoryTimeline({ ctx }: { ctx: WorldCtx }) {
  const visible = useFactoryMap(s => s.visible);
  const selected = useFactoryMap(s => s.selection) !== null;
  const lineOpen = useFactoryView(s => s.lineId) !== null;
  const mobile = useIsMobile();
  // On phones the info window takes the timeline's place.
  return visible && !(mobile && (selected || lineOpen)) ? <MapTimeline ctx={ctx} /> : null;
}

function MapTimeline({ ctx }: { ctx: WorldCtx }) {
  const data = useMapData(ctx.worldId, ctx.me.datasetVersion, ctx.index.ds.bounds, true);
  if (!data.sel.list) return null;
  return (
    <div
      // On phones above the sheet's peek and the map attribution (112 px + its line).
      className="ficsmap-factory-timeline pointer-events-auto absolute bottom-3 left-1/2 z-[900] w-[min(760px,calc(100%-1.5rem))] -translate-x-1/2 max-[899px]:bottom-[136px]"
      data-testid="factory-timeline"
    >
      {data.sel.ordered.length === 0 ? <EmptyFactory owner={canAdmin(ctx.world.role)} /> : <TimelineBar data={data} />}
    </div>
  );
}

/** The empty state: no snapshot of this world yet. */
export function EmptyFactory({ owner, framed = true }: { owner: boolean; framed?: boolean }) {
  const { t } = useTranslation();
  const show = useImportDialog(s => s.show);
  return (
    <div role="note" className={`flex flex-col gap-2 text-sm ${framed ? `${WINDOW_FRAME} border-t-2 border-t-accent p-3` : ''}`} data-testid="factory-empty">
      <p className="font-semibold">{t('factoryMap.empty.title')}</p>
      <p className="text-muted">{t(owner ? 'factoryMap.empty.owner' : 'factoryMap.empty.member')}</p>
      {owner && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="primary" onClick={() => show('save')}>{t('factoryMap.empty.import')}</Button>
          <Button size="sm" onClick={() => show('older')}>{t('factoryMap.empty.older')}</Button>
        </div>
      )}
    </div>
  );
}

/** A save's date and time (on phones without the year), in the chosen date format. */
function useWhen(): (ms: number, short?: boolean) => string {
  const formatDate = useFormatDate();
  return (ms, short = false) => formatDate(ms, { day: '2-digit', month: '2-digit', ...(short ? {} : { year: 'numeric' }), hour: '2-digit', minute: '2-digit' });
}

const PlayIcon = () => (
  <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M4.5 2.5v11L13 8z" /></svg>
);
const PauseIcon = () => (
  <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M4 2.5h3v11H4zM9 2.5h3v11H9z" /></svg>
);

/** "Changes" as an icon: plus and minus. */
const ChangesIcon = () => (
  <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
    <path d="M4.5 2v6M1.5 5h6M8.5 11.5h6" />
  </svg>
);

export function TimelineBar({ data }: { data: MapData }) {
  const { t, i18n } = useTranslation();
  const formatDate = useFormatDate();
  const when = useWhen();
  const mobile = useIsMobile();
  const { ordered: list, index } = data.sel;
  const compareId = data.sel.compared?.id ?? null;
  const compareMode = useFactoryMap(s => s.compareMode);
  const changes = useFactoryView(s => s.compareId) !== null;
  const compareSelectId = useId();
  const speedSelectId = useId();
  const positions = useMemo(() => axisPositions(list.map(s => s.saveTime)), [list]);
  const newest = list.length - 1;
  /** Shows the i-th save (clamped). */
  const show = useCallback((i: number) => {
    const s = list[Math.max(0, Math.min(list.length - 1, i))];
    if (!s) return;
    // The newest save is "the newest": a later import moves the map on to it. Timeline input: the Fabrikplan panel
    // follows once the timeline rests (`SETTLE_MS`).
    useFactoryView.getState().select(s.id === list[list.length - 1]!.id ? null : s.id, { input: true });
  }, [list]);

  // Dragging the slider: the handle (and the date) follow the pointer at once, the map once the pointer rests.
  const axis = useRef<HTMLDivElement>(null);
  const thumb = useRef<HTMLDivElement>(null);
  const drag = useRef<{ pointer: number; at: number } | null>(null);
  const [dragAt, setDragAt] = useState<number | null>(null);
  const at = dragAt ?? index;
  const shown = list[at];
  useEffect(() => {
    if (dragAt === null || dragAt === index) return;
    const timer = setTimeout(() => show(dragAt), DRAG_SHOW_MS);
    return () => clearTimeout(timer);
  }, [dragAt, index, show]);

  // Playing: on to the next save once the shown one is drawn and has been on the map long enough; stops at the newest.
  const [playing, setPlaying] = useState(false);
  const speed = useFactoryMap(s => s.playSpeed);
  // Pressed slider and playing hold the panel still; letting go starts its rest.
  useEffect(() => {
    useFactoryView.getState().hold('play', playing);
    return () => useFactoryView.getState().hold('play', false);
  }, [playing]);
  const dragging = dragAt !== null;
  useEffect(() => {
    useFactoryView.getState().hold('drag', dragging);
    return () => useFactoryView.getState().hold('drag', false);
  }, [dragging]);
  useEffect(() => {
    if (!playing || dragAt !== null) return;
    if (index >= newest) { setPlaying(false); return; }
    if (data.loading) return;
    const timer = setTimeout(() => show(index + 1), PLAY_STEP_MS / speed);
    return () => clearTimeout(timer);
  }, [playing, dragAt, index, newest, data.loading, speed, show]);
  const togglePlay = () => {
    if (playing) { setPlaying(false); return; }
    if (index >= newest) show(0);
    setPlaying(true);
  };
  /** A step by hand (buttons, keys, the slider) stops playing. */
  const go = (i: number) => {
    setPlaying(false);
    show(i);
  };

  const indexAt = (clientX: number): number | null => {
    const r = axis.current?.getBoundingClientRect();
    if (!r || r.width <= 0 || list.length === 0) return null;
    return nearestIndex(positions, ((clientX - r.left) / r.width) * 100);
  };
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const i = indexAt(e.clientX);
    if (i === null) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drag.current = { pointer: e.pointerId, at: i };
    setPlaying(false);
    setDragAt(i);
    thumb.current?.focus({ preventScroll: true });
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.pointer !== e.pointerId) return;
    const i = indexAt(e.clientX);
    if (i === null || i === d.at) return;
    d.at = i;
    setDragAt(i);
  };
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.pointer !== e.pointerId) return;
    drag.current = null;
    setDragAt(null);
    show(d.at);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const el = e.target as HTMLElement;
    if (el.tagName === 'INPUT' || el.tagName === 'SELECT') return;
    const onSlider = el.getAttribute('role') === 'slider';
    const page = Math.max(1, Math.round(list.length / 10));
    const to = e.key === 'ArrowLeft' || (onSlider && e.key === 'ArrowDown') ? index - 1
      : e.key === 'ArrowRight' || (onSlider && e.key === 'ArrowUp') ? index + 1
        : onSlider && e.key === 'PageDown' ? index - page : onSlider && e.key === 'PageUp' ? index + page
          : onSlider && e.key === 'Home' ? 0 : onSlider && e.key === 'End' ? newest : null;
    if (to === null) return;
    e.preventDefault();
    go(to);
  };
  const toggleChanges = () => {
    const v = useFactoryView.getState();
    if (changes) { v.compareWith(null); return; }
    useFactoryMap.getState().setCompareMode('previous');
    // The page's default: the save before, else (the oldest shown) the one after.
    v.compareWith(defaultCompareId(data.sel));
  };
  const onCompare = (value: string) => {
    if (value === 'previous') {
      useFactoryMap.getState().setCompareMode('previous');
      useFactoryView.getState().compareWith(list[index - 1]?.id ?? null);
    } else {
      useFactoryMap.getState().setCompareMode('chosen');
      useFactoryView.getState().compareWith(Number(value));
    }
  };
  const counts = data.diff || data.geometry ? diffCounts(data.diff, data.geometry) : null;
  // The Fabrik page's rows (machines, logistics, foundations, other only when present), so both group the same way;
  // the map adds the floor pieces and belts, pipes and roads it compares itself.
  const rows = data.diff && data.labels && counts ? diffSummary(data.diff, data.labels.category, counts) : null;
  const area = useFactoryMap(s => s.changeArea);
  const areaCount = useFactoryMap(s => s.changeAreaCount);
  const compared = list.find(s => s.id === compareId);
  const comparedIndex = compared ? list.indexOf(compared) : -1;
  const num = new Intl.NumberFormat(i18n.language);
  const anyChange = counts !== null && counts.added + counts.removed + counts.better + counts.worse + counts.floorAdded + counts.floorRemoved > 0;

  return (
    <section
      aria-label={t('factoryMap.timeline.label')}
      onKeyDown={onKeyDown}
      className={`${WINDOW_FRAME} border-t-2 border-t-accent px-3 py-2 max-[899px]:px-2 max-[899px]:py-1`}
    >
      <div className="flex items-center gap-x-2 gap-y-2 max-[899px]:gap-x-1">
        {/* aria-disabled, not disabled: a disabled button would drop the keyboard focus at the end of the timeline. */}
        <IconButton size="sm" aria-label={t('factoryMap.timeline.previous')} title={t('factoryMap.timeline.previous')} aria-disabled={index <= 0} className="aria-disabled:cursor-default aria-disabled:opacity-40" onClick={() => go(index - 1)}>
          <Chevron dir="left" />
        </IconButton>
        <div className="flex min-w-0 items-baseline gap-2 whitespace-nowrap max-[899px]:flex-1 max-[899px]:justify-center">
          <span aria-live="polite" aria-atomic="true" className="font-display text-base font-semibold tracking-wide tabular-nums" data-testid="timeline-date">
            {shown ? when(shown.saveTime, mobile) : ''}
          </span>
          <span className="text-xs text-muted tabular-nums max-[899px]:hidden">{t('factoryMap.timeline.position', { index: at + 1, count: list.length })}</span>
          {/* Always there, so screen readers hear the change of its text. */}
          <span role="status" className="text-xs text-muted max-[899px]:sr-only">{data.loading ? t('factoryMap.timeline.loading') : ''}</span>
        </div>
        <IconButton size="sm" aria-label={t('factoryMap.timeline.next')} title={t('factoryMap.timeline.next')} aria-disabled={index >= newest} className="aria-disabled:cursor-default aria-disabled:opacity-40" onClick={() => go(index + 1)}>
          <Chevron dir="right" />
        </IconButton>
        <div className="ml-auto flex items-center gap-2 max-[899px]:ml-0">
          {mobile ? (
            <IconButton
              size="sm"
              variant={changes ? 'primary' : 'secondary'}
              aria-label={t('factoryMap.timeline.changes')}
              title={t('factoryMap.timeline.changes')}
              aria-pressed={changes}
              disabled={list.length < 2}
              onClick={toggleChanges}
            >
              <ChangesIcon />
            </IconButton>
          ) : (
            <Button size="sm" variant={changes ? 'primary' : 'secondary'} aria-pressed={changes} disabled={list.length < 2} onClick={toggleChanges}>
              {t('factoryMap.timeline.changes')}
            </Button>
          )}
          {changes && list.length > 2 && !mobile && (
            <>
              <label htmlFor={compareSelectId} className="sr-only">{t('factoryMap.timeline.compareWith')}</label>
              <select
                id={compareSelectId}
                className={fieldClass({ size: 'sm' }, 'w-auto max-w-48')}
                value={compareMode === 'previous' ? 'previous' : String(compareId ?? 'previous')}
                onChange={e => onCompare(e.target.value)}
              >
                <option value="previous">{t('factoryMap.timeline.comparePrevious')}</option>
                {list.filter(s => s.id !== shown?.id).map(s => <option key={s.id} value={s.id}>{when(s.saveTime)}</option>)}
              </select>
            </>
          )}
        </div>
      </div>
      {list.length > 1 && (
        // The Fabrik page's time axis as a slider: a diamond per save (hollow for the compared one), the handle on the
        // shown one, the part up to it filled. Play and speed sit at its ends.
        <div className={`mt-1 flex gap-2 max-[899px]:gap-1 ${mobile ? 'items-center' : 'items-start'}`}>
          <IconButton
            size="sm"
            variant={playing ? 'primary' : 'secondary'}
            aria-label={t(playing ? 'factoryMap.timeline.pause' : 'factoryMap.timeline.play')}
            title={t(playing ? 'factoryMap.timeline.pause' : 'factoryMap.timeline.play')}
            onClick={togglePlay}
            data-testid="timeline-play"
          >
            {playing ? <PauseIcon /> : <PlayIcon />}
          </IconButton>
          <div
            className="relative h-11 min-w-0 flex-1 cursor-pointer touch-none px-3 select-none"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            data-testid="timeline-track"
          >
            <div ref={axis} className="relative h-full">
              <div aria-hidden="true" className={`absolute inset-x-0 h-px bg-edge ${mobile ? 'top-1/2' : 'top-4'}`} />
              <div
                aria-hidden="true"
                className={`absolute left-0 h-0.5 -translate-y-1/4 bg-accent/60 ${mobile ? 'top-1/2' : 'top-4'} ${dragAt === null ? 'motion-safe:transition-[width] motion-safe:duration-150' : ''}`}
                style={{ width: `${positions[at]}%` }}
              />
              {list.map((s, i) => (
                <span
                  key={s.id}
                  aria-hidden="true"
                  className={`absolute block -translate-x-1/2 -translate-y-1/2 rotate-45 ${mobile ? 'top-1/2' : 'top-4'} ${
                    i === comparedIndex ? 'size-3 border-2 border-accent bg-bg' : i <= at ? 'size-2 bg-accent/70' : 'size-2 bg-muted'}`}
                  style={{ left: `${positions[i]}%` }}
                />
              ))}
              <div
                ref={thumb}
                role="slider"
                tabIndex={0}
                aria-label={t('factoryMap.timeline.slider')}
                aria-valuemin={1}
                aria-valuemax={list.length}
                aria-valuenow={at + 1}
                aria-valuetext={shown ? when(shown.saveTime) : undefined}
                className={`group absolute flex size-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center focus-ring max-[899px]:size-11 ${
                  mobile ? 'top-1/2' : 'top-4'} ${dragAt === null ? 'cursor-grab motion-safe:transition-[left] motion-safe:duration-150' : 'cursor-grabbing'}`}
                style={{ left: `${positions[at]}%` }}
              >
                <span aria-hidden="true" className="block size-4 rotate-45 bg-accent ring-2 ring-accent/40 shadow-md transition-transform group-hover:scale-110 motion-reduce:transition-none" />
              </div>
              {!mobile && labelIndices(positions, at, comparedIndex).map(i => (
                <span
                  key={i}
                  aria-hidden="true"
                  className={`pointer-events-none absolute top-7 -translate-x-1/2 text-xs whitespace-nowrap tabular-nums ${i === at ? 'font-semibold text-fg' : 'text-muted'}`}
                  style={{ left: `clamp(1.25rem, ${positions[i]}%, calc(100% - 1.25rem))` }}
                >
                  {formatDate(list[i]!.saveTime, { day: '2-digit', month: '2-digit' })}
                </span>
              ))}
            </div>
          </div>
          <label htmlFor={speedSelectId} className="sr-only">{t('factoryMap.timeline.speed')}</label>
          <select
            id={speedSelectId}
            title={t('factoryMap.timeline.speed')}
            className={fieldClass({ size: 'sm' }, 'w-auto')}
            value={speed}
            onChange={e => useFactoryMap.getState().setPlaySpeed(Number(e.target.value) as PlaySpeed)}
          >
            {PLAY_SPEEDS.map(v => <option key={v} value={v}>{num.format(v)}×</option>)}
          </select>
        </div>
      )}
      {changes && (
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line pt-1.5 text-xs max-[899px]:text-sm" data-testid="timeline-counts" aria-live="polite">
          {compared && <span className="text-muted">{t('factoryMap.timeline.comparedWith', { date: when(compared.saveTime, mobile) })}</span>}
          {counts && (
            <>
              {rows?.map(r => (
                <span key={r.key} className="flex items-baseline gap-1.5" data-row={r.key}>
                  <span className="text-muted">{t(`factory.changes.row.${r.key}`)}</span>
                  {r.added > 0 && <span className="font-display font-semibold text-free tabular-nums">{t('factory.changes.added', { count: r.added })}</span>}
                  {r.removed > 0 && <span className="font-display font-semibold text-conflict tabular-nums">{t('factory.changes.removed', { count: r.removed })}</span>}
                  {r.added + r.removed === 0 && <span className="text-muted">{t('factory.changes.none')}</span>}
                </span>
              ))}
              <span className="flex items-center gap-1"><span aria-hidden="true" className="text-free">▲</span>{t('factoryMap.timeline.better', { count: counts.better, n: num.format(counts.better) })}</span>
              <span className="flex items-center gap-1"><span aria-hidden="true" className="text-conflict">▼</span>{t('factoryMap.timeline.worse', { count: counts.worse, n: num.format(counts.worse) })}</span>
              {anyChange && (
                <Button
                  size="sm" variant="ghost" className="ml-auto" data-testid="timeline-to-changes"
                  title={area >= 0 && areaCount > 1 ? t('factoryMap.timeline.areaNext') : undefined}
                  onClick={() => useFactoryMap.getState().requestFitChanges()}
                >
                  {area < 0 || areaCount < 2 ? t('factoryMap.timeline.toChanges')
                    : <>{t('factoryMap.timeline.area', { index: area + 1, count: areaCount })} <span aria-hidden="true">›</span></>}
                </Button>
              )}
            </>
          )}
          {!compared && !data.loading && <span className="text-muted">{t('factoryMap.timeline.nothingToCompare')}</span>}
        </div>
      )}
    </section>
  );
}
