import { useTranslation } from 'react-i18next';
import type { Item } from '../../../shared/dataset.js';
import type { WorldCtx } from '../../app/feature.js';
import { formatRelative } from '../../app/format.js';
import { useIsMobile } from '../../app/useMediaQuery.js';
import { Button } from '../../components/Button.js';
import { hasMismatch, isCollected, useMarks, useSetMark } from './useMarks.js';

/**
 * The item panel's mark controls (spec §10.2): for a conflict "Save says this is still there." with
 * [Keep checked] / [Uncheck] (either write clears the mismatch), otherwise the primary
 * [✓ Check] / [Uncheck] (56 px tall on mobile, spec §10.11); then who changed a checked item last.
 */
export function CheckAction({ item, ctx }: { item: Item; ctx: WorldCtx }) {
  const { t, i18n } = useTranslation();
  const marks = useMarks(ctx.worldId);
  const setMark = useSetMark(ctx.worldId);
  const mobile = useIsMobile();
  const size = mobile ? 'lg' : 'md';
  if (!marks) return null;
  const collected = isCollected(marks, item.name);
  const conflict = collected && hasMismatch(marks, item.name);
  const mark = marks.pending.has(item.name) ? undefined : marks.marks.get(item.name);
  const by = mark && (ctx.world.members.find(m => m.userId === mark.updatedBy)?.displayName ?? t('item.someone'));

  return (
    <div className="flex flex-col gap-2">
      {conflict ? (
        <div className="flex flex-col gap-2 chamfer border border-conflict p-2">
          <p><span aria-hidden="true" className="text-conflict">⚠ </span>{t('item.conflict')}</p>
          <div className="flex gap-2">
            <Button size={mobile ? 'lg' : 'sm'} className={mobile ? 'flex-1' : ''} onClick={() => void setMark(item.name, true)}>{t('item.keepChecked')}</Button>
            <Button size={mobile ? 'lg' : 'sm'} className={mobile ? 'flex-1' : ''} onClick={() => void setMark(item.name, false)}>{t('item.uncheck')}</Button>
          </div>
        </div>
      ) : collected ? (
        <Button size={size} className="w-full" onClick={() => void setMark(item.name, false)}>{t('item.uncheck')}</Button>
      ) : (
        <Button variant="primary" size={size} className="w-full" onClick={() => void setMark(item.name, true)}>
          <span aria-hidden="true">✓</span>{t('item.check')}
        </Button>
      )}
      {by && mark && (
        <p className="text-sm text-muted">{t('item.lastChanged', { name: by, when: formatRelative(mark.updatedAt, Date.now(), i18n.language) })}</p>
      )}
    </div>
  );
}
