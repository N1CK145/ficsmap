import { useEffect, useId, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { create } from 'zustand';
import type { SidebarPanel } from '../../app/feature.js';
import { loadPanelsCollapsed, savePanelsCollapsed } from '../../app/persist.js';
import { ChevronDownIcon } from '../../components/icons.js';
import { SECTION_HEADING, SectionMarker } from '../../components/SectionHeading.js';
import { prefersReducedMotion } from '../map/motion.js';

interface PanelsCollapsedState {
  /** Which panels are folded, as the user left them (remembered per device). */
  collapsed: Record<string, boolean>;
  set(id: string, collapsed: boolean): void;
  /**
   * A panel that asked for the room (a tool switched on, e.g. the factory plan): while set, it shows unfolded and
   * scrolled into view and the other panels show folded, without touching what is remembered. Not remembered itself.
   */
  solo: string | null;
  /** Bumped by every `setSolo` with a panel, so the panel scrolls into view again. */
  soloSeq: number;
  /** What the user folded or unfolded while `solo` was set: those panels keep that state while it lasts. */
  soloState: Record<string, boolean>;
  /** Gives a panel the room (`solo`), or (null) hands it back: every panel the user did not touch meanwhile returns to its remembered state. */
  setSolo(id: string | null): void;
}

/** Which sidebar panels are folded, as the user left them (per device); panels not in it use their default. */
export const usePanelsCollapsed = create<PanelsCollapsedState>()(set => ({
  collapsed: loadPanelsCollapsed(),
  set: (id, collapsed) => set(s => {
    const next = { ...s.collapsed, [id]: collapsed };
    savePanelsCollapsed(next);
    return { collapsed: next, soloState: s.solo === null ? s.soloState : { ...s.soloState, [id]: collapsed } };
  }),
  solo: null,
  soloSeq: 0,
  soloState: {},
  setSolo: id => set(s => (id === null ? { solo: null, soloState: {} } : { solo: id, soloSeq: s.soloSeq + 1, soloState: {} })),
}));

/** Whether a panel shows folded: as remembered, or while another panel has the room (`solo`), folded unless the user opened it. */
export function panelFolded(s: Pick<PanelsCollapsedState, 'collapsed' | 'solo' | 'soloState'>, panel: Pick<SidebarPanel, 'id' | 'defaultCollapsed'>): boolean {
  if (s.solo !== null) return s.soloState[panel.id] ?? s.solo !== panel.id;
  return s.collapsed[panel.id] ?? panel.defaultCollapsed ?? false;
}

/** Scrolls the nearest scrolling ancestor so `el`'s top is at its top (not the page: the shell never scrolls). */
function scrollToTop(el: HTMLElement): void {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY;
    if ((o === 'auto' || o === 'scroll') && p.scrollHeight > p.clientHeight) {
      const top = p.scrollTop + el.getBoundingClientRect().top - p.getBoundingClientRect().top;
      p.scrollTo({ top, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
      return;
    }
  }
}

/**
 * A sidebar panel (desktop sidebar and mobile sheet) with a heading that folds it. While folded its content
 * stays mounted but hidden, so its state (route editor, conflict stepper) survives. While another panel has the room
 * (`usePanelsCollapsed.solo`) it shows folded; the one with the room scrolls into view.
 */
export function SidebarPanelView({ panel, worldId }: { panel: SidebarPanel; worldId: string }) {
  const { t } = useTranslation();
  const collapsed = usePanelsCollapsed(s => panelFolded(s, panel));
  const setCollapsed = usePanelsCollapsed(s => s.set);
  const soloSeq = usePanelsCollapsed(s => (s.solo === panel.id ? s.soloSeq : 0));
  const headingId = useId();
  const bodyId = useId();
  const ref = useRef<HTMLElement>(null);
  // Given the room: scroll it into view once it has unfolded (not while hidden, e.g. in the closed mobile sheet).
  useEffect(() => {
    if (soloSeq === 0) return;
    const id = requestAnimationFrame(() => {
      const el = ref.current;
      if (el && el.offsetParent !== null) scrollToTop(el);
    });
    return () => cancelAnimationFrame(id);
  }, [soloSeq]);
  return (
    <section ref={ref} aria-labelledby={headingId} className="border-b border-line">
      <h2 id={headingId}>
        <button
          type="button"
          aria-expanded={!collapsed}
          aria-controls={bodyId}
          onClick={() => setCollapsed(panel.id, !collapsed)}
          className={`${SECTION_HEADING} group h-10 w-full justify-between px-3 transition-colors hover:bg-raised hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset`}
        >
          <span className="flex min-w-0 items-center gap-2">
            <SectionMarker muted={collapsed} />
            <span className="truncate">{t(panel.titleKey)}</span>
          </span>
          <ChevronDownIcon size={14} className={`motion-safe:transition-transform ${collapsed ? '-rotate-90' : ''}`} />
        </button>
      </h2>
      <div id={bodyId} hidden={collapsed} className="px-3 pt-1 pb-3"><panel.Component worldId={worldId} /></div>
    </section>
  );
}
