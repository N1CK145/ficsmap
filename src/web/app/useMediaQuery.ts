import { useCallback, useSyncExternalStore } from 'react';

/** Below this width the world view uses the mobile layout (spec §10.11). */
export const MOBILE_QUERY = '(max-width: 899px)';

function list(query: string): MediaQueryList | null {
  return typeof window.matchMedia === 'function' ? window.matchMedia(query) : null;
}

/** Whether `query` matches now; re-renders when that changes. False where matchMedia is missing. */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback((onChange: () => void) => {
    const mql = list(query);
    mql?.addEventListener('change', onChange);
    return () => mql?.removeEventListener('change', onChange);
  }, [query]);
  return useSyncExternalStore(subscribe, () => list(query)?.matches ?? false, () => false);
}

/** The phone layout: narrower than 900 px. */
export function useIsMobile(): boolean {
  return useMediaQuery(MOBILE_QUERY);
}
