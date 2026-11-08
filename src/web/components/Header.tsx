import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { BrandMark } from './icons.js';

/**
 * Top bar in three parts. Left: the ficsmap mark (to the world list; inside a world not on phones, where the world's
 * name needs the room and the account menu has the way to the worlds), then the header items the layout passes in
 * (`children`: sidebar toggle, world name, live state, import, settings). Middle: `center` (the search). Right: `tools`
 * (below 1280 px the section menu; from 1280 px the sections are a tab strip under the bar) and, after a divider,
 * `end` (the account menu, which also holds the language switch, the version and the source link).
 *
 * With a middle both sides grow from zero alike, so it stays centred; the right side never shrinks below its content
 * and the left side gives way instead (the world name truncates). Without a middle (phones, where the right side holds
 * the search button and the section menu) the right side takes just its content. So nothing overlaps.
 */
export function Header({ children, center, tools, end }: { children?: ReactNode; center?: ReactNode; tools?: ReactNode; end?: ReactNode }) {
  const { t } = useTranslation();
  return (
    <header className="relative flex h-12 shrink-0 items-center gap-1 border-b border-line bg-panel px-2 min-[900px]:gap-3 min-[900px]:px-3">
      <div className="flex min-w-0 flex-1 basis-0 items-center gap-1 min-[900px]:gap-3">
        {/* In a world on a phone the mark gives way to the world's name; the account menu leads to the worlds there. */}
        <Link to="/?list=1" className={`flex shrink-0 items-center gap-2 rounded focus-ring ${children !== undefined ? 'max-[899px]:hidden' : ''}`}>
          <BrandMark size={28} />
          <span className="font-display text-xl font-bold tracking-wide uppercase max-[1279px]:sr-only">{t('app.name')}</span>
        </Link>
        {children !== undefined && <span aria-hidden="true" className="h-6 w-px shrink-0 bg-line max-[899px]:hidden" />}
        {children}
      </div>
      {center !== undefined && <div className="flex shrink-0 justify-center">{center}</div>}
      <div className={`flex min-w-max items-center justify-end gap-1 min-[900px]:gap-2 ${center === undefined ? 'shrink-0' : 'flex-1 basis-0'}`}>
        {tools}
        {tools !== undefined && tools !== null && end !== undefined && <span aria-hidden="true" className="mx-0.5 h-6 w-px bg-line max-[899px]:hidden" />}
        {end}
      </div>
    </header>
  );
}
