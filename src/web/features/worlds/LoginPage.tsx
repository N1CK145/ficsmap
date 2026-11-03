import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { buttonClass } from '../../components/Button.js';

/** `/login?error=` codes the server redirects with (server/http/auth.ts). */
const LOGIN_ERRORS = ['invite_only', 'cancelled', 'expired', 'invite_invalid', 'failed'] as const;
type LoginError = (typeof LOGIN_ERRORS)[number];

function loginError(raw: string | null): LoginError | null {
  if (raw === null) return null;
  return (LOGIN_ERRORS as readonly string[]).includes(raw) ? (raw as LoginError) : 'failed';
}

/** Only a local path that does not lead back here; the server validates it again. */
function safeReturnTo(raw: string | null): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\') || raw.startsWith('/login')) return '/';
  return raw;
}

export function LoginPage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const error = loginError(params.get('error'));
  const href = `/auth/login?returnTo=${encodeURIComponent(safeReturnTo(params.get('returnTo')))}`;

  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <div className="flex w-full max-w-sm flex-col gap-4 rounded border border-line bg-panel p-6 text-center">
        <h1 className="font-display text-4xl font-bold tracking-wide">{t('app.name')}</h1>
        <p className="text-muted">{t('login.tagline')}</p>
        {error && <p role="alert" className="rounded border border-conflict px-3 py-2 text-sm">{t(`login.error.${error}`)}</p>}
        <a href={href} className={buttonClass({ variant: 'primary' }, 'w-full')}>{t('login.signIn')}</a>
        <p className="text-sm text-muted">{t('login.inviteOnly')}</p>
      </div>
    </main>
  );
}
