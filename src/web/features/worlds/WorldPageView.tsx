import { useEffect, useId, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Outlet } from 'react-router';
import type { WorldCtx, WorldPage } from '../../app/feature.js';
import { worldPath } from '../../app/pages.js';
import { buttonClass } from '../../components/Button.js';
import { ImportBanner } from '../import/ImportBanner.js';

/**
 * A world page (`FeatureModule.pages`) in the main area, at its full width: a bar with [← Back to the map] and the page
 * heading, then the page itself (the world route's outlet, scrolling on its own). Keyboard focus moves to the heading
 * when the page opens; the layout keys this view by the page, so a page's own sub-path (the wiki's entry) does not.
 */
export function WorldPageView({ page, ctx }: { page: WorldPage; ctx: WorldCtx }) {
  const { t } = useTranslation();
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  return (
    <main aria-labelledby={headingId} className="relative flex min-w-0 flex-1 flex-col bg-bg">
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-line bg-panel px-4 py-2">
        <Link to={worldPath(ctx.worldId)} className={buttonClass({ variant: 'ghost', size: 'sm' }, '-ml-2')}>
          <span aria-hidden="true">←</span>{t('world.backToMap')}
        </Link>
        <h2 id={headingId} ref={heading} tabIndex={-1} className="min-w-0 font-display text-xl font-semibold outline-none">
          {t(page.titleKey)}
        </h2>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <Outlet context={ctx} />
      </div>
      <ImportBanner worldId={ctx.worldId} />
    </main>
  );
}
