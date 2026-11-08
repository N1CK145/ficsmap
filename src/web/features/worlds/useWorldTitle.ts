import { useEffect } from 'react';

/** The browser tab's title outside a world (as in index.html). */
export const APP_TITLE = 'ficsmap';

/**
 * The browser tab names the world's section and the world ("Planner · Alpha · ficsmap"), so tabs and the history tell
 * them apart; once the world is left it says "ficsmap" again.
 */
export function useWorldTitle(section: string, world: string): void {
  useEffect(() => {
    document.title = `${section} · ${world} · ${APP_TITLE}`;
  }, [section, world]);
  useEffect(() => () => { document.title = APP_TITLE; }, []);
}
