import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { MemberDto, MemberRole } from '../../../shared/api.js';
import { api } from '../../app/api.js';
import type { WorldCtx } from '../../app/feature.js';
import { queryKeys } from '../../app/queryKeys.js';
import { useUiStore } from '../../app/store.js';
import { Button } from '../../components/Button.js';
import { ConfirmDialog } from '../../components/ConfirmDialog.js';
import { RoleBadge } from '../worlds/RoleBadge.js';
import { SettingsBlock } from './SettingsPage.js';

/** What the confirm dialog asks about. */
type Pending =
  | { kind: 'remove'; member: MemberDto }
  | { kind: 'grant'; member: MemberDto }
  | { kind: 'revoke'; member: MemberDto }
  | { kind: 'leave' }
  | { kind: 'stepDown' };

/**
 * Members (spec §10.8): everyone sees the list with each one's role. The owner can make members admins and take it
 * back, and [Remove] anyone else; an admin can [Remove] plain members and give up their own rights; everyone but the
 * owner gets [Leave world]. Checks stay when someone goes.
 */
export function MembersSection({ ctx }: { ctx: WorldCtx }) {
  const { t, i18n } = useTranslation();
  const { worldId, world, me, queryClient, toast, navigate } = ctx;
  const [pending, setPending] = useState<Pending | null>(null);
  const date = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' });
  const membersPath = `/api/worlds/${encodeURIComponent(worldId)}/members`;

  const drop = useMutation({
    mutationFn: (userId: number) => api('DELETE', `${membersPath}/${userId}`),
    onError: () => toast.show({ message: t('settings.members.failed') }),
  });
  const setRole = useMutation({
    mutationFn: ({ userId, role }: { userId: number; role: MemberRole }) => api('PUT', `${membersPath}/${userId}/role`, { role }),
    onError: () => toast.show({ message: t('settings.members.roleFailed') }),
  });

  async function changeRole(target: Pending): Promise<void> {
    const userId = 'member' in target ? target.member.userId : me.id;
    await setRole.mutateAsync({ userId, role: target.kind === 'grant' ? 'admin' : 'member' });
    // Taking admin rights away revokes that user's upload keys.
    void queryClient.invalidateQueries({ queryKey: queryKeys.world(worldId) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.uploadTokens(worldId) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.worlds() });
    toast.show({
      message: target.kind === 'grant' ? t('settings.members.granted', { name: target.member.displayName })
        : target.kind === 'revoke' ? t('settings.members.revoked', { name: target.member.displayName })
          : t('settings.members.steppedDown'),
    });
  }

  async function confirm() {
    const target = pending;
    if (target === null) return;
    if (target.kind === 'grant' || target.kind === 'revoke' || target.kind === 'stepDown') {
      try {
        await changeRole(target);
      } catch { /* toasted by the mutation */ }
      setPending(null);
      return;
    }
    // The server announces the removal before it answers; the layout must not treat it as "removed by someone".
    if (target.kind === 'leave') useUiStore.getState().setSelfLeaving(worldId);
    try {
      await drop.mutateAsync(target.kind === 'leave' ? me.id : target.member.userId);
    } catch {
      if (target.kind === 'leave') useUiStore.getState().setSelfLeaving(null);
      setPending(null);
      return;
    }
    setPending(null);
    if (target.kind === 'leave') {
      void queryClient.invalidateQueries({ queryKey: queryKeys.worlds() });
      navigate('/?list=1', { replace: true });
      toast.show({ message: t('settings.members.left', { world: world.name }) });
    } else {
      void queryClient.invalidateQueries({ queryKey: queryKeys.world(worldId) });
      toast.show({ message: t('settings.members.removed', { name: target.member.displayName }) });
    }
  }

  /** The owner removes anyone else; an admin only plain members. */
  const canRemove = (m: MemberDto) => m.userId !== me.id && m.role !== 'owner'
    && (world.role === 'owner' || (world.role === 'admin' && m.role === 'member'));

  const name = pending && 'member' in pending ? pending.member.displayName : '';
  const dialog = pending === null ? null : {
    remove: { danger: true, message: t('settings.members.removeConfirm', { name }), label: t('settings.members.remove') },
    leave: { danger: true, message: t('settings.members.leaveConfirm', { world: world.name }), label: t('settings.members.leaveAction') },
    grant: { danger: false, message: t('settings.members.grantConfirm', { name }), label: t('settings.members.grant') },
    revoke: { danger: true, message: t('settings.members.revokeConfirm', { name }), label: t('settings.members.revoke') },
    stepDown: { danger: true, message: t('settings.members.stepDownConfirm'), label: t('settings.members.stepDown') },
  }[pending.kind];

  return (
    <SettingsBlock title={t('settings.members.title')}>
      <ul className="flex flex-col divide-y divide-line">
        {world.members.map(m => (
          <li key={m.userId} aria-label={m.displayName} className="flex min-h-12 flex-wrap items-center gap-x-3 gap-y-2 py-2">
            {m.avatarUrl
              ? <img src={m.avatarUrl} alt="" width={32} height={32} className="size-8 shrink-0 rounded-full" />
              : <span aria-hidden="true" className="size-8 shrink-0 rounded-full bg-line" />}
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-2">
                <span className="truncate font-medium">{m.displayName}</span>
                <RoleBadge role={m.role} />
              </div>
              {m.role !== 'owner' && (
                <div className="text-sm text-muted">{t('settings.members.joinedVia', { date: date.format(m.joinedAt) })}</div>
              )}
            </div>
            {(world.role === 'owner' && m.role !== 'owner') || canRemove(m) ? (
              // Below 640 px the actions get a line of their own under the name, aligned with it.
              <div className="flex flex-wrap gap-2 max-sm:w-full max-sm:pl-11">
                {world.role === 'owner' && m.role === 'member' && (
                  <Button size="sm" aria-label={t('settings.members.grantNamed', { name: m.displayName })} onClick={() => setPending({ kind: 'grant', member: m })}>
                    {t('settings.members.grant')}
                  </Button>
                )}
                {world.role === 'owner' && m.role === 'admin' && (
                  <Button size="sm" aria-label={t('settings.members.revokeNamed', { name: m.displayName })} onClick={() => setPending({ kind: 'revoke', member: m })}>
                    {t('settings.members.revoke')}
                  </Button>
                )}
                {canRemove(m) && (
                  <Button size="sm" aria-label={t('settings.members.removeNamed', { name: m.displayName })} onClick={() => setPending({ kind: 'remove', member: m })}>
                    {t('settings.members.remove')}
                  </Button>
                )}
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      {world.role !== 'owner' && (
        <div className="flex flex-wrap gap-2">
          {world.role === 'admin' && <Button onClick={() => setPending({ kind: 'stepDown' })}>{t('settings.members.stepDown')}</Button>}
          <Button variant="danger" onClick={() => setPending({ kind: 'leave' })}>{t('settings.members.leave')}</Button>
        </div>
      )}
      <ConfirmDialog
        open={dialog !== null}
        danger={dialog?.danger ?? false}
        busy={drop.isPending || setRole.isPending}
        message={dialog?.message ?? null}
        confirmLabel={dialog?.label ?? ''}
        onConfirm={() => void confirm()}
        onCancel={() => setPending(null)}
      />
    </SettingsBlock>
  );
}
