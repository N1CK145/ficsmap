import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

/**
 * Top bar: app name, then the header items the layout passes in (from `headerItems`), and `end`
 * (the account menu) at the right edge.
 */
export function Header({ children, end }: { children?: ReactNode; end?: ReactNode }) {
  const { t } = useTranslation();
  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-line bg-panel px-3">
      <Link to="/?list=1" className="rounded font-display text-xl font-bold tracking-wide focus-ring">{t('app.name')}</Link>
      <div className="flex min-w-0 flex-1 items-center gap-3">{children}</div>
      {end}
    </header>
  );
}
