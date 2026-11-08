import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { create } from 'zustand';
import type { SidebarPanel } from '../../app/feature.js';
import { loadPanelsCollapsed, savePanelsCollapsed } from '../../app/persist.js';
import { ChevronDownIcon } from '../../components/icons.js';
import { SECTION_HEADING, SectionMarker } from '../../components/SectionHeading.js';

/** Which sidebar panels are folded, as the user left them (per device); panels not in it use their default. */
export const usePanelsCollapsed = create<{ collapsed: Record<string, boolean>; set(id: string, collapsed: boolean): void }>()(set => ({
  collapsed: loadPanelsCollapsed(),
  set: (id, collapsed) => set(s => {
    const next = { ...s.collapsed, [id]: collapsed };
    savePanelsCollapsed(next);
    return { collapsed: next };
  }),
}));

/**
 * A sidebar panel (desktop sidebar and mobile sheet) with a heading that folds it. While folded its content
 * stays mounted but hidden, so its state (route editor, conflict stepper) survives.
 */
export function SidebarPanelView({ panel, worldId }: { panel: SidebarPanel; worldId: string }) {
  const { t } = useTranslation();
  const collapsed = usePanelsCollapsed(s => s.collapsed[panel.id] ?? panel.defaultCollapsed ?? false);
  const setCollapsed = usePanelsCollapsed(s => s.set);
  const headingId = useId();
  const bodyId = useId();
  return (
    <section aria-labelledby={headingId} className="border-b border-line">
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
