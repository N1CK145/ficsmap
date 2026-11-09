import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../../app/api.js';
import { queryKeys } from '../../app/queryKeys.js';
import { Button } from '../../components/Button.js';
import { ReadonlyCopyField } from '../../components/ReadonlyCopyField.js';

/**
 * A general invite link (server owners only, `GET /api/invite-link`): it creates an account without joining a world.
 * Like a world invite it works once, so it is never cached and a fresh link replaces it after each copy.
 */
export function GeneralInvite() {
  const { t, i18n } = useTranslation();
  const link = useQuery({
    queryKey: queryKeys.generalInviteLink(),
    queryFn: () => api<{ url: string; expiresAt: number }>('GET', '/api/invite-link'),
    staleTime: 0, gcTime: 0, refetchOnWindowFocus: false, retry: false,
  });

  // While a link is on its way, and when the refresh failed, the field is empty: the copied link is never offered again.
  const current = link.isFetching || link.isError ? undefined : link.data;
  const expires = current && new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }).format(current.expiresAt);

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted">{t('profile.invite.hint')}</p>
      <ReadonlyCopyField
        label={t('profile.invite.linkLabel')}
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
    </div>
  );
}
