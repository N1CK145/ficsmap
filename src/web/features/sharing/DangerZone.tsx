import { useMutation } from '@tanstack/react-query';
import { useId, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../app/api.js';
import type { WorldCtx } from '../../app/feature.js';
import { queryKeys } from '../../app/queryKeys.js';
import { useUiStore } from '../../app/store.js';
import { Button } from '../../components/Button.js';
import { ConfirmDialog } from '../../components/ConfirmDialog.js';
import { fieldClass } from '../../components/Field.js';
import { SettingsBlock } from './SettingsPage.js';

/**
 * Hand the world to another member (owner): pick one, confirm, and the server makes them the owner and the caller an
 * admin. Hidden while the owner is alone.
 */
function TransferOwnership({ ctx }: { ctx: WorldCtx }) {
  const { t } = useTranslation();
  const { worldId, world, queryClient, toast } = ctx;
  const [chosen, setChosen] = useState('');
  const [confirming, setConfirming] = useState(false);
  const selectId = useId();
  const candidates = world.members.filter(m => m.role !== 'owner');
  const target = candidates.find(m => String(m.userId) === chosen);

  const transfer = useMutation({
    mutationFn: (userId: number) => api('PUT', `/api/worlds/${encodeURIComponent(worldId)}/owner`, { userId }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.world(worldId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.worlds() });
      toast.show({ message: t('settings.danger.transferred', { name: target?.displayName ?? '', world: world.name }) });
    },
    onError: () => toast.show({ message: t('settings.danger.transferFailed') }),
    onSettled: () => setConfirming(false),
  });

  if (candidates.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-muted">{t('settings.danger.transferHint')}</p>
      <label htmlFor={selectId} className="text-sm">{t('settings.danger.transferLabel')}</label>
      <div className="flex gap-2">
        <select id={selectId} value={chosen} onChange={e => setChosen(e.target.value)} className={fieldClass({}, 'min-w-0 flex-1')}>
          <option value="">{t('settings.danger.transferChoose')}</option>
          {candidates.map(m => <option key={m.userId} value={String(m.userId)}>{m.displayName}</option>)}
        </select>
        <Button variant="danger" disabled={!target} onClick={() => setConfirming(true)}>{t('settings.danger.transfer')}</Button>
      </div>
      <ConfirmDialog
        open={confirming && target !== undefined}
        danger
        busy={transfer.isPending}
        message={t('settings.danger.transferConfirm', { name: target?.displayName ?? '', world: world.name })}
        confirmLabel={t('settings.danger.transferAction')}
        onConfirm={() => { if (target && !transfer.isPending) transfer.mutate(target.userId); }}
        onCancel={() => setConfirming(false)}
      />
    </div>
  );
}

/**
 * Owner-only actions: hand the world over, and delete it (the button stays disabled until the exact world name is
 * typed).
 */
export function DangerZone({ ctx }: { ctx: WorldCtx }) {
  const { t } = useTranslation();
  const { worldId, world, queryClient, toast, navigate } = ctx;
  const [typed, setTyped] = useState('');
  const inputId = useId();

  const del = useMutation({
    mutationFn: () => {
      // The `deleted` event reaches this client before the answer; this path navigates and toasts itself.
      useUiStore.getState().setSelfLeaving(worldId);
      return api('DELETE', `/api/worlds/${encodeURIComponent(worldId)}`);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.worlds() });
      navigate('/?list=1', { replace: true });
      toast.show({ message: t('settings.danger.deleted') });
    },
    onError: () => {
      useUiStore.getState().setSelfLeaving(null);
      toast.show({ message: t('settings.danger.failed') });
    },
  });

  const matches = typed === world.name;
  function submit(e: FormEvent) {
    e.preventDefault();
    if (matches && !del.isPending) del.mutate();
  }

  return (
    <SettingsBlock title={t('settings.danger.title')} danger>
      <TransferOwnership ctx={ctx} />
      <p className="text-sm text-muted">{t('settings.danger.hint')}</p>
      <form onSubmit={submit} className="flex flex-col gap-2">
        <label htmlFor={inputId} className="text-sm">{t('settings.danger.confirmLabel')}</label>
        <div className="flex gap-2">
          <input
            id={inputId}
            value={typed}
            autoComplete="off"
            onChange={e => setTyped(e.target.value)}
            className={fieldClass({}, 'min-w-0 flex-1')}
          />
          <Button type="submit" variant="danger" disabled={!matches || del.isPending}>{t('settings.danger.delete')}</Button>
        </div>
      </form>
    </SettingsBlock>
  );
}
