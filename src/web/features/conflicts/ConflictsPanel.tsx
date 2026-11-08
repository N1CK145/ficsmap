import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { WorldCtx } from '../../app/feature.js';
import { useUiStore } from '../../app/store.js';
import { Button } from '../../components/Button.js';
import { useImportBanner } from '../import/ImportBanner.js';
import { useMarksQuery } from '../marks/useMarks.js';
import { ConflictStepper, reviewPosition, TrustButtons, useConflictReview, useConflicts } from './ConflictStepper.js';

/**
 * Sidebar block, shown only while there are conflicts: "⚠ 3 conflicts · [Review] · [Trust current
 * data] [Trust the save] · ☐ Show only conflicts". While reviewing, the stepper takes the place of
 * the button row.
 */
export function ConflictsPanel({ worldId }: { worldId: string }) {
  const { t } = useTranslation();
  const list = useConflicts(worldId);
  const reviewing = useConflictReview(s => s.isOpen);
  const onlyConflicts = useUiStore(s => s.onlyConflicts);
  const setOnlyConflicts = useUiStore(s => s.setOnlyConflicts);
  if (list.length === 0) return null;
  return (
    <div className="flex flex-col gap-3">
      <p className="font-medium text-conflict">{t('conflicts.summary', { count: list.length })}</p>
      {reviewing ? <ConflictStepper worldId={worldId} /> : (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="primary" onClick={() => useConflictReview.getState().open(list)}>{t('conflicts.review')}</Button>
          <TrustButtons worldId={worldId} actors={list} />
        </div>
      )}
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={onlyConflicts} onChange={e => setOnlyConflicts(e.target.checked)} className="size-4 accent-accent focus-ring" />
        {t('conflicts.onlyShow')}
      </label>
    </div>
  );
}

/**
 * Header item without a face: it lives as long as the world is open, so it can answer the import
 * banner's [Review conflicts] before the panel exists, and it keeps the review consistent with the
 * cache (selects the conflict that moved into the current slot, ends the review and the "only conflicts" filter at
 * zero conflicts).
 */
export function ConflictsHost({ ctx }: { ctx: WorldCtx }) {
  const { t } = useTranslation();
  const { worldId, toast } = ctx;
  const list = useConflicts(worldId);
  const marksQuery = useMarksQuery(worldId);
  // Settled: loaded and not refetching, so an empty list is final (the import may have just changed the marks).
  const marksSettled = marksQuery.data !== undefined && !marksQuery.isFetching;
  const { isOpen, actor, idx, wanted } = useConflictReview();

  // The latest list for the stable review callback below.
  const latest = useRef(list);
  useEffect(() => { latest.current = list; }, [list]);
  useEffect(() => {
    useImportBanner.setState({ onReview: () => {
      if (latest.current.length > 0) useConflictReview.getState().open(latest.current);
      else useConflictReview.getState().want();
    } });
    return () => useImportBanner.setState({ onReview: undefined });
  }, []);

  // "Show only conflicts" with none left would hide every item, and the checkbox goes with the panel:
  // switch the filter off once the last conflict is gone.
  useEffect(() => {
    if (marksSettled && list.length === 0 && useUiStore.getState().onlyConflicts) useUiStore.getState().setOnlyConflicts(false);
  }, [marksSettled, list]);

  useEffect(() => {
    if (!wanted) return;
    if (list.length > 0) useConflictReview.getState().open(list);
    else if (marksSettled) useConflictReview.setState({ wanted: false }); // nothing to review after all
  }, [wanted, list, marksSettled]);

  useEffect(() => {
    if (!isOpen) return;
    if (list.length === 0) {
      useConflictReview.getState().close();
      toast.show({ message: t('conflicts.allResolved') });
      return;
    }
    const pos = reviewPosition(list, actor, idx);
    if (list[pos] !== actor || pos !== idx) useConflictReview.getState().goTo(list, pos);
  }, [isOpen, list, actor, idx, toast, t]);

  useEffect(() => () => useConflictReview.getState().close(), []);
  return null;
}
