import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { buttonClass } from '../../components/Button.js';
import { Footer } from '../../components/Footer.js';
import { BrandMark } from '../../components/icons.js';
import { LanguageSwitch } from '../../components/LanguageSwitch.js';

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
    <div className="flex min-h-dvh flex-col">
      <main className="flex flex-1 flex-col items-center justify-center gap-4 p-4">
        <div className="flex w-full max-w-sm flex-col overflow-hidden chamfer-window border border-t-2 border-line border-t-accent bg-panel text-center shadow-[0_10px_30px_rgb(0_0_0/0.45)]">
          <div className="flex flex-col items-center gap-4 p-6">
            <BrandMark size={56} />
            <h1 className="font-display text-4xl font-bold tracking-wider uppercase">{t('app.name')}</h1>
            <p className="text-muted">{t('login.tagline')}</p>
            {error && <p role="alert" className="chamfer border border-conflict bg-conflict/10 px-3 py-2 text-sm">{t(`login.error.${error}`)}</p>}
            <a href={href} className={buttonClass({ variant: 'primary', size: 'touch' }, 'w-full')}>{t('login.signIn')}</a>
            <p className="text-sm text-muted">{t('login.inviteOnly')}</p>
          </div>
          <div aria-hidden="true" className="h-1.5 hazard" />
        </div>
        <LanguageSwitch />
      </main>
      <Footer />
    </div>
  );
}
