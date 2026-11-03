import { useMutation } from '@tanstack/react-query';
import { useId, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../app/api.js';
import type { WorldCtx } from '../../app/feature.js';
import { queryKeys } from '../../app/queryKeys.js';
import { useUiStore } from '../../app/store.js';
import { Button } from '../../components/Button.js';
import { SettingsBlock } from './SettingsPage.js';

/** Delete the world (owner): the button stays disabled until the exact world name is typed. */
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
      <p className="text-sm text-muted">{t('settings.danger.hint')}</p>
      <form onSubmit={submit} className="flex flex-col gap-2">
        <label htmlFor={inputId} className="text-sm">{t('settings.danger.confirmLabel')}</label>
        <div className="flex gap-2">
          <input
            id={inputId}
            value={typed}
            autoComplete="off"
            onChange={e => setTyped(e.target.value)}
            className="h-10 min-w-0 flex-1 rounded border border-line bg-bg px-3 text-fg focus-ring"
          />
          <Button type="submit" variant="danger" disabled={!matches || del.isPending}>{t('settings.danger.delete')}</Button>
        </div>
      </form>
    </SettingsBlock>
  );
}
