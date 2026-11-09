import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../../components/Button.js';
import { floorStops, nextStop, normalizeRange, type HeightProfile, type HeightRange } from './height.js';

/** A dragged handle snaps to a floor stop within this many CSS px. */
const SNAP_PX = 6;
/** Room at both ends of the track, so a handle's touch target at either end stays inside its box (CSS px). */
const EDGE_PX = 22;

type Handle = 'lo' | 'hi';
type Orientation = 'horizontal' | 'vertical';

/** A height in metres as text: whole numbers with a real minus sign ("−36"). */
export function formatMetres(n: number, lang: string): string {
  return new Intl.NumberFormat(lang, { maximumFractionDigits: 0 }).format(n).replace('-', '−');
}

/**
 * Where a key takes a handle: arrows one metre, PageUp and PageDown to the next floor stop (`floorStops`), Home and End
 * to the end of what the handle may cover (the lower one from the span's foot to the upper handle, the upper one from
 * the lower handle to the span's top). Null for other keys.
 */
export function keyStep(key: string, handle: Handle, value: HeightRange, p: HeightProfile): number | null {
  const v = value[handle];
  const [min, max] = handle === 'lo' ? [p.min, value.hi] : [value.lo, p.max];
  let next: number;
  switch (key) {
    case 'ArrowLeft': case 'ArrowDown': next = v - 1; break;
    case 'ArrowRight': case 'ArrowUp': next = v + 1; break;
    case 'PageUp': next = nextStop(floorStops(p, handle), v, 1); break;
    case 'PageDown': next = nextStop(floorStops(p, handle), v, -1); break;
    case 'Home': next = min; break;
    case 'End': next = max; break;
    default: return null;
  }
  return Math.max(min, Math.min(max, next));
}

/** The range as text: "412–420 m", "−36 bis −22 m", an open end "bis −22 m" or "ab 412 m", none "alle Höhen". */
export function rangeText(value: HeightRange | null, p: HeightProfile, t: (k: string, o?: Record<string, unknown>) => string, lang: string): string {
  if (!value) return t('factoryMap.height.all');
  const fmt = (m: number) => formatMetres(m, lang);
  if (value.lo <= p.min) return t('factoryMap.height.upTo', { value: fmt(value.hi) });
  if (value.hi >= p.max) return t('factoryMap.height.atLeast', { value: fmt(value.lo) });
  if (value.lo === value.hi) return t('factoryMap.height.one', { value: fmt(value.lo) });
  return t(value.lo < 0 ? 'factoryMap.height.rangeWords' : 'factoryMap.height.range', { lo: fmt(value.lo), hi: fmt(value.hi) });
}

/** The length of an element along an axis in CSS px, kept up to date. */
function useLength(ref: RefObject<HTMLElement | null>, vertical: boolean, fallback: number): number {
  const [len, setLen] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const l = vertical ? el.clientHeight : el.clientWidth;
      if (l > 0) setLen(l);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, vertical]);
  return len;
}

interface TrackProps {
  profile: HeightProfile;
  value: HeightRange | null;
  onChange(r: HeightRange | null): void;
  orientation: Orientation;
  /** Id of the text that describes the keys (`aria-describedby` of both handles). */
  hintId: string;
  className?: string;
}

/**
 * The two handles on one track (WAI-ARIA multi-thumb slider: two `slider`s; the caller puts them in a labelled group)
 * over a histogram of the foundations and buildings standing at each metre: detected floors as bright bars, with a
 * tick beside the track at each. A handle moves a metre per arrow key and jumps floor to floor with PageUp and
 * PageDown; dragged, it snaps to a floor stop near the pointer. A press on the track takes the nearer handle there.
 * Horizontal (low heights left) or vertical (low heights at the bottom).
 */
