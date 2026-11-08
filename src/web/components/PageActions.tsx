import { createContext, useContext, type ReactNode } from 'react';
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
