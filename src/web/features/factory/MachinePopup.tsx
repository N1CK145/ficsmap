import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type KeyboardEvent as ReactKeyboardEvent } from 'react';

/** A box in viewport coordinates. */
export interface Box { left: number; top: number; right: number; bottom: number }

/** Space between the popup and what it points at, and between the popup and the edge of its area, px. */
const GAP = 12;
const EDGE = 8;
/** A pointer that moved farther than this between press and release dragged (the map), it did not click. */
const CLICK_SLOP_PX = 6;

/**
 * Where a popup of `w` × `h` px goes next to `anchor`, inside `area` (all in viewport coordinates): `side` tries right
 * of the anchor, then left (vertically level with it), then below and above; `below` tries below, then above (left
 * edges aligned), then right and left. Whatever fits first wins; else it is pushed inside the area (it may then cover
 * the anchor), and a popup taller than the area starts at its top.
 */
export function placePopup(anchor: Box, w: number, h: number, area: Box, prefer: 'side' | 'below'): { left: number; top: number } {
  const minX = area.left + EDGE;
  const maxX = area.right - EDGE - w;
  const minY = area.top + EDGE;
  const maxY = area.bottom - EDGE - h;
  const clampX = (x: number) => Math.max(minX, Math.min(maxX, x));
  const clampY = (y: number) => Math.max(minY, Math.min(maxY, y));
  const midY = (anchor.top + anchor.bottom) / 2;
  const sides = [
    { left: anchor.right + GAP, top: clampY(midY - h / 3) },
    { left: anchor.left - GAP - w, top: clampY(midY - h / 3) },
  ];
  const levels = [
    { left: clampX(anchor.left), top: anchor.bottom + GAP },
    { left: clampX(anchor.left), top: anchor.top - GAP - h },
  ];
  // A row on the page with no room above or below (a tall popup): beside it, so the row stays in sight.
  const order = prefer === 'side' ? [...sides, ...levels] : [...levels, ...sides];
  const fit = order.find(p => p.left >= minX - 0.5 && p.left <= maxX + 0.5 && p.top >= minY - 0.5 && p.top <= maxY + 0.5);
  if (fit) return fit;
  const first = order[0]!;
  return { left: clampX(first.left), top: maxY < minY ? minY : clampY(first.top) };
}

export interface MachinePopupProps {
  /** The dialog's accessible name (the machine's name). */
  label: string;
  /**
   * What it points at and the area it stays in, viewport coordinates; read on every placement. A null anchor keeps
   * the last place.
   */
  anchor(): Box | null;
  area(): Box;
  /** Calls `update` whenever the anchor or the area may have moved (the map pans, the page scrolls); returns the unsubscribe. */
  subscribe(update: () => void): () => void;
  prefer: 'side' | 'below';
  /** A bottom sheet (phones): `sheetClassName` places it, no anchor. */
  sheet: boolean;
  sheetClassName: string;
  /**
   * What is open, read at the press and at the click: a click outside closes the popup only when it did not open
   * something else meanwhile (another machine, the same one again).
   */
  openKey(): unknown;
  onClose(): void;
  /**
   * Esc: `inside` handles it only from within the popup (the map handles it elsewhere, `escapeStepsBack`); `document`
   * takes it anywhere except from a field or another dialog.
   */
  escape: 'inside' | 'document';
  /**
   * Where the focus goes when the popup closes while it had the focus (the button that opened it); nothing moves when
   * the focus had left it (a click elsewhere took it).
   */
  returnFocus?(): HTMLElement | null;
  /** Positioning: `absolute` inside its offset parent (an overlay over the map) or `fixed` (a page). */
  strategy: 'absolute' | 'fixed';
  className?: string;
  children: ReactNode;
}

/**
 * A non-modal popup (`role="dialog"`, the page or map behind it stays usable) next to what it is about, kept inside its
 * area, or a bottom sheet on phones. It closes on a click or tap anywhere outside it (not on a drag, and not when that
 * click opened something else), on Esc and through the caller (the × of its content); a click inside never closes it.
 * Focus handling (moving in, going back) is the caller's: it knows how the popup was opened.
 */
