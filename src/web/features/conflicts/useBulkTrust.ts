import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { RestoreRow } from '../../../shared/api.js';
import { api } from '../../app/api.js';
import { queryKeys } from '../../app/queryKeys.js';
import { useToast } from '../../components/Toast.js';
import { useUndoStack, type UndoEntry } from '../marks/undo.js';
import { useSetMark } from '../marks/useMarks.js';
import { runUndo } from '../marks/useUndoShortcut.js';

export interface BulkTrust {
  /** A bulk call is in flight; the trust buttons stay disabled meanwhile. */
  busy: boolean;
  /** "Trust current data": keeps the conflicting items checked and clears the warnings. */
  trustCurrent(actors: string[]): Promise<void>;
  /** "Trust the save": unchecks the conflicting items. */
  trustSave(actors: string[]): Promise<void>;
}

/**
 * Bulk conflict resolution (spec §7). `onlyIfMismatch` makes the server touch only rows that are
 * still flagged. Changed rows go on the undo stack as one entry; the toast's Undo restores exactly
 * that entry (with the mismatch flags) through the shared undo runner.
 */
export function useBulkTrust(worldId: string): BulkTrust {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { t } = useTranslation();
  const setMark = useSetMark(worldId);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);

  const run = useCallback(async (actors: string[], collected: boolean): Promise<void> => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    let previous: RestoreRow[];
    try {
      ({ previous } = await api<{ rev: number; previous: RestoreRow[] }>(
        'POST', `/api/worlds/${encodeURIComponent(worldId)}/marks/bulk`, { actors, collected, onlyIfMismatch: true },
      ));
    } catch {
      toast.show({ message: t('marks.saveFailed'), action: { label: t('common.retry'), run: () => void run(actors, collected) } });
      return;
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
    if (previous.length > 0) void queryClient.invalidateQueries({ queryKey: queryKeys.marks(worldId) });
    if (previous.length === 0) return;
    const entry: UndoEntry = { kind: 'bulk', rows: previous };
    useUndoStack.getState().push(entry);
    toast.show({
      message: t(collected ? 'conflicts.toastKept' : 'conflicts.toastUnchecked', { count: previous.length }),
      action: {
        label: t('marks.undo'),
        run: () => {
          if (useUndoStack.getState().remove(entry)) void runUndo(entry, { worldId, queryClient, toast, t, setMark });
        },
      },
    });
  }, [worldId, queryClient, toast, t, setMark]);

  return {
    busy,
    trustCurrent: useCallback(actors => run(actors, true), [run]),
    trustSave: useCallback(actors => run(actors, false), [run]),
  };
}
