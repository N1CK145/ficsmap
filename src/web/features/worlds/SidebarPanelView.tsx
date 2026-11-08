import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { create } from 'zustand';
import type { SidebarPanel } from '../../app/feature.js';
import { loadPanelsCollapsed, savePanelsCollapsed } from '../../app/persist.js';

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
    <section aria-labelledby={headingId} className="border-b border-line p-3">
      <h2 id={headingId} className={collapsed ? '' : 'mb-2'}>
        <button
          type="button"
          aria-expanded={!collapsed}
          aria-controls={bodyId}
          onClick={() => setCollapsed(panel.id, !collapsed)}
          className="flex w-full items-center justify-between gap-2 rounded font-display text-sm font-semibold tracking-wider text-muted uppercase hover:text-fg focus-ring"
        >
          {t(panel.titleKey)}
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false" className={`shrink-0 motion-safe:transition-transform ${collapsed ? '-rotate-90' : ''}`}>
            <path d="M3.5 6l4.5 4.5L12.5 6" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </h2>
      <div id={bodyId} hidden={collapsed}><panel.Component worldId={worldId} /></div>
    </section>
  );
}
