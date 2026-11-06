import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { loadPodChecklistCollapsed, savePodChecklistCollapsed } from '../../app/persist.js';
import type { WorldCtx } from '../../app/feature.js';
import { useUiStore } from '../../app/store.js';
import { useIsMobile } from '../../app/useMediaQuery.js';
import { IconButton } from '../../components/IconButton.js';
import { openCount, PodChecklistBody, usePodTicks, useRoutePodNeeds } from './PodChecklist.js';
import type { PodNeeds } from './podNeeds.js';

/** px; the overlay sits above the map attribution, the item panel 8 px from the top and right, 340 px wide. */
const BOTTOM = 24;
const GAP = 8;
const ITEM_PANEL_RIGHT = 8;
const ITEM_PANEL_WIDTH = 340;
/** Below this much free height under the item panel the list collapses to its header. */
export const MIN_OPEN = 140;
/** The collapsed header's height, about. */
export const HEADER_H = 40;

export interface OverlayFit {
  /** The list has room to open (if not collapsed by hand). */
  fits: boolean;
  /** The most height the overlay may take. */
  maxHeight: number;
  /** Even the collapsed header would sit under the item panel: it moves to the panel's left. */
  beside: boolean;
}

/**
 * Where the bottom-right overlay fits on a map `height` px tall when the item panel ends at
 * `panelBottom` (null: no item panel). It takes the room under the panel and collapses when that
 * is too little; null height (not laid out, e.g. in tests) puts no limit on it.
 */
export function fitOverlay(height: number | null, panelBottom: number | null): OverlayFit {
  if (height === null || height <= 0) return { fits: true, maxHeight: Infinity, beside: false };
  const free = height - BOTTOM - (panelBottom === null ? GAP : panelBottom + GAP);
  return { fits: free >= MIN_OPEN, maxHeight: Math.max(free, HEADER_H), beside: free < HEADER_H };
}

/** Measures the free room under the item panel, again whenever the map, the panel or the selection changes. */
function useFit(ref: RefObject<HTMLElement | null>): OverlayFit {
  const selected = useUiStore(s => s.selectedActor);
  const [measured, setMeasured] = useState<{ height: number; panelBottom: number | null } | null>(null);
  useLayoutEffect(() => {
    const container = ref.current?.parentElement;
    if (!container) return;
    // The item panel floats over the same area as the map overlay (WorldShell's map section).
    const panel = container.closest('section')?.querySelector<HTMLElement>('.ficsmap-item-panel') ?? null;
    const measure = () => {
      const box = container.getBoundingClientRect();
      const p = panel?.getBoundingClientRect();
      setMeasured(box.height > 0 ? { height: box.height, panelBottom: p ? p.bottom - box.top : null } : null);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    if (panel) observer.observe(panel);
    return () => observer.disconnect();
  }, [ref, selected]);
  return fitOverlay(measured?.height ?? null, measured?.panelBottom ?? null);
}

/**
 * "Bring with you" over the bottom right of the map while a route with open pods is open, like the
 * game's to-do list (spec §10.6; desktop only, on mobile the route editor shows the list). It takes
 * the room under the item panel and collapses to its header when there is too little; the header
 * collapses and opens it by hand too, remembered per device.
 */
export function PodChecklistOverlay({ ctx }: { ctx: WorldCtx }) {
  const mobile = useIsMobile();
  if (mobile) return null;
  return <Overlay worldId={ctx.worldId} />;
}

function Overlay({ worldId }: { worldId: string }) {
  const needs = useRoutePodNeeds(worldId);
  return needs ? <OverlayBox worldId={worldId} needs={needs} /> : null;
}

function OverlayBox({ worldId, needs }: { worldId: string; needs: PodNeeds }) {
  const { t } = useTranslation();
  const { ticks, toggle } = usePodTicks(worldId);
  const [byHand, setByHand] = useState(loadPodChecklistCollapsed);
  const ref = useRef<HTMLElement>(null);
  const fit = useFit(ref);
  const collapsed = byHand || !fit.fits;
  const open = openCount(needs, ticks);
  const toggleCollapsed = () => {
    setByHand(!byHand);
    savePodChecklistCollapsed(!byHand);
  };
  return (
    <aside
      ref={ref}
      aria-label={t('routes.podNeeds.title')}
      style={{ bottom: BOTTOM, right: fit.beside ? ITEM_PANEL_RIGHT + ITEM_PANEL_WIDTH + GAP : ITEM_PANEL_RIGHT, maxHeight: collapsed ? undefined : fit.maxHeight }}
      className="ficsmap-pod-checklist pointer-events-auto absolute flex w-[300px] flex-col rounded border border-line bg-panel/95 shadow-lg"
    >
      <header className="flex items-center gap-2 py-1 pr-1 pl-3">
        <h2 className="min-w-0 flex-1 truncate font-display text-sm font-semibold tracking-wider uppercase">
          {t('routes.podNeeds.title')}
          {open > 0 && <span className="font-sans font-normal tracking-normal text-muted normal-case"> · {t('routes.podNeeds.open', { count: open })}</span>}
        </h2>
        <IconButton
          aria-label={t(collapsed ? 'routes.podNeeds.expand' : 'routes.podNeeds.collapse')}
          title={t(collapsed ? 'routes.podNeeds.expand' : 'routes.podNeeds.collapse')}
          aria-expanded={!collapsed}
          disabled={!fit.fits}
          size="sm"
          onClick={toggleCollapsed}
        >
          <span aria-hidden="true">{collapsed ? '▴' : '▾'}</span>
        </IconButton>
      </header>
      {!collapsed && (
        <div className="min-h-0 overflow-y-auto overscroll-contain border-t border-line p-3">
          <PodChecklistBody needs={needs} ticks={ticks} onToggle={toggle} />
        </div>
      )}
    </aside>
  );
}
