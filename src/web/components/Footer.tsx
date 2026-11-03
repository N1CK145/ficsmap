import { useTranslation } from 'react-i18next';
import { APP_VERSION, RELEASE_URL, REPO_URL } from '../app/version.js';

/** The footer's fixed height; the mobile sheets and the Quick Check button sit above it. */
export const FOOTER_PX = 28;

const linkClass = 'rounded focus-ring hover:text-fg hover:underline';

/**
 * One line of small print at the bottom of every page: this build's version (its release page)
 * and the source repository. Always `FOOTER_PX` high, so the world view can lay out around it.
 */
export function Footer({ className = '' }: { className?: string }) {
  const { t } = useTranslation();
  return (
    <footer
      style={{ height: FOOTER_PX }}
      className={`flex shrink-0 items-center justify-center gap-x-2 overflow-hidden px-3 text-xs whitespace-nowrap text-muted ${className}`}
    >
      <a href={RELEASE_URL} target="_blank" rel="noreferrer" className={linkClass}>{t('app.name')} v{APP_VERSION}</a>
      <span aria-hidden="true">·</span>
      <a href={REPO_URL} target="_blank" rel="noreferrer" className={linkClass}>{t('footer.source')}</a>
    </footer>
  );
}
