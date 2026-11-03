import { useEffect } from 'react';
import { useUiStore } from '../../app/store.js';
import { shouldIgnoreGlobalKey } from '../../app/keyboard.js';

/** Q turns Quick Check on and off, Esc leaves it (spec §10.3, §10.12); not while typing or in a dialog. Mounted once per world. */
export function useQuickCheckKeys() {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || shouldIgnoreGlobalKey(e)) return;
      const { interactionMode, setMode } = useUiStore.getState();
      if (e.key === 'q' || e.key === 'Q') {
        if (e.repeat) return;
        e.preventDefault();
        setMode('quick');
      } else if (e.key === 'Escape' && interactionMode === 'quick') {
        // Handled here, so the item panel's Esc does not close the panel in the same press.
        e.preventDefault();
        setMode('inspect');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
