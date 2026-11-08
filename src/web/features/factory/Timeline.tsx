import { useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { SnapshotSummary } from '../../../shared/factory/snapshot.js';
import { Button } from '../../components/Button.js';
import { fieldClass } from '../../components/Field.js';
import { BackIcon } from '../../components/icons.js';
import { Window } from '../../components/Window.js';
import type { FactoryFormat } from './format.js';
import { NONE } from './parts.js';
import { defaultCompareId, stepId, type TimelineSelection } from './timeline.js';
import { useFactoryView } from './view.js';

/**
 * Positions (0..100 %) of the snapshots on the time axis, oldest first: by save time, pushed apart where saves lie
 * closer than a point is wide, then squeezed back into the axis.
 */
export function axisPositions(times: readonly number[]): number[] {
  const n = times.length;
  if (n === 0) return [];
  if (n === 1) return [50];
  const min = times[0]!, span = Math.max(1, times[n - 1]! - min);
  const gap = Math.min(4, 60 / n);
  const pos = times.map(t => ((t - min) / span) * 100);
  for (let i = 1; i < n; i++) pos[i] = Math.max(pos[i]!, pos[i - 1]! + gap);
  const last = pos[n - 1]!;
  return last > 100 ? pos.map(p => (p / last) * 100) : pos;
}

/** Which points get a date under them: the selected and compared ones first, then the ends and the rest, none closer than 7 %. */
export function labelIndices(positions: readonly number[], selected: number, compared: number): number[] {
  const order = [selected, compared, 0, positions.length - 1, ...positions.keys()];
  const out: number[] = [];
  for (const i of order) {
    if (i < 0 || i >= positions.length || out.includes(i)) continue;
    if (out.every(j => Math.abs(positions[j]! - positions[i]!) >= 7)) out.push(i);
  }
  return out.sort((a, b) => a - b);
}

/**
 * The timeline over the page: every snapshot of the world as a point on a time axis (a radio group: arrows, Home and
 * End move through the saves), older/newer buttons, the selected save's date and play time, and "Compare with" (the
 * save before by default, any other from the list).
 */
export function Timeline({ sel, fmt, loading }: { sel: TimelineSelection; fmt: FactoryFormat; loading: boolean }) {
  const { t } = useTranslation();
  const select = useFactoryView(s => s.select);
  const compareWith = useFactoryView(s => s.compareWith);
  const [hover, setHover] = useState<number | null>(null);
  const points = useRef<(HTMLButtonElement | null)[]>([]);
  const compareSelect = useId();
  const positions = useMemo(() => axisPositions(sel.ordered.map(s => s.saveTime)), [sel.ordered]);
  const { selected, ordered, index, compared } = sel;
  const older = stepId(sel, -1), newer = stepId(sel, 1);

  const go = (i: number) => {
    const s = ordered[i];
    if (!s) return;
    select(i === ordered.length - 1 ? null : s.id);
    points.current[i]?.focus();
  };
  const onKey = (e: KeyboardEvent) => {
    const to = e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? index - 1
      : e.key === 'ArrowRight' || e.key === 'ArrowUp' ? index + 1
        : e.key === 'Home' ? 0 : e.key === 'End' ? ordered.length - 1 : null;
    if (to === null) return;
    e.preventDefault();
    go(Math.max(0, Math.min(ordered.length - 1, to)));
  };
  const pick = (id: number | null) => select(id !== null && id === ordered[ordered.length - 1]?.id ? null : id);
  const describe = (s: SnapshotSummary) => t('factory.timeline.point', {
    date: fmt.dateTime(s.saveTime), buildings: fmt.int(s.buildings),
    productivity: s.avgProductivity === null ? NONE : fmt.pct(s.avgProductivity),
  });
  const hovered = hover !== null ? ordered[hover] : undefined;

  return (
    <Window
      title={t('factory.timeline.title')}
      subtitle={selected ? (
        <>
          {fmt.dateTime(selected.saveTime)}
          {' · '}
          {t('factory.timeline.position', { n: index + 1, total: ordered.length })}
          {loading && <> · {t('common.loading')}</>}
        </>
      ) : undefined}
      bodyClassName="flex flex-col gap-3 p-3"
    >
      <div className="flex items-center gap-2">
        <Button size="sm" variant="secondary" disabled={older === null} onClick={() => pick(older)} aria-label={t('factory.timeline.older')} title={t('factory.timeline.older')}>
          <BackIcon />
          <span className="max-sm:sr-only">{t('factory.timeline.olderShort')}</span>
        </Button>
        <div className="relative h-[4.5rem] min-w-0 flex-1 px-3">
          <div aria-hidden="true" className="absolute inset-x-3 top-7 h-px bg-edge" />
          <div role="radiogroup" aria-label={t('factory.timeline.label')} className="relative h-full" onKeyDown={onKey}>
            {ordered.map((s, i) => {
              const isSel = i === index;
              const isCmp = compared?.id === s.id;
              return (
                <button
                  key={s.id}
                  ref={el => { points.current[i] = el; }}
                  type="button"
                  role="radio"
                  aria-checked={isSel}
                  aria-label={describe(s) + (isCmp ? ` (${t('factory.timeline.comparedMark')})` : '')}
                  tabIndex={isSel ? 0 : -1}
                  onClick={() => go(i)}
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover(null)}
                  onFocus={() => setHover(i)}
                  onBlur={() => setHover(null)}
                  data-selected={isSel || undefined}
                  data-compared={isCmp || undefined}
                  className="group absolute top-7 flex size-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center focus-ring max-[899px]:size-11"
                  style={{ left: `${positions[i]}%` }}
                >
                  <span
                    aria-hidden="true"
                    className={`block rotate-45 transition-transform group-hover:scale-125 ${
                      isSel ? 'size-3.5 bg-accent ring-2 ring-accent/40' : isCmp ? 'size-3 border-2 border-accent bg-bg' : 'size-2 bg-muted'}`}
                  />
                </button>
              );
            })}
            {labelIndices(positions, index, compared ? ordered.findIndex(o => o.id === compared.id) : -1).map(i => (
              <span
                key={i}
                aria-hidden="true"
                className={`absolute top-12 -translate-x-1/2 text-xs whitespace-nowrap tabular-nums max-[899px]:top-14 ${i === index ? 'font-semibold text-accent' : 'text-muted'}`}
                style={{ left: `${positions[i]}%` }}
              >
                {fmt.dateShort(ordered[i]!.saveTime)}
              </span>
            ))}
          </div>
          {hovered && (
            <div
              role="tooltip"
              className="pointer-events-none absolute bottom-full z-10 mb-1 w-max max-w-64 -translate-x-1/2 chamfer border border-line bg-raised px-2 py-1 text-xs shadow-lg max-[899px]:text-sm"
              style={{ left: `clamp(4rem, ${positions[hover!]}%, calc(100% - 4rem))` }}
            >
              <p className="font-semibold">{fmt.dateTime(hovered.saveTime)}</p>
              <p className="text-muted tabular-nums">
                {t('factory.timeline.tooltip', {
                  buildings: fmt.int(hovered.buildings), machines: fmt.int(hovered.machines),
                  productivity: hovered.avgProductivity === null ? NONE : fmt.pct(hovered.avgProductivity),
                })}
              </p>
            </div>
          )}
        </div>
        <Button size="sm" variant="secondary" disabled={newer === null} onClick={() => pick(newer)} aria-label={t('factory.timeline.newer')} title={t('factory.timeline.newer')}>
          <span className="max-sm:sr-only">{t('factory.timeline.newerShort')}</span>
          <BackIcon className="rotate-180" />
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <label className="inline-flex min-h-8 items-center gap-2 max-[899px]:min-h-11">
          <input
            type="checkbox"
            checked={compared !== null}
            disabled={ordered.length < 2}
            onChange={e => compareWith(e.target.checked ? defaultCompareId(sel) : null)}
          />
          {t('factory.timeline.compare')}
        </label>
        {compared !== null && (
          <>
            <label htmlFor={compareSelect} className="sr-only">{t('factory.timeline.compareWith')}</label>
            <select
              id={compareSelect}
              value={compared.id}
              onChange={e => compareWith(Number(e.target.value))}
              className={fieldClass({ size: 'sm' }, 'w-auto')}
            >
              {[...ordered].reverse().filter(s => s.id !== selected?.id).map(s => (
                <option key={s.id} value={s.id}>{fmt.dateTime(s.saveTime)}</option>
              ))}
            </select>
            <span className="inline-flex items-center gap-1.5 text-muted">
              <span aria-hidden="true" className="inline-block size-2.5 rotate-45 border-2 border-accent" />
              {t('factory.timeline.comparedLegend')}
            </span>
            {/* "Änderungen" sits below the production lines: a way down to it. */}
            <a
              href="#factory-changes"
              onClick={e => { e.preventDefault(); document.getElementById('factory-changes')?.scrollIntoView?.({ block: 'start' }); }}
              className="font-medium text-accent underline-offset-2 hover:underline focus-ring"
            >
              {t('factory.timeline.toChanges')}
            </a>
          </>
        )}
      </div>
    </Window>
  );
}
