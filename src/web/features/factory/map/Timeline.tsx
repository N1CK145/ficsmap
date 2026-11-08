import { useId, useMemo, useRef, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { WorldCtx } from '../../../app/feature.js';
import { useIsMobile } from '../../../app/useMediaQuery.js';
import { Button } from '../../../components/Button.js';
import { fieldClass } from '../../../components/Field.js';
import { IconButton } from '../../../components/IconButton.js';
import { WINDOW_FRAME } from '../../../components/Window.js';
import { useImportDialog } from '../../import/ImportDialog.js';
import { useFactoryView } from '../view.js';
import { defaultCompareId } from '../timeline.js';
import { axisPositions, labelIndices } from '../Timeline.js';
import { diffCounts } from './diff.js';
import { useMapData, type MapData } from './mapData.js';
import { useFactoryMap } from './useFactoryMap.js';

const Chevron = ({ dir }: { dir: 'left' | 'right' }) => (
  <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    <path d={dir === 'left' ? 'M10 3.5L5.5 8l4.5 4.5' : 'M6 3.5L10.5 8 6 12.5'} />
  </svg>
);

/**
 * The factory map's timeline at the bottom of the map while the factory layers are on, in the Fabrik page's design:
 * older and newer buttons, the shown save's date, and a diamond per save on a time axis (filled: shown, hollow:
 * compared). "Changes" compares with the save before (or a chosen one): new buildings are outlined green, removed ones
 * are red ghosts and productivity changes get a triangle, everything else turns grey; a counter says how many and
 * "Go to the changes" steps the map through the areas of changes, densest first ("Area 1 of 4 ›"). Arrow keys step
 * through the saves. On phones one row (older, date, newer, changes as an icon toggle), hidden while the info window
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
      {data.sel.ordered.length === 0 ? <EmptyFactory owner={ctx.world.isOwner} /> : <TimelineBar data={data} />}
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

/** A save's date and time; on phones without the year. */
function when(ms: number, lang: string, short = false): string {
  return new Date(ms).toLocaleString(lang, { day: '2-digit', month: '2-digit', ...(short ? {} : { year: 'numeric' }), hour: '2-digit', minute: '2-digit' });
}

/** "Changes" as an icon: plus and minus. */
const ChangesIcon = () => (
  <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
    <path d="M4.5 2v6M1.5 5h6M8.5 11.5h6" />
  </svg>
);

export function TimelineBar({ data }: { data: MapData }) {
  const { t, i18n } = useTranslation();
  const mobile = useIsMobile();
  const { ordered: list, index } = data.sel;
  const compareId = data.sel.compared?.id ?? null;
  const compareMode = useFactoryMap(s => s.compareMode);
  const changes = useFactoryView(s => s.compareId) !== null;
  const compareSelectId = useId();
  const points = useRef<(HTMLButtonElement | null)[]>([]);
  const positions = useMemo(() => axisPositions(list.map(s => s.saveTime)), [list]);
  const shown = list[index];
  const newest = list.length - 1;
  const go = (i: number, focus = false) => {
    const s = list[Math.max(0, Math.min(newest, i))];
    if (!s) return;
    // The newest save is "the newest": a later import moves the map on to it.
    useFactoryView.getState().select(s.id === list[newest]!.id ? null : s.id);
    if (focus) points.current[Math.max(0, Math.min(newest, i))]?.focus();
  };
  const onKeyDown = (e: KeyboardEvent) => {
    const el = e.target as HTMLElement;
    if (el.tagName === 'INPUT' || el.tagName === 'SELECT') return;
    const onPoint = el.getAttribute('role') === 'radio';
    const to = e.key === 'ArrowLeft' || (onPoint && e.key === 'ArrowDown') ? index - 1
      : e.key === 'ArrowRight' || (onPoint && e.key === 'ArrowUp') ? index + 1
        : onPoint && e.key === 'Home' ? 0 : onPoint && e.key === 'End' ? newest : null;
    if (to === null) return;
    e.preventDefault();
    go(to, onPoint);
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
            {shown ? when(shown.saveTime, i18n.language, mobile) : ''}
          </span>
          <span className="text-xs text-muted tabular-nums max-[899px]:hidden">{t('factoryMap.timeline.position', { index: index + 1, count: list.length })}</span>
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
                {list.filter(s => s.id !== shown?.id).map(s => <option key={s.id} value={s.id}>{when(s.saveTime, i18n.language)}</option>)}
              </select>
            </>
          )}
        </div>
      </div>
      {list.length > 1 && !mobile && (
        // The Fabrik page's time axis: a diamond per save, filled for the shown one, hollow for the compared one.
        <div className="relative mt-1 h-11 px-3" data-testid="timeline-track">
          <div aria-hidden="true" className="absolute inset-x-3 top-4 h-px bg-edge" />
          <div role="radiogroup" aria-label={t('factoryMap.timeline.slider')} className="relative h-full">
            {list.map((s, i) => {
              const isSel = i === index;
              const isCmp = i === comparedIndex;
              return (
                <button
                  key={s.id}
                  ref={el => { points.current[i] = el; }}
                  type="button"
                  role="radio"
                  aria-checked={isSel}
                  aria-label={when(s.saveTime, i18n.language) + (isCmp ? ` (${t('factoryMap.timeline.comparedMark')})` : '')}
                  tabIndex={isSel ? 0 : -1}
                  onClick={() => go(i)}
                  className="group absolute top-4 flex size-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center focus-ring"
                  style={{ left: `${positions[i]}%` }}
                >
                  <span
                    aria-hidden="true"
                    className={`block rotate-45 transition-transform group-hover:scale-125 motion-reduce:transition-none ${
                      isSel ? 'size-3.5 bg-accent ring-2 ring-accent/40' : isCmp ? 'size-3 border-2 border-accent bg-bg' : 'size-2 bg-muted'}`}
                  />
                </button>
              );
            })}
            {labelIndices(positions, index, comparedIndex).map(i => (
              <span
                key={i}
                aria-hidden="true"
                className={`absolute top-7 -translate-x-1/2 text-xs whitespace-nowrap tabular-nums ${i === index ? 'font-semibold text-fg' : 'text-muted'}`}
                style={{ left: `clamp(1.25rem, ${positions[i]}%, calc(100% - 1.25rem))` }}
              >
                {new Date(list[i]!.saveTime).toLocaleDateString(i18n.language, { day: '2-digit', month: '2-digit' })}
              </span>
            ))}
          </div>
        </div>
      )}
      {changes && (
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line pt-1.5 text-xs max-[899px]:text-sm" data-testid="timeline-counts" aria-live="polite">
          {compared && <span className="text-muted">{t('factoryMap.timeline.comparedWith', { date: when(compared.saveTime, i18n.language, mobile) })}</span>}
          {counts && (
            <>
              <span className="flex items-center gap-1"><span aria-hidden="true" className="inline-block size-2.5 border-2 border-free" />{t('factoryMap.timeline.added', { count: counts.added, n: num.format(counts.added) })}</span>
              <span className="flex items-center gap-1"><span aria-hidden="true" className="inline-block size-2.5 border-2 border-dashed border-conflict bg-conflict/30" />{t('factoryMap.timeline.removed', { count: counts.removed, n: num.format(counts.removed) })}</span>
              <span className="flex items-center gap-1"><span aria-hidden="true" className="text-free">▲</span>{t('factoryMap.timeline.better', { count: counts.better, n: num.format(counts.better) })}</span>
              <span className="flex items-center gap-1"><span aria-hidden="true" className="text-conflict">▼</span>{t('factoryMap.timeline.worse', { count: counts.worse, n: num.format(counts.worse) })}</span>
              {(counts.floorAdded > 0 || counts.floorRemoved > 0) && (
                <span className="text-muted max-[899px]:hidden">{t('factoryMap.timeline.floor', { added: num.format(counts.floorAdded), removed: num.format(counts.floorRemoved) })}</span>
              )}
              {(counts.linesAdded > 0 || counts.linesRemoved > 0) && (
                <span className="text-muted max-[899px]:hidden">{t('factoryMap.timeline.lines', { added: num.format(counts.linesAdded), removed: num.format(counts.linesRemoved) })}</span>
              )}
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
