import { useCallback, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject } from 'react';
import { loadSidebarWidth, saveSidebarWidth } from '../../app/persist.js';

/** Width limits in CSS px. "Fit" measures the panels' natural width and keeps it within FIT. */
export const SIDEBAR = { min: 240, max: 720, maxViewport: 0.6, fitMin: 300, fitMax: 520, fallback: 300, keyStep: 16 } as const;

/** Keeps a dragged width between the minimum and the smaller of the maximum and 60 % of the window. */
export function clampSidebarWidth(width: number, viewport: number): number {
  const max = Math.max(SIDEBAR.min, Math.min(SIDEBAR.max, viewport * SIDEBAR.maxViewport));
  return Math.round(Math.min(max, Math.max(SIDEBAR.min, width)));
}

export interface SidebarWidth {
  /** The current width, or the fallback until the content is measured. */
  width: number;
  /** True while the width follows the content (nothing dragged, or reset by double-click). */
  fit: boolean;
  dragging: boolean;
  scrollRef: RefObject<HTMLDivElement | null>;
  contentRef: RefObject<HTMLDivElement | null>;
  handleProps: {
    onPointerDown(e: PointerEvent<HTMLElement>): void;
    onPointerMove(e: PointerEvent<HTMLElement>): void;
    onPointerUp(e: PointerEvent<HTMLElement>): void;
    onPointerCancel(e: PointerEvent<HTMLElement>): void;
    onDoubleClick(): void;
    onKeyDown(e: KeyboardEvent<HTMLElement>): void;
  };
  bounds: { min: number; max: number };
}

/**
 * The desktop sidebar's width. At first (and after a double-click on the handle) it fits the panels'
 * content; dragging the handle or the arrow keys set a fixed width, remembered on this device.
 */
export function useSidebarWidth(): SidebarWidth {
  const [stored, setStored] = useState<number | null>(() => loadSidebarWidth());
  const [fitWidth, setFitWidth] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{ startX: number; startWidth: number; pointerId: number } | null>(null);

  // While fitting, the content is laid out at max-content (within FIT); its width plus the scrollbar
  // gutter is the sidebar width. Re-measured whenever the content's size changes.
  useLayoutEffect(() => {
    if (stored !== null) return;
    const scroll = scrollRef.current;
    const content = contentRef.current;
    if (!scroll || !content) return;
    const measure = () => {
      const gutter = scroll.offsetWidth - scroll.clientWidth;
      setFitWidth(Math.ceil(content.offsetWidth + gutter));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    return () => observer.disconnect();
  }, [stored]);

  const viewport = typeof window === 'undefined' ? SIDEBAR.max / SIDEBAR.maxViewport : window.innerWidth;
  const width = stored !== null ? clampSidebarWidth(stored, viewport) : fitWidth ?? SIDEBAR.fallback;
  const widthRef = useRef(width);
  widthRef.current = width;

  const commit = useCallback((w: number | null) => {
    const next = w === null ? null : clampSidebarWidth(w, window.innerWidth);
    setStored(next);
    saveSidebarWidth(next);
  }, []);

  const handleProps: SidebarWidth['handleProps'] = {
    onPointerDown(e) {
      if (e.button !== 0) return;
      e.preventDefault();
      e.currentTarget.setPointerCapture?.(e.pointerId);
      drag.current = { startX: e.clientX, startWidth: widthRef.current, pointerId: e.pointerId };
      setDragging(true);
    },
    onPointerMove(e) {
      const d = drag.current;
      if (!d || d.pointerId !== e.pointerId) return;
      setStored(clampSidebarWidth(d.startWidth + e.clientX - d.startX, window.innerWidth));
    },
    onPointerUp(e) {
      const d = drag.current;
      if (!d || d.pointerId !== e.pointerId) return;
      drag.current = null;
      setDragging(false);
      // A click without movement leaves the width as it was (and keeps fitting).
      if (e.clientX !== d.startX) commit(d.startWidth + e.clientX - d.startX);
      else setStored(loadSidebarWidth());
    },
    onPointerCancel() {
      drag.current = null;
      setDragging(false);
      setStored(loadSidebarWidth());
    },
    onDoubleClick() {
      commit(null);
    },
    onKeyDown(e) {
      const step = e.shiftKey ? SIDEBAR.keyStep * 4 : SIDEBAR.keyStep;
      if (e.key === 'ArrowLeft') commit(widthRef.current - step);
      else if (e.key === 'ArrowRight') commit(widthRef.current + step);
      else if (e.key === 'Home') commit(SIDEBAR.min);
      else if (e.key === 'End') commit(SIDEBAR.max);
      else if (e.key === 'Enter') commit(null);
      else return;
      e.preventDefault();
    },
  };

  return {
    width, fit: stored === null, dragging, scrollRef, contentRef, handleProps,
    bounds: { min: SIDEBAR.min, max: clampSidebarWidth(SIDEBAR.max, viewport) },
  };
}
