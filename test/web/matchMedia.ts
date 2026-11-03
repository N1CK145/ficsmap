/**
 * A controllable `window.matchMedia` for jsdom (which has none): `set(query, matches)` flips a query
 * and fires `change` on every list made for it, as a browser does when the viewport crosses it.
 */
export function stubMatchMedia(initial: Record<string, boolean> = {}) {
  const state = new Map(Object.entries(initial));
  const lists = new Map<string, Set<(e: MediaQueryListEvent) => void>>();
  vi.stubGlobal('matchMedia', (query: string): MediaQueryList => {
    const listeners = lists.get(query) ?? new Set();
    lists.set(query, listeners);
    return {
      media: query,
      get matches() { return state.get(query) ?? false; },
      onchange: null,
      addEventListener: (_type: string, fn: (e: MediaQueryListEvent) => void) => { listeners.add(fn); },
      removeEventListener: (_type: string, fn: (e: MediaQueryListEvent) => void) => { listeners.delete(fn); },
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => true,
    } as unknown as MediaQueryList;
  });
  return {
    set(query: string, matches: boolean) {
      state.set(query, matches);
      for (const fn of lists.get(query) ?? []) fn({ matches, media: query } as MediaQueryListEvent);
    },
  };
}

export const MOBILE = '(max-width: 899px)';
export const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';