export function MachinePopup({
  label, anchor, area, subscribe, prefer, sheet, sheetClassName, openKey, onClose, escape, returnFocus, strategy, className = '', children,
}: MachinePopupProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ left: number; top: number; maxHeight: number } | null>(null);
  const latest = useRef({ anchor, area, prefer, openKey, onClose, returnFocus });
  latest.current = { anchor, area, prefer, openKey, onClose, returnFocus };
  // The focus is inside: it goes back when the popup closes. A popup removed with the focus in it gets no focusout
  // with a target, so only a move to an element outside clears it.
  const hadFocus = useRef(false);
  useEffect(() => () => {
    if (!hadFocus.current) return;
    const back = latest.current.returnFocus?.();
    if (back?.isConnected) back.focus({ preventScroll: true });
  }, []);

  // Placement: now (before paint), on every change of what it shows (its size) and whenever the caller says so.
  const placeNow = () => {
    const el = ref.current;
    if (!el || sheet) return;
    const a = latest.current.anchor();
    const box = latest.current.area();
    const parent = strategy === 'absolute' ? (el.offsetParent as HTMLElement | null)?.getBoundingClientRect() : undefined;
    const maxHeight = Math.max(160, box.bottom - box.top - 2 * EDGE);
    const h = Math.min(el.offsetHeight, maxHeight);
    if (!a) return;
    const p = placePopup(a, el.offsetWidth, h, box, latest.current.prefer);
    const next = { left: Math.round(p.left - (parent?.left ?? 0)), top: Math.round(p.top - (parent?.top ?? 0)), maxHeight: Math.floor(maxHeight) };
    setPlace(was => (was && was.left === next.left && was.top === next.top && was.maxHeight === next.maxHeight ? was : next));
  };
  useLayoutEffect(placeNow);
  useEffect(() => {
    if (sheet) return;
    let frame = 0;
    const update = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => { frame = 0; placeNow(); });
    };
    const stop = subscribe(update);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    if (ref.current) observer?.observe(ref.current);
    return () => {
      stop();
      observer?.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [sheet, subscribe]);

  // A click or tap outside closes it: the press and the release outside, without a drag in between, and only when
  // the click did not open something else (the map's click selects another machine before this listener hears it).
  useEffect(() => {
    let down: { x: number; y: number; key: unknown } | null = null;
    const inside = (t: EventTarget | null) => t instanceof Node && !!ref.current?.contains(t);
    const onDown = (e: PointerEvent) => {
      down = inside(e.target) ? null : { x: e.clientX, y: e.clientY, key: latest.current.openKey() };
    };
    const onClick = (e: MouseEvent) => {
      const d = down;
      down = null;
      if (!d || inside(e.target)) return;
      // A keyboard "click" (Enter on a button) has no press: it never closes the popup.
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > CLICK_SLOP_PX) return;
      if (latest.current.openKey() !== d.key) return;
      latest.current.onClose();
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('click', onClick);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('click', onClick);
    };
  }, []);

  // Esc anywhere on the page (`document`): before the page's own handlers, so a panel behind it stays open.
  useEffect(() => {
    if (escape !== 'document') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const t = e.target instanceof Element ? e.target : null;
      const fromInside = !!t && !!ref.current?.contains(t);
      if (!fromInside && t?.closest('input, select, textarea, [contenteditable="true"], dialog, [role="dialog"], [role="alertdialog"]')) return;
      e.preventDefault();
      e.stopPropagation();
      latest.current.onClose();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [escape]);

  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (escape !== 'inside' || e.key !== 'Escape' || e.defaultPrevented) return;
    e.preventDefault();
    e.stopPropagation();
    onClose();
  };

  const style: CSSProperties | undefined = sheet ? undefined
    : place ? { left: place.left, top: place.top, maxHeight: place.maxHeight }
    // Measured before the first paint; until then out of sight, so it never flashes at the corner.
    : { left: 0, top: 0, visibility: 'hidden' };
  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={label}
      data-placement={sheet ? 'sheet' : 'anchored'}
      onKeyDown={onKeyDown}
      onFocus={() => { hadFocus.current = true; }}
      onBlur={e => { if (e.relatedTarget instanceof Node && !e.currentTarget.contains(e.relatedTarget)) hadFocus.current = false; }}
      className={`pointer-events-auto flex flex-col ${strategy} ${sheet ? sheetClassName : ''} ${className}`}
      style={style}
    >
      {children}
    </div>
  );
}