function HeightTrack({ profile, value, onChange, orientation, hintId, className = '' }: TrackProps) {
  const { t, i18n } = useTranslation();
  const vertical = orientation === 'vertical';
  const box = useRef<HTMLDivElement>(null);
  const thumbs = useRef<Record<Handle, HTMLDivElement | null>>({ lo: null, hi: null });
  const length = useLength(box, vertical, 240);
  const drag = useRef<{ handle: Handle | null; pointer: number; start: number } | null>(null);
  const { min, max } = profile;
  const span = Math.max(1, max - min);
  const lo = Math.max(min, Math.min(max, value?.lo ?? min));
  const hi = Math.max(lo, Math.min(max, value?.hi ?? max));
  const pct = (m: number) => ((m - min) / span) * 100;
  /** Where along the track a pointer is, CSS px from the low end, and the track's length. */
  const along = (e: { clientX: number; clientY: number }): { at: number; len: number } | null => {
    const r = box.current?.getBoundingClientRect();
    if (!r) return null;
    return vertical ? { at: r.bottom - e.clientY, len: r.height } : { at: e.clientX - r.left, len: r.width };
  };

  const set = (handle: Handle, v: number) => {
    const next = handle === 'lo' ? { lo: Math.max(min, Math.min(v, hi)), hi } : { lo, hi: Math.min(max, Math.max(v, lo)) };
    if (next.lo === lo && next.hi === hi) return;
    onChange(normalizeRange(next, profile));
  };

  /** The value at a point of the track: whole metres, or a floor stop of the handle near it. */
  const valueAt = (at: number, len: number, handle: Handle): number => {
    if (len <= 0) return handle === 'lo' ? lo : hi;
    const raw = min + (at / len) * span;
    const pxPerM = len / span;
    let best = Math.round(raw), bestD = SNAP_PX;
    for (const s of floorStops(profile, handle)) {
      const d = Math.abs(s - raw) * pxPerM;
      if (d <= bestD) { bestD = d; best = s; }
    }
    return Math.max(min, Math.min(max, best));
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const a = along(e);
    if (!a || a.len <= 0) return;
    e.preventDefault();
    const pxPerM = a.len / span;
    const loAt = (lo - min) * pxPerM, hiAt = (hi - min) * pxPerM;
    const dLo = Math.abs(a.at - loAt), dHi = Math.abs(a.at - hiAt);
    // The nearer handle (their touch targets overlap when they are close); with both on one spot the side the pointer
    // is on, or right on it the direction of the first move. Pressed on a handle it does not jump.
    let handle: Handle | null = dLo < dHi ? 'lo' : dHi < dLo ? 'hi' : null;
    if (handle === null && a.at < loAt - 3) handle = 'lo';
    if (handle === null && a.at > hiAt + 3) handle = 'hi';
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drag.current = { handle, pointer: e.pointerId, start: a.at };
    if (handle) {
      thumbs.current[handle]?.focus({ preventScroll: true });
      if (Math.min(dLo, dHi) > 6) set(handle, valueAt(a.at, a.len, handle));
    }
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    const a = along(e);
    if (!d || !a || d.pointer !== e.pointerId) return;
    if (!d.handle) {
      if (Math.abs(a.at - d.start) < 3) return;
      d.handle = a.at < d.start ? 'lo' : 'hi';
      thumbs.current[d.handle]?.focus({ preventScroll: true });
    }
    set(d.handle, valueAt(a.at, a.len, d.handle));
  };
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointer === e.pointerId) drag.current = null;
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>, handle: Handle) => {
    const next = keyStep(e.key, handle, { lo, hi }, profile);
    if (next === null) return;
    e.preventDefault();
    set(handle, next);
  };

  // The histogram: one bar per metre, at least 1.5 px thick, its length the square root of the count (a floor of a
  // dozen foundations stays visible next to one of hundreds); floors bright, the rest faint, both dimmer outside.
  let top = 0;
  for (const c of profile.counts) if (c > top) top = c;
  const barPx = Math.max(1.5, Math.min(8, (length / span) * 0.7));
  const floorSet = new Set(profile.floors);
  const bars: { at: number; h: number; inside: boolean; floor: boolean }[] = [];
  profile.counts.forEach((c, i) => {
    if (c === 0) return;
    const m = min + i;
    bars.push({ at: pct(m), h: 0.08 + 0.92 * Math.sqrt(c / top), inside: m >= lo && m <= hi, floor: floorSet.has(m) });
  });
  const barColor = (b: { inside: boolean; floor: boolean }) =>
    b.inside ? (b.floor ? 'var(--color-fg)' : 'var(--color-muted)') : b.floor ? 'var(--color-edge)' : 'var(--color-line)';

  const thumb = (handle: Handle) => {
    const v = handle === 'lo' ? lo : hi;
    return (
      <div
        ref={el => { thumbs.current[handle] = el; }}
        role="slider"
        tabIndex={0}
        aria-label={t(handle === 'lo' ? 'factoryMap.height.lower' : 'factoryMap.height.upper')}
        aria-valuemin={handle === 'lo' ? min : lo}
        aria-valuemax={handle === 'lo' ? hi : max}
        aria-valuenow={v}
        aria-valuetext={t(handle === 'lo' ? 'factoryMap.height.from' : 'factoryMap.height.to', { value: formatMetres(v, i18n.language) })}
        aria-orientation={orientation}
        aria-describedby={hintId}
        onKeyDown={e => onKeyDown(e, handle)}
        className={`group absolute flex size-8 items-center justify-center focus-ring max-[899px]:size-11 ${vertical ? 'left-1/2 -translate-x-1/2 translate-y-1/2 cursor-ns-resize' : 'top-1/2 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize'} ${handle === 'hi' ? 'z-[2]' : 'z-[1]'}`}
        style={vertical ? { bottom: `${pct(v)}%` } : { left: `${pct(v)}%` }}
        data-testid={`height-${handle}`}
      >
        <span aria-hidden="true" className={`border-2 border-bg bg-accent group-hover:bg-accent-hi ${vertical ? 'h-2.5 w-5' : 'h-5 w-2.5'}`} />
      </div>
    );
  };

  return (
    <div className={`relative touch-none select-none ${className}`} style={vertical ? { paddingBlock: EDGE_PX } : { paddingInline: EDGE_PX }}>
      <div
        ref={box}
        className="relative h-full"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {vertical ? (
          <svg aria-hidden="true" className="absolute inset-y-0 left-0 h-full w-6 overflow-visible" viewBox="0 0 1 100" preserveAspectRatio="none">
            {bars.map(b => (
              <line key={b.at} x1={1} x2={1 - b.h} y1={100 - b.at} y2={100 - b.at} stroke={barColor(b)} strokeWidth={barPx} vectorEffect="non-scaling-stroke" />
            ))}
          </svg>
        ) : (
          <svg aria-hidden="true" className="absolute inset-x-0 top-0 h-7 w-full overflow-visible" viewBox="0 0 100 1" preserveAspectRatio="none">
            {bars.map(b => (
              <line key={b.at} x1={b.at} x2={b.at} y1={1} y2={1 - b.h} stroke={barColor(b)} strokeWidth={barPx} vectorEffect="non-scaling-stroke" />
            ))}
          </svg>
        )}
        {/* The track: the chosen part in the accent, a tick at each floor. */}
        <div aria-hidden="true" className={`absolute bg-line ${vertical ? 'inset-y-0 left-8 w-1 -translate-x-1/2' : 'inset-x-0 top-9 h-1 -translate-y-1/2 max-[899px]:top-10'}`}>
          <div className="absolute bg-accent" style={vertical ? { left: 0, right: 0, bottom: `${pct(lo)}%`, height: `${pct(hi) - pct(lo)}%` } : { top: 0, bottom: 0, left: `${pct(lo)}%`, width: `${pct(hi) - pct(lo)}%` }} />
          {profile.floors.map(f => (
            <span key={f} className={`absolute bg-edge ${vertical ? 'left-2 h-px w-1.5' : 'top-2 h-1.5 w-px'}`} style={vertical ? { bottom: `${pct(f)}%` } : { left: `${pct(f)}%` }} />
          ))}
        </div>
        <div className={`absolute ${vertical ? 'inset-y-0 left-8' : 'inset-x-0 top-9 max-[899px]:top-10'}`}>
          {thumb('lo')}
          {thumb('hi')}
        </div>
      </div>
    </div>
  );
}

