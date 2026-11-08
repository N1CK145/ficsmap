import { createContext, useContext, useEffect } from 'react';

/** Where the back control above a world page leads, while the page sets one. */
export interface PageBackTarget { to: string; label: string }

/** Set by `WorldPageView`: lets the page show a back control above itself. */
export const PageBackSlot = createContext<((target: PageBackTarget | null) => void) | null>(null);

/**
 * Shows a back control above the world page that leads somewhere inside the page, while `target` is set (the machine
 * wiki on a phone: from an entry back to the list). Pass null to remove it again. Outside a world page it does nothing.
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
