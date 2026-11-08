import { useEffect, useId, useRef, useState, type MouseEvent, type PointerEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { FOOTER_PX } from '../../components/Footer.js';
import { nearestSnap, nextSnap, snapHeights, TOAST_OFFSET_PX, type Snap } from './snap.js';

/** The space above the footer, which the sheet sits on; half and full are shares of it (snapHeights). */
const AVAILABLE = `(100dvh - ${FOOTER_PX}px)`;
const CSS_HEIGHT: Record<Snap, string> = { peek: '96px', half: `calc(${AVAILABLE} * 0.5)`, full: `calc(${AVAILABLE} * 0.92)` };
/** Movement below this is a tap on the handle, not a drag. */
const DRAG_SLOP_PX = 4;
/** The release velocity is measured over the last this many ms of the drag. */
const VELOCITY_WINDOW_MS = 100;

interface Sample { t: number; h: number }
interface Drag { pointerId: number; startY: number; startHeight: number; samples: Sample[]; moved: boolean }

export interface BottomSheetProps {
  /** The sheet's accessible name. */
  label: string;
  snap: Snap;
  onSnap(snap: Snap): void;
  /** The content for the current snap; it scrolls inside the sheet. */
  children: ReactNode;
  /** Stays at the bottom of the sheet, under the scrolling content. */
  footer?: ReactNode;
}

/**
 * The mobile bottom sheet (spec §10.11), fixed to the bottom (on top of the footer) with three
 * heights: peek 96 px, half 50 % and full 92 % of the space above the footer. The grab handle is a button: a tap, Enter or Space goes peek → half → full →
 * peek; dragging it (touch-action: none on the handle only) resizes the sheet and the release
 * settles on `nearestSnap`. Size changes animate unless the user prefers reduced motion.
 */
export function BottomSheet({ label, snap, onSnap, children, footer }: BottomSheetProps) {
  const { t } = useTranslation();
  const contentId = useId();
  const [dragHeight, setDragHeight] = useState<number | null>(null);
  const drag = useRef<Drag | null>(null);
  // The click that ends a drag must not also cycle the size.
  const dragEnded = useRef(false);

  // Toasts float above the peek while the sheet is there.
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--ficsmap-toast-offset', `${TOAST_OFFSET_PX}px`);
    return () => { root.style.removeProperty('--ficsmap-toast-offset'); };
  }, []);

  const heights = () => snapHeights(window.innerHeight - FOOTER_PX);
  const heightAt = (d: Drag, clientY: number) => {
    const h = heights();
    return Math.min(h.full, Math.max(h.peek, d.startHeight + d.startY - clientY));
  };

  const onPointerDown = (e: PointerEvent<HTMLButtonElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    dragEnded.current = false;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const startHeight = heights()[snap];
    drag.current = { pointerId: e.pointerId, startY: e.clientY, startHeight, samples: [{ t: performance.now(), h: startHeight }], moved: false };
  };

  const onPointerMove = (e: PointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    if (!d.moved && Math.abs(e.clientY - d.startY) < DRAG_SLOP_PX) return;
    d.moved = true;
    const h = heightAt(d, e.clientY);
    d.samples.push({ t: performance.now(), h });
    if (d.samples.length > 20) d.samples.shift();
    setDragHeight(h);
  };

  const onPointerUp = (e: PointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    drag.current = null;
    if (!d.moved) return;
    const now = performance.now();
    const h = heightAt(d, e.clientY);
    const recent = d.samples.filter(s => s.t >= now - VELOCITY_WINDOW_MS && s.t < now);
    const base = recent[0] ?? d.samples[d.samples.length - 1]!;
    const velocity = (h - base.h) / Math.max(1, now - base.t);
    dragEnded.current = true;
    setDragHeight(null);
    onSnap(nearestSnap(h, velocity, heights()));
  };

  // Also on lostpointercapture, which follows every pointerup (the drag is over by then).
  const onPointerCancel = () => {
    drag.current = null;
    setDragHeight(null);
  };

  const onClick = (e: MouseEvent<HTMLButtonElement>) => {
    // detail 0: Enter or Space, never the end of a drag.
    if (dragEnded.current && e.detail !== 0) {
      dragEnded.current = false;
      return;
    }
    onSnap(nextSnap(snap));
  };

  const dragging = dragHeight !== null;
  return (
    <section
      aria-label={label}
      style={{ height: dragging ? `${dragHeight}px` : CSS_HEIGHT[snap], bottom: FOOTER_PX }}
      className={`fixed inset-x-0 z-[1100] flex flex-col overflow-clip border-t border-line bg-panel shadow-[0_-8px_24px_rgb(0_0_0/0.45)] ${dragging ? '' : 'motion-safe:transition-[height] motion-safe:duration-200'}`}
    >
      <button
        type="button"
        aria-expanded={snap !== 'peek'}
        aria-controls={contentId}
        aria-label={t('mobile.sheet.handle', { size: t(`mobile.sheet.${snap}`) })}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onLostPointerCapture={onPointerCancel}
        onClick={onClick}
        // Inset ring: an outer one would be clipped by the sheet at its top edge.
        className="group flex h-7 w-full shrink-0 cursor-grab touch-none items-center justify-center bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset"
      >
        <span aria-hidden="true" className="h-1 w-12 bg-edge group-active:bg-accent" />
      </button>
      <div id={contentId} className="min-h-0 flex-1 overflow-x-clip overflow-y-auto overscroll-contain">{children}</div>
      {footer && <div className="shrink-0 border-t border-line bg-bg/50 p-2">{footer}</div>}
    </section>
  );
}
