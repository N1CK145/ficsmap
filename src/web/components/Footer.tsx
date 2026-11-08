import { useTranslation } from 'react-i18next';
import { APP_VERSION, RELEASE_URL, REPO_URL } from '../app/version.js';

/** The footer's fixed height. */
export const FOOTER_PX = 28;

const linkClass = 'rounded focus-ring hover:text-accent';

/**
 * One line of small print at the bottom of the world list and the sign-in page: this build's version (its release
 * page) and the source repository. Inside a world the account menu has both instead, so the map and the tool pages
 * keep the whole height. Always `FOOTER_PX` high.
 */
export function Footer({ className = '' }: { className?: string }) {
  const { t } = useTranslation();
  return (
    <footer
      style={{ height: FOOTER_PX }}
      className={`flex shrink-0 items-center justify-center gap-x-2 overflow-hidden px-3 font-display text-xs tracking-wider whitespace-nowrap text-muted uppercase ${className}`}
    >
      <a href={RELEASE_URL} target="_blank" rel="noreferrer" className={linkClass}>{t('app.name')} v{APP_VERSION}</a>
      <span aria-hidden="true">·</span>
      <a href={REPO_URL} target="_blank" rel="noreferrer" className={linkClass}>{t('footer.source')}</a>
    </footer>
  );
}
