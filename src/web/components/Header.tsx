import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { LanguageSwitch } from './LanguageSwitch.js';

/**
 * Top bar: app name and the header items the layout passes in (`children`, from `headerItems`) on the
 * left; `center` (the search) in the middle; then `tools` (the tool navigation), the language switch
 * and `end` (the account menu) on the right. Both sides share the free width equally, so the centre
 * stays centred until the right side needs more room than its half.
 */
export function Header({ children, center, tools, end }: { children?: ReactNode; center?: ReactNode; tools?: ReactNode; end?: ReactNode }) {
  const { t } = useTranslation();
  return (
    <header className="relative flex h-12 shrink-0 items-center gap-3 border-b border-line bg-panel px-3">
      <div className="flex min-w-0 flex-1 basis-0 items-center gap-3">
        <Link to="/?list=1" className="shrink-0 rounded font-display text-xl font-bold tracking-wide focus-ring">{t('app.name')}</Link>
        {children}
      </div>
      {center !== undefined && <div className="flex shrink-0 justify-center">{center}</div>}
      <div className="flex flex-1 basis-0 items-center justify-end gap-3">
        {tools}
        <LanguageSwitch />
        {end}
      </div>
    </header>
  );
}
