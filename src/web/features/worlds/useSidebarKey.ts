import { useEffect } from 'react';
import { shouldIgnoreGlobalKey } from '../../app/keyboard.js';
import { useUiStore } from '../../app/store.js';

/**
 * `[` opens and closes the sidebar (spec §10.12); not while typing or in a dialog. Pass false where
 * there is no sidebar (mobile, settings). Ctrl+Alt counts as AltGr, which types `[` on German keyboards.
 */
export function useSidebarKey(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== '[' || e.repeat || e.metaKey || (e.ctrlKey && !e.altKey) || shouldIgnoreGlobalKey(e)) return;
      e.preventDefault();
      useUiStore.getState().toggleSidebar();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled]);
}
