import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { MarksDto, MeDto } from '../../../shared/api.js';
import { api } from '../../app/api.js';
import { queryKeys } from '../../app/queryKeys.js';
import { useToast, type ToastApi } from '../../components/Toast.js';
import { mergeSnapshot, putMark } from '../live/applyEvents.js';
import { useUndoStack, type UndoEntry } from './undo.js';

/** A checked actor. Unchecked actors have no entry. */
export interface MarkState { mismatch: boolean; updatedBy: number | null; updatedAt: number }
export interface MarksCache {
  /** Stream watermark: the highest SSE (or snapshot) rev seen. Own PUT answers do not move it. */
  rev: number;
  /** Rev of the last snapshot (`GET /marks`); `marks` entries without an own rev are that old. */
  baseRev: number;
  /** The server's values as far as known (see live/applyEvents.ts). */
  marks: Map<string, MarkState>;
  /** Rev of the newest write per actor learnt after the snapshot, deletions included. */
  revs: Map<string, number>;
  /** Writes not yet confirmed by the server: actor → the collected value sent. */
  pending: Map<string, boolean>;
}

/** Whether the user sees the actor as collected: a pending write overrides the stored mark. */
export function isCollected(c: MarksCache, actor: string): boolean {
  return c.pending.get(actor) ?? c.marks.has(actor);
}

/** Whether the last import still saw this checked actor. A pending write clears that on the server, so it does not count meanwhile. */
export function hasMismatch(c: MarksCache, actor: string): boolean {
  return !c.pending.has(actor) && (c.marks.get(actor)?.mismatch ?? false);
}

export function useMarksQuery(worldId: string) {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: queryKeys.marks(worldId),
    queryFn: async () => {
      const dto = await api<MarksDto>('GET', `/api/worlds/${encodeURIComponent(worldId)}/marks`);
      // Read after the answer: events and writes that arrived meanwhile are newer than the snapshot.
      return mergeSnapshot(queryClient.getQueryData<MarksCache>(queryKeys.marks(worldId)), dto);
    },
  });
}

export function useMarks(worldId: string): MarksCache | undefined {
  return useMarksQuery(worldId).data;
}

/** Latest write per world and actor, so an older answer does not end a newer optimistic write. */
const latestWrite = new Map<string, number>();
let writeSeq = 0;

/**
 * Resolves to the change's undo entry (the object pushed on the undo stack, when recorded) if the
 * server took it and it is still the actor's latest write; null if it failed or a newer write for
 * the actor came in meanwhile (its feedback belongs to that one).
 */
export type SetMark = (actor: string, collected: boolean, opts?: { recordUndo?: boolean }) => Promise<UndoEntry | null>;
export interface SetMarkDeps { worldId: string; queryClient: QueryClient; toast: ToastApi; t: TFunction }

/**
 * Sets one mark optimistically (spec §10.5). The pending value shows at once; the server's answer
 * is stored with its rev, and the latest write for the actor ends the pending state. On failure the
 * pending value goes away (the last known server value shows again) and a toast offers Retry.
 * With `recordUndo` (default) a confirmed change goes on the undo stack, also when a newer write
 * followed (the server did make it). Outside components (map modes) use this; components use `useSetMark`.
 */
export function createSetMark({ worldId, queryClient, toast, t }: SetMarkDeps): SetMark {
  return async function setMark(actor, collected, opts = {}) {
    const key = queryKeys.marks(worldId);
    const update = (fn: (c: MarksCache) => MarksCache) =>
      queryClient.setQueryData<MarksCache>(key, c => (c ? fn(c) : c));
    const before = queryClient.getQueryData<MarksCache>(key);
    const undo: UndoEntry = {
      kind: 'single', actor, prev: before ? isCollected(before, actor) : false, prevMismatch: before?.marks.get(actor)?.mismatch ?? false,
    };
    const slot = `${worldId}/${actor}`;
    const token = ++writeSeq;
    latestWrite.set(slot, token);
    update(c => ({ ...c, pending: new Map(c.pending).set(actor, collected) }));

    const settle = (fn: (c: MarksCache) => MarksCache): boolean => {
      const isLatest = latestWrite.get(slot) === token;
      if (isLatest) latestWrite.delete(slot);
      update(c => {
        const next = fn(c);
        if (!isLatest) return next;
        const pending = new Map(next.pending);
        pending.delete(actor);
        return { ...next, pending };
      });
      return isLatest;
    };

    try {
      const { rev } = await api<{ rev: number }>('PUT', `/api/worlds/${encodeURIComponent(worldId)}/marks/${encodeURIComponent(actor)}`, { collected });
      const meId = queryClient.getQueryData<MeDto>(queryKeys.me())?.id ?? null;
      // Also an older answer goes through putMark: it cannot win against a newer rev for the actor.
      const isLatest = settle(c => putMark(c, actor, collected ? { mismatch: false, updatedBy: meId, updatedAt: Date.now() } : null, rev));
      if (opts.recordUndo ?? true) useUndoStack.getState().push(undo);
      return isLatest ? undo : null;
    } catch {
      settle(c => c);
      toast.show({ message: t('marks.saveFailed'), action: { label: t('common.retry'), run: () => void setMark(actor, collected, opts) } });
      return null;
    }
  };
}

/** `createSetMark` for components. */
export function useSetMark(worldId: string): SetMark {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { t } = useTranslation();
  return useMemo(() => createSetMark({ worldId, queryClient, toast, t }), [queryClient, toast, t, worldId]);
}
