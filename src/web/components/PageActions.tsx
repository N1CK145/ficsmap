import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** Where a world page's header keeps its actions; set by `WorldPageView`. */
export const PageActionsSlot = createContext<HTMLElement | null>(null);

/**
 * Buttons for the page header's right end (export, reset, a view switch), rendered from anywhere inside a world page:
 * `<PageActions><Button size="sm">Reset</Button></PageActions>`. They keep the page's React context; outside a world
 * page (tests rendering a page alone) they render nothing.
 */
export function PageActions({ children }: { children: ReactNode }) {
  const slot = useContext(PageActionsSlot);
  return slot ? createPortal(children, slot) : null;
}

/** Where the page header's back control leads, when a page sets it; else back to the map. */
export interface PageBackTarget { to: string; label: string }

/** Set by `WorldPageView`: lets the page replace the header's back control. */
export const PageBackSlot = createContext<((target: PageBackTarget | null) => void) | null>(null);

/**
 * Makes the page header's back control lead somewhere inside the page instead of to the map, while `target` is set
 * (the machine wiki on a phone: from an entry back to the list), so a page never shows two back controls. It is then
 * shown at every width. Pass null to give the control back to the map. Outside a world page it does nothing.
 */
export function usePageBack(target: PageBackTarget | null): void {
  const set = useContext(PageBackSlot);
  const to = target?.to;
  const label = target?.label;
  useEffect(() => {
    if (!set) return;
    set(to !== undefined && label !== undefined ? { to, label } : null);
    return () => set(null);
  }, [set, to, label]);
}
