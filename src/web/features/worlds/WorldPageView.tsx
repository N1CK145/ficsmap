import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Outlet } from 'react-router';
import type { WorldCtx, WorldPage } from '../../app/feature.js';
import { buttonClass } from '../../components/Button.js';
import { BackIcon } from '../../components/icons.js';
import { PageBackSlot, type PageBackTarget } from '../../components/PageActions.js';
import { ImportBanner } from '../import/ImportBanner.js';

/**
 * A world page (`FeatureModule.pages`) in the main area, at its full width, scrolling on its own (the world route's
 * outlet). The tab (from 1280 px) or the section menu (below) already names the page, so its heading (the `main`
 * landmark's name, where the keyboard focus goes when the page opens) is for screen readers only; the page keeps its
 * actions in its own windows. Only when a page points the back control somewhere inside itself (`usePageBack`, the
 * wiki from an entry to its list on a phone) does a bar with that control sit above the page. The layout keys this
 * view by the page, so a page's own sub-path (the wiki's entry) does not move the focus.
 */
export function WorldPageView({ page, ctx }: { page: WorldPage; ctx: WorldCtx }) {
  const { t } = useTranslation();
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const [back, setBack] = useState<PageBackTarget | null>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  return (
    <main aria-labelledby={headingId} className="relative flex min-w-0 flex-1 flex-col bg-bg">
      <h2 id={headingId} ref={heading} tabIndex={-1} className="sr-only">{t(page.titleKey)}</h2>
      {back && (
        <div className="flex shrink-0 items-center border-b border-line bg-panel px-3 py-1.5 min-[900px]:px-4">
          <Link to={back.to} className={buttonClass({ variant: 'secondary', size: 'sm' })}>
            <BackIcon />
            {back.label}
          </Link>
        </div>
      )}
      {/* relative: the page's absolutely placed parts (screen-reader-only texts) stay inside this box, not below it. */}
      <div className="relative min-h-0 flex-1 overflow-y-auto p-3 min-[900px]:p-4">
        <PageBackSlot value={setBack}>
          <Outlet context={ctx} />
        </PageBackSlot>
      </div>
      <ImportBanner worldId={ctx.worldId} />
    </main>
  );
}
