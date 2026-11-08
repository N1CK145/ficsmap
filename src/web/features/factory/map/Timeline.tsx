import { useId, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { WorldCtx } from '../../../app/feature.js';
import { Button } from '../../../components/Button.js';
import { fieldClass } from '../../../components/Field.js';
import { IconButton } from '../../../components/IconButton.js';
import { WINDOW_FRAME } from '../../../components/Window.js';
import { useImportDialog } from '../../import/ImportDialog.js';
import { useFactoryView } from '../view.js';
import { defaultCompareId } from '../timeline.js';
import { diffCounts } from './diff.js';
import { useMapData, type MapData } from './mapData.js';
import { useFactoryMap } from './useFactoryMap.js';

const Chevron = ({ dir }: { dir: 'left' | 'right' }) => (
  <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    <path d={dir === 'left' ? 'M10 3.5L5.5 8l4.5 4.5' : 'M6 3.5L10.5 8 6 12.5'} />
  </svg>
);

/**
 * The factory map's timeline at the bottom of the map while the factory layers are on: the previous and next save, a
 * slider with a tick per save, the shown save's date, and "Changes": compared with the save before (or a chosen one),
 * new buildings are outlined green, removed ones are red ghosts and productivity changes get a triangle; a counter says
 * how many. Arrow keys step through the saves on the slider and on the buttons. Without snapshots it explains how to
 * get some (the owner gets the import dialog's two modes).
 */
export function FactoryTimeline({ ctx }: { ctx: WorldCtx }) {
  const visible = useFactoryMap(s => s.visible);
  return visible ? <MapTimeline ctx={ctx} /> : null;
}

function MapTimeline({ ctx }: { ctx: WorldCtx }) {
  const data = useMapData(ctx.worldId, ctx.me.datasetVersion, ctx.index.ds.bounds, true);
  if (!data.sel.list) return null;
  return (
    <div
      className="ficsmap-factory-timeline pointer-events-auto absolute bottom-3 left-1/2 z-[900] w-[min(760px,calc(100%-1.5rem))] -translate-x-1/2 max-[899px]:bottom-[124px]"
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

/** A save's date and time, short. */
function when(ms: number, lang: string): string {
  return new Date(ms).toLocaleString(lang, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function TimelineBar({ data }: { data: MapData }) {
  const { t, i18n } = useTranslation();
  const { ordered: list, index } = data.sel;
  const compareId = data.sel.compared?.id ?? null;
  const compareMode = useFactoryMap(s => s.compareMode);
  const changes = useFactoryView(s => s.compareId) !== null;
  const sliderId = useId();
  const compareSelectId = useId();
  const shown = list[index];
  const newest = list.length - 1;
  const go = (i: number) => {
    const s = list[Math.max(0, Math.min(newest, i))];
    if (!s) return;
    // The newest save is "the newest": a later import moves the map on to it.
    useFactoryView.getState().select(s.id === list[newest]!.id ? null : s.id);
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'SELECT') return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); go(index - 1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); go(index + 1); }
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
  const compared = list.find(s => s.id === compareId);
  const num = new Intl.NumberFormat(i18n.language);

  return (
    <section
      aria-label={t('factoryMap.timeline.label')}
      onKeyDown={onKeyDown}
      className={`${WINDOW_FRAME} border-t-2 border-t-accent px-3 py-2`}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex items-center gap-1">
          {/* aria-disabled, not disabled: a disabled button would drop the keyboard focus at the end of the timeline. */}
          <IconButton size="sm" aria-label={t('factoryMap.timeline.previous')} title={t('factoryMap.timeline.previous')} aria-disabled={index <= 0} className="aria-disabled:cursor-default aria-disabled:opacity-40" onClick={() => go(index - 1)}>
            <Chevron dir="left" />
          </IconButton>
          <IconButton size="sm" aria-label={t('factoryMap.timeline.next')} title={t('factoryMap.timeline.next')} aria-disabled={index >= newest} className="aria-disabled:cursor-default aria-disabled:opacity-40" onClick={() => go(index + 1)}>
            <Chevron dir="right" />
          </IconButton>
        </div>
        <div className="flex-1 whitespace-nowrap">
          <div className="flex items-baseline gap-2">
            <span className="font-display text-base font-semibold tracking-wide tabular-nums" data-testid="timeline-date">{shown ? when(shown.saveTime, i18n.language) : ''}</span>
            <span className="text-xs text-muted tabular-nums">{t('factoryMap.timeline.position', { index: index + 1, count: list.length })}</span>
            {data.loading && <span role="status" className="text-xs text-accent">{t('factoryMap.timeline.loading')}</span>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant={changes ? 'primary' : 'secondary'} aria-pressed={changes} disabled={list.length < 2} onClick={toggleChanges}>
            {t('factoryMap.timeline.changes')}
          </Button>
          {changes && list.length > 2 && (
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
      {list.length > 1 && (
        <div className="mt-1">
          <label htmlFor={sliderId} className="sr-only">{t('factoryMap.timeline.slider')}</label>
          <input
            id={sliderId}
            type="range"
            min={0}
            max={newest}
            step={1}
            value={index}
            aria-valuetext={shown ? when(shown.saveTime, i18n.language) : undefined}
            onChange={e => go(Number(e.target.value))}
            className="w-full accent-accent"
            list={`${sliderId}-ticks`}
          />
          <datalist id={`${sliderId}-ticks`}>
            {list.map((s, i) => <option key={s.id} value={i} label={when(s.saveTime, i18n.language)} />)}
          </datalist>
          <div aria-hidden="true" className="relative h-4 text-[11px] text-muted tabular-nums">
            {list.map((s, i) => {
              // Dates under the first, the last and the shown save; a tick for every save.
              // Evenly spaced, under the slider's steps.
              const left = newest === 0 ? 0 : (i / newest) * 100;
              const label = i === 0 || i === newest || i === index;
              return (
                <span key={s.id} className="absolute top-0 flex -translate-x-1/2 flex-col items-center" style={{ left: `calc(8px + (100% - 16px) * ${left / 100})` }}>
                  <span className={`h-1.5 w-px ${i === index ? 'bg-accent' : compareId === s.id ? 'bg-fg' : 'bg-edge'}`} />
                  {label && <span className={`whitespace-nowrap ${i === index ? 'text-fg' : ''} ${i === 0 && newest > 0 ? 'translate-x-1/3' : i === newest && newest > 0 ? '-translate-x-1/3' : ''}`}>{new Date(s.saveTime).toLocaleDateString(i18n.language, { day: '2-digit', month: '2-digit' })}</span>}
                </span>
              );
            })}
          </div>
        </div>
      )}
      {changes && (
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line pt-1.5 text-xs" data-testid="timeline-counts" aria-live="polite">
          {compared && <span className="text-muted">{t('factoryMap.timeline.comparedWith', { date: when(compared.saveTime, i18n.language) })}</span>}
          {counts && (
            <>
              <span className="flex items-center gap-1"><span aria-hidden="true" className="inline-block size-2.5 border-2 border-free" />{t('factoryMap.timeline.added', { count: counts.added, n: num.format(counts.added) })}</span>
              <span className="flex items-center gap-1"><span aria-hidden="true" className="inline-block size-2.5 border-2 border-dashed border-conflict bg-conflict/30" />{t('factoryMap.timeline.removed', { count: counts.removed, n: num.format(counts.removed) })}</span>
              <span className="flex items-center gap-1"><span aria-hidden="true" className="text-free">▲</span>{t('factoryMap.timeline.better', { count: counts.better, n: num.format(counts.better) })}</span>
              <span className="flex items-center gap-1"><span aria-hidden="true" className="text-conflict">▼</span>{t('factoryMap.timeline.worse', { count: counts.worse, n: num.format(counts.worse) })}</span>
              {(counts.floorAdded > 0 || counts.floorRemoved > 0) && (
                <span className="text-muted">{t('factoryMap.timeline.floor', { added: num.format(counts.floorAdded), removed: num.format(counts.floorRemoved) })}</span>
              )}
              {(counts.linesAdded > 0 || counts.linesRemoved > 0) && (
                <span className="text-muted">{t('factoryMap.timeline.lines', { added: num.format(counts.linesAdded), removed: num.format(counts.linesRemoved) })}</span>
              )}
            </>
          )}
          {!compared && !data.loading && <span className="text-muted">{t('factoryMap.timeline.nothingToCompare')}</span>}
        </div>
      )}
    </section>
  );
}
