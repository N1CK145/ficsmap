import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { create } from 'zustand';
import { useUiStore } from '../../app/store.js';
import { Button } from '../../components/Button.js';
import { ConfirmDialog } from '../../components/ConfirmDialog.js';
import { useDatasetQuery } from '../map/useDataset.js';
import { useMarks } from '../marks/useMarks.js';
import { useMe } from '../worlds/queries.js';
import { conflictActors } from './conflictActors.js';
import { useBulkTrust } from './useBulkTrust.js';

interface ReviewState {
  isOpen: boolean;
  /** The conflict being looked at, and its position when last known (kept when the actor got resolved). */
  actor: string | null;
  idx: number;
  /** Review asked for (import banner) before any conflict was loaded; the host opens it once there is one. */
  wanted: boolean;
  open(list: readonly string[]): void;
  goTo(list: readonly string[], idx: number): void;
  close(): void;
  want(): void;
}

/** State of the review stepper. The list itself is always recomputed from the marks cache. */
export const useConflictReview = create<ReviewState>()((set) => ({
  isOpen: false, actor: null, idx: 0, wanted: false,
  open: list => {
    set({ isOpen: true, wanted: false, actor: list[0] ?? null, idx: 0 });
    useUiStore.getState().select(list[0] ?? null);
  },
  goTo: (list, idx) => {
    const actor = list[idx];
    if (actor === undefined) return;
    set({ actor, idx });
    useUiStore.getState().select(actor);
  },
  close: () => set({ isOpen: false, wanted: false, actor: null, idx: 0 }),
  want: () => set({ wanted: true }),
}));

/** Where the review stands in the current list: the current actor's index, else the old index clamped. */
export function reviewPosition(list: readonly string[], actor: string | null, idx: number): number {
  const found = actor === null ? -1 : list.indexOf(actor);
  return found >= 0 ? found : Math.max(0, Math.min(idx, list.length - 1));
}

/** The conflicts in reading order, from the cache (empty until marks and dataset are loaded). */
export function useConflicts(worldId: string): string[] {
  const index = useDatasetQuery(useMe().data?.datasetVersion).data;
  const marks = useMarks(worldId);
  return useMemo(() => (index && marks ? conflictActors(marks, index) : []), [index, marks]);
}

/** [Trust current data] [Trust the save], each behind its confirmation (spec §10.7), for the current conflicts. */
export function TrustButtons({ worldId, actors, onConfirmed }: { worldId: string; actors: string[]; onConfirmed?: () => void }) {
  const { t } = useTranslation();
  const { busy, trustCurrent, trustSave } = useBulkTrust(worldId);
  const [asking, setAsking] = useState<'current' | 'save' | null>(null);
  const count = actors.length;
  const confirm = () => {
    const which = asking;
    setAsking(null);
    onConfirmed?.();
    void (which === 'current' ? trustCurrent(actors) : trustSave(actors));
  };
  return (
    <>
      <Button size="sm" disabled={busy} onClick={() => setAsking('current')}>{t('conflicts.trustCurrent')}</Button>
      <Button size="sm" disabled={busy} onClick={() => setAsking('save')}>{t('conflicts.trustSave')}</Button>
      <ConfirmDialog
        open={asking !== null}
        message={t(asking === 'save' ? 'conflicts.uncheckTitle' : 'conflicts.keepTitle', { count })}
        confirmLabel={asking === 'save' ? t('conflicts.uncheckConfirm', { count }) : t('conflicts.keepConfirm')}
        danger={asking === 'save'}
        busy={busy}
        onConfirm={confirm}
        onCancel={() => setAsking(null)}
      />
    </>
  );
}

/**
 * "Conflict 1 of 3 [‹ Prev] [Next ›] [Trust current data] [Trust the save] [Done]" (spec §10.7).
 * Each step selects the conflict, so the map pans to it and the item panel opens with
 * [Keep checked] / [Uncheck].
 */
export function ConflictStepper({ worldId }: { worldId: string }) {
  const { t } = useTranslation();
  const list = useConflicts(worldId);
  const { isOpen, actor, idx, goTo, close } = useConflictReview();
  if (!isOpen || list.length === 0) return null;
  const pos = reviewPosition(list, actor, idx);
  return (
    <div role="group" aria-label={t('conflicts.title')} className="flex flex-col gap-2">
      <p className="font-display font-semibold tabular-nums">{t('conflicts.step', { current: pos + 1, total: list.length })}</p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={pos === 0} onClick={() => goTo(list, pos - 1)}>{t('conflicts.prev')}</Button>
        <Button size="sm" disabled={pos >= list.length - 1} onClick={() => goTo(list, pos + 1)}>{t('conflicts.next')}</Button>
        {/* Ending the review here keeps the host from replacing the Undo toast with "All conflicts resolved". */}
        <TrustButtons worldId={worldId} actors={list} onConfirmed={close} />
        <Button size="sm" variant="primary" onClick={close}>{t('conflicts.done')}</Button>
      </div>
    </div>
  );
}
