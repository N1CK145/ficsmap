import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../app/api.js';
import type { WorldCtx } from '../../app/feature.js';
import { queryKeys } from '../../app/queryKeys.js';
import { Button } from '../../components/Button.js';
import { ConfirmDialog } from '../../components/ConfirmDialog.js';
import { ReadonlyCopyField } from '../../components/ReadonlyCopyField.js';
import { SettingsBlock } from './SettingsPage.js';

/**
 * Invite (spec §8, §10.8). The one-time link is fetched when the section opens and never cached; after
 * each copy a fresh link replaces it for the next person. [Revoke all open links] bumps the epoch.
 */
export function InviteSection({ ctx }: { ctx: WorldCtx }) {
  const { t, i18n } = useTranslation();
  const { worldId, toast } = ctx;
  const [confirming, setConfirming] = useState(false);
  // Keys the field so a revoke also resets its "Copied" label.
  const [revokes, setRevokes] = useState(0);

  const link = useQuery({
    queryKey: queryKeys.inviteLink(worldId),
    queryFn: () => api<{ url: string; expiresAt: number }>('GET', `/api/worlds/${encodeURIComponent(worldId)}/invite-link`),
    // Tokens are single-use secrets: never serve one from cache or reuse it after a refocus.
    staleTime: 0, gcTime: 0, refetchOnWindowFocus: false, retry: false,
  });

  const revoke = useMutation({
    mutationFn: () => api('POST', `/api/worlds/${encodeURIComponent(worldId)}/invite-links/revoke`, {}),
    onSuccess: async () => {
      setConfirming(false);
      setRevokes(n => n + 1);
      await link.refetch();
      toast.show({ message: t('settings.invite.revoked') });
    },
    onError: () => {
      setConfirming(false);
      toast.show({ message: t('settings.invite.revokeFailed') });
    },
  });

  // While a link is on its way, and when the refresh failed, the field is empty: the copied link is never offered again.
  const current = link.isFetching || link.isError ? undefined : link.data;
  const expires = current && new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }).format(current.expiresAt);

  return (
    <SettingsBlock title={t('settings.invite.title')}>
      <ReadonlyCopyField
        key={revokes}
        label={t('settings.invite.linkLabel')}
        value={current?.url}
        copyLabel={t('settings.invite.copy')}
        copiedLabel={t('settings.invite.copied')}
        onCopied={() => void link.refetch()}
        hint={expires ? t('settings.invite.valid', { date: expires }) : undefined}
      />
      {link.isError && (
        <p role="alert" className="text-sm text-conflict">
          {t('settings.invite.loadFailed')} <Button variant="link-accent" size="sm" onClick={() => void link.refetch()}>{t('common.retry')}</Button>
        </p>
      )}
      <div><Button onClick={() => setConfirming(true)}>{t('settings.invite.revoke')}</Button></div>
      <ConfirmDialog
        open={confirming}
        danger
        busy={revoke.isPending}
        message={t('settings.invite.revokeConfirm')}
        confirmLabel={t('settings.invite.revokeAction')}
        onConfirm={() => revoke.mutate()}
        onCancel={() => setConfirming(false)}
      />
    </SettingsBlock>
  );
}
