import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { RestoreRow } from '../../../shared/api.js';
import { api } from '../../app/api.js';
import type { WorldCtx } from '../../app/feature.js';
import { shouldIgnoreGlobalKey } from '../../app/keyboard.js';
import { queryKeys } from '../../app/queryKeys.js';
import { useUndoStack, type UndoEntry } from './undo.js';
import { useSetMark, type SetMark, type SetMarkDeps } from './useMarks.js';

/**
 * Reverses one undo entry (spec §10.3) and says "Undone". A single change is set back without
 * going on the stack again; when it was a conflict, the restore endpoint brings back its mismatch
 * flag too, as it does for a bulk change. A failure toasts with Retry.
 */
export async function runUndo(entry: UndoEntry, deps: SetMarkDeps & { setMark: SetMark }): Promise<void> {
  const { worldId, queryClient, toast, t, setMark } = deps;
  let ok: boolean;
  if (entry.kind === 'single' && !entry.prevMismatch) {
    ok = (await setMark(entry.actor, entry.prev, { recordUndo: false })) !== null;
  } else {
    const rows: RestoreRow[] = entry.kind === 'bulk' ? entry.rows : [[entry.actor, entry.prev, 1]];
    try {
      await api<{ rev: number }>('POST', `/api/worlds/${encodeURIComponent(worldId)}/marks/restore`, { rows });
      ok = true;
      void queryClient.invalidateQueries({ queryKey: queryKeys.marks(worldId) });
    } catch {
      ok = false;
      toast.show({ message: t('marks.saveFailed'), action: { label: t('common.retry'), run: () => void runUndo(entry, deps) } });
    }
  }
  if (ok) toast.show({ message: t('marks.undone') });
}

/** Ctrl+Z / Cmd+Z undoes the user's newest own change in this world, except while typing or in a dialog. */
export function useUndoShortcut(ctx: WorldCtx): void {
  const setMark = useSetMark(ctx.worldId);
  const { t } = useTranslation();
  const { worldId, queryClient, toast } = ctx;
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'z' || !(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return;
      if (shouldIgnoreGlobalKey(e)) return;
      const entry = useUndoStack.getState().pop();
      if (!entry) return;
      e.preventDefault();
      void runUndo(entry, { worldId, queryClient, toast, t, setMark });
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [worldId, queryClient, toast, t, setMark]);
}
