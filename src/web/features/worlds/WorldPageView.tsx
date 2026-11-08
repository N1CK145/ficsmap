import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Outlet } from 'react-router';
import type { WorldCtx, WorldPage } from '../../app/feature.js';
import { worldPath } from '../../app/pages.js';
import { buttonClass } from '../../components/Button.js';
import { BackIcon } from '../../components/icons.js';
import { PageActionsSlot } from '../../components/PageActions.js';
import { SectionMarker } from '../../components/SectionHeading.js';
import { ImportBanner } from '../import/ImportBanner.js';

/**
 * A world page (`FeatureModule.pages`) in the main area, at its full width: a page header with [← Map], the page
 * heading and the page's own actions (`PageActions` from anywhere inside the page), then the page itself (the world
 * route's outlet, scrolling on its own). Keyboard focus moves to the heading when the page opens; the layout keys
 * this view by the page, so a page's own sub-path (the wiki's entry) does not.
 */
export function WorldPageView({ page, ctx }: { page: WorldPage; ctx: WorldCtx }) {
  const { t } = useTranslation();
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const [actions, setActions] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  return (
    <main aria-labelledby={headingId} className="relative flex min-w-0 flex-1 flex-col bg-bg">
      <div className="flex min-h-12 shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-line bg-panel px-3 py-2 min-[900px]:px-4">
        <Link to={worldPath(ctx.worldId)} title={t('world.backToMap')} className={buttonClass({ variant: 'secondary', size: 'sm' })}>
          <BackIcon />
          <span className="max-[899px]:sr-only">{t('world.backToMap')}</span>
        </Link>
        <span aria-hidden="true" className="h-6 w-px bg-line max-[899px]:hidden" />
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <SectionMarker size="lg" />
          <h2 id={headingId} ref={heading} tabIndex={-1} className="min-w-0 truncate font-display text-2xl leading-tight font-bold tracking-wider uppercase outline-none">
            {t(page.titleKey)}
          </h2>
        </div>
        <div ref={setActions} className="flex flex-wrap items-center gap-2 empty:hidden" />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3 min-[900px]:p-4">
        <PageActionsSlot value={actions}>
          <Outlet context={ctx} />
        </PageActionsSlot>
      </div>
      <ImportBanner worldId={ctx.worldId} />
    </main>
  );
}
