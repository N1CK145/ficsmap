import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { LOGIN_PROVIDERS, type LoginProvider, type MeDto } from '../../../shared/api.js';
import { api } from '../../app/api.js';
import { queryKeys } from '../../app/queryKeys.js';
import { Button, buttonClass } from '../../components/Button.js';
import { ConfirmDialog } from '../../components/ConfirmDialog.js';
import { useToast } from '../../components/Toast.js';

/** Provider names are brands: the same in every language. */
const PROVIDER_NAME: Record<LoginProvider, string> = { discord: 'Discord', steam: 'Steam' };
/** Where a provider's sign-in starts (server/http/auth.ts); `link=1` adds it to the signed-in account. */
const LOGIN_PATH: Record<LoginProvider, string> = { discord: '/auth/login', steam: '/auth/steam/login' };
/** `/profile?link_error=` codes the server redirects with after linking. */
const LINK_ERRORS = ['taken', 'provider_taken', 'cancelled', 'expired', 'failed'] as const;

/**
 * The account's sign-ins (profile page): each provider with the linked account's name (the SteamID when Steam gave
 * none) or [Link …], which runs that provider's sign-in and comes back here with `?linked=` or `?link_error=`. A
 * sign-in can be removed while another one is left.
 */
export function SignInMethods({ me }: { me: MeDto }) {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [removing, setRemoving] = useState<LoginProvider | null>(null);
  const identities = me.identities ?? [];

  const unlink = useMutation({
    mutationFn: (provider: LoginProvider) => api('DELETE', `/api/me/identities/${provider}`),
    onSuccess: (_r, provider) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.me() });
      toast.show({ message: t('profile.signIn.unlinked', { provider: PROVIDER_NAME[provider] }) });
    },
    onError: () => toast.show({ message: t('profile.signIn.unlinkFailed') }),
    onSettled: () => setRemoving(null),
  });

  const linkedParam = params.get('linked');
  const linked = (LOGIN_PROVIDERS as readonly string[]).includes(linkedParam ?? '') ? (linkedParam as LoginProvider) : null;
  const errorParam = params.get('link_error');
  const error = errorParam === null ? null : (LINK_ERRORS as readonly string[]).includes(errorParam) ? errorParam : 'failed';

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted">{t('profile.signIn.hint')}</p>
      {linked && <p role="status" className="text-sm">{t('profile.signIn.linked', { provider: PROVIDER_NAME[linked] })}</p>}
      {error && <p role="alert" className="chamfer border border-conflict bg-conflict/10 px-3 py-2 text-sm">{t(`profile.signIn.error.${error}`)}</p>}
      <ul className="flex flex-col divide-y divide-line">
        {LOGIN_PROVIDERS.map(provider => {
          const identity = identities.find(i => i.provider === provider);
          const name = PROVIDER_NAME[provider];
          return (
            <li key={provider} className="flex min-h-12 flex-wrap items-center gap-x-3 gap-y-2 py-2">
              <div className="min-w-0 flex-1">
                <div className="font-medium">{name}</div>
                <div className="truncate text-sm text-muted">{identity ? identity.name ?? identity.subject : t('profile.signIn.notLinked')}</div>
              </div>
              {identity
                ? identities.length > 1 && (
                  <Button size="sm" aria-label={t('profile.signIn.unlinkNamed', { provider: name })} onClick={() => setRemoving(provider)}>
                    {t('profile.signIn.unlink')}
                  </Button>
                )
                : <a href={`${LOGIN_PATH[provider]}?link=1`} className={buttonClass({ size: 'sm' })}>{t('profile.signIn.link', { provider: name })}</a>}
            </li>
          );
        })}
      </ul>
      <ConfirmDialog
        open={removing !== null}
        danger
        busy={unlink.isPending}
        message={removing ? t('profile.signIn.unlinkConfirm', { provider: PROVIDER_NAME[removing] }) : null}
        confirmLabel={t('profile.signIn.unlink')}
        onConfirm={() => { if (removing && !unlink.isPending) unlink.mutate(removing); }}
        onCancel={() => setRemoving(null)}
      />
    </div>
  );
}