/**
 * The panel's height range: "Höhe" with the range as text and "Alle" (all heights) above the horizontal track. 44 px
 * touch targets below 900 px.
 */
export function HeightSlider({ profile, value, onChange }: {
  profile: HeightProfile; value: HeightRange | null; onChange(r: HeightRange | null): void;
}) {
  const { t, i18n } = useTranslation();
  const titleId = useId();
  const hintId = useId();
  return (
    <div role="group" aria-labelledby={titleId} className="flex flex-col" data-testid="height-slider">
      <div className="flex items-center gap-2">
        <span id={titleId} className="text-xs text-muted">{t('factoryMap.height.title')}</span>
        <span className="min-w-0 flex-1 truncate font-display text-base tabular-nums" data-testid="height-value">{rangeText(value, profile, t, i18n.language)}</span>
        <Button size="sm" variant="ghost" disabled={!value} onClick={() => onChange(null)}>{t('factoryMap.height.reset')}</Button>
      </div>
      <span id={hintId} className="sr-only">{t('factoryMap.height.keys')}</span>
      <HeightTrack profile={profile} value={value} onChange={onChange} orientation="horizontal" hintId={hintId} className="h-14 max-[899px]:h-16" />
    </div>
  );
}

/**
 * The map's compact height range (wide screens): a vertical track at the map's left edge, low heights at the bottom,
 * the upper limit above it and the lower one below, "Alle" at the foot.
 */
export function HeightRail({ profile, value, onChange }: {
  profile: HeightProfile; value: HeightRange | null; onChange(r: HeightRange | null): void;
}) {
  const { t, i18n } = useTranslation();
  const titleId = useId();
  const hintId = useId();
  const lo = value?.lo ?? profile.min, hi = value?.hi ?? profile.max;
  const end = (m: number, open: boolean) => (open ? '' : formatMetres(m, i18n.language));
  return (
    <div role="group" aria-labelledby={titleId} className="flex w-16 flex-col items-center" data-testid="height-rail">
      <span id={titleId} className="text-xs text-muted">{t('factoryMap.height.title')}</span>
      <span className="sr-only">{rangeText(value, profile, t, i18n.language)}</span>
      <span id={hintId} className="sr-only">{t('factoryMap.height.keys')}</span>
      <span aria-hidden="true" className="h-5 font-display text-sm tabular-nums">{end(hi, !value || hi >= profile.max)}</span>
      <HeightTrack profile={profile} value={value} onChange={onChange} orientation="vertical" hintId={hintId} className="h-56 w-full" />
      <span aria-hidden="true" className="h-5 font-display text-sm tabular-nums">{end(lo, !value || lo <= profile.min)}</span>
      <Button size="sm" variant="ghost" className="mt-1 px-2" disabled={!value} onClick={() => onChange(null)}>{t('factoryMap.height.reset')}</Button>
    </div>
  );
}
