import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { MemberDto } from '../../../shared/api.js';
import { api } from '../../app/api.js';
import type { WorldCtx } from '../../app/feature.js';
import { queryKeys } from '../../app/queryKeys.js';
import { useUiStore } from '../../app/store.js';
import { Button } from '../../components/Button.js';
import { ConfirmDialog } from '../../components/ConfirmDialog.js';
import { SettingsBlock } from './SettingsPage.js';

/**
 * Members (spec §10.8): everyone sees the list; the owner can [Remove] others (their checks stay),
 * a member gets [Leave world].
 */
export function MembersSection({ ctx }: { ctx: WorldCtx }) {
  const { t, i18n } = useTranslation();
  const { worldId, world, me, queryClient, toast, navigate } = ctx;
  // A member to remove, or 'leave'.
  const [pending, setPending] = useState<MemberDto | 'leave' | null>(null);
  const date = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' });

  const drop = useMutation({
    mutationFn: (userId: number) => api('DELETE', `/api/worlds/${encodeURIComponent(worldId)}/members/${userId}`),
    onError: () => toast.show({ message: t('settings.members.failed') }),
  });

  async function confirm() {
    const target = pending;
    if (target === null) return;
    // The server announces the removal before it answers; the layout must not treat it as "removed by someone".
    if (target === 'leave') useUiStore.getState().setSelfLeaving(worldId);
    try {
      await drop.mutateAsync(target === 'leave' ? me.id : target.userId);
    } catch {
      if (target === 'leave') useUiStore.getState().setSelfLeaving(null);
      setPending(null);
      return;
    }
    setPending(null);
    if (target === 'leave') {
      void queryClient.invalidateQueries({ queryKey: queryKeys.worlds() });
      navigate('/?list=1', { replace: true });
      toast.show({ message: t('settings.members.left', { world: world.name }) });
    } else {
      void queryClient.invalidateQueries({ queryKey: queryKeys.world(worldId) });
      toast.show({ message: t('settings.members.removed', { name: target.displayName }) });
    }
  }

  return (
    <SettingsBlock title={t('settings.members.title')}>
      <ul className="flex flex-col divide-y divide-line">
        {world.members.map(m => {
          const isOwner = m.userId === world.owner.id;
          return (
            <li key={m.userId} aria-label={m.displayName} className="flex min-h-12 items-center gap-3 py-2">
              {m.avatarUrl
                ? <img src={m.avatarUrl} alt="" width={32} height={32} className="size-8 shrink-0 rounded-full" />
                : <span aria-hidden="true" className="size-8 shrink-0 rounded-full bg-line" />}
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{m.displayName}</div>
                <div className="text-sm text-muted">
                  {isOwner ? t('settings.members.owner') : t('settings.members.joinedVia', { date: date.format(m.joinedAt) })}
                </div>
              </div>
              {world.isOwner && !isOwner && (
                <Button size="sm" aria-label={t('settings.members.removeNamed', { name: m.displayName })} onClick={() => setPending(m)}>
                  {t('settings.members.remove')}
                </Button>
              )}
            </li>
          );
        })}
      </ul>
      {!world.isOwner && (
        <div><Button variant="danger" onClick={() => setPending('leave')}>{t('settings.members.leave')}</Button></div>
      )}
      <ConfirmDialog
        open={pending !== null}
        danger
        busy={drop.isPending}
        message={pending === 'leave' ? t('settings.members.leaveConfirm', { world: world.name }) : pending ? t('settings.members.removeConfirm', { name: pending.displayName }) : null}
        confirmLabel={pending === 'leave' ? t('settings.members.leaveAction') : t('settings.members.remove')}
        onConfirm={() => void confirm()}
        onCancel={() => setPending(null)}
      />
    </SettingsBlock>
  );
}
