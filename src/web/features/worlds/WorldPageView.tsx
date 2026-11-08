import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Outlet } from 'react-router';
import type { WorldCtx, WorldPage } from '../../app/feature.js';
import { worldPath } from '../../app/pages.js';
import { buttonClass } from '../../components/Button.js';
import { BackIcon } from '../../components/icons.js';
import { PageActionsSlot, PageBackSlot, type PageBackTarget } from '../../components/PageActions.js';
import { SectionMarker } from '../../components/SectionHeading.js';
import { ImportBanner } from '../import/ImportBanner.js';

/**
 * A world page (`FeatureModule.pages`) in the main area, at its full width: a page header with the page heading and
 * the page's own actions (`PageActions` from anywhere inside the page), then the page itself (the world route's
 * outlet, scrolling on its own). Below 1280 px, where the sections are a menu rather than tabs, a [←] before the
 * heading leads back to the map; a page can point it somewhere inside itself instead (`usePageBack`, the wiki from an
 * entry to its list), and then it shows at every width. The header stays one row while the heading and the actions
 * fit side by side; otherwise the actions wrap under it. Keyboard focus moves to the heading when the page opens; the
 * layout keys this view by the page, so a page's own sub-path (the wiki's entry) does not.
 */
export function WorldPageView({ page, ctx }: { page: WorldPage; ctx: WorldCtx }) {
  const { t } = useTranslation();
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const [actions, setActions] = useState<HTMLDivElement | null>(null);
  const [back, setBack] = useState<PageBackTarget | null>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  const backTo = back ?? { to: worldPath(ctx.worldId), label: t('world.backToMap') };
  return (
    <main aria-labelledby={headingId} className="relative flex min-w-0 flex-1 flex-col bg-bg">
      <div className="flex min-h-12 shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-line bg-panel px-3 py-1.5 min-[900px]:px-4 min-[900px]:py-2">
        <Link
          to={backTo.to}
          aria-label={backTo.label}
          title={backTo.label}
          className={buttonClass({ variant: 'secondary', size: 'sm', shape: 'square' }, back ? '' : 'min-[1280px]:hidden')}
        >
          <BackIcon />
        </Link>
        {/* The heading takes its own width (truncating only when even that is not there), so the actions stay in its row while they fit. */}
        <div className="flex min-w-0 flex-[1_1_auto] items-center gap-2">
          <SectionMarker size="lg" />
          <h2 id={headingId} ref={heading} tabIndex={-1} className="min-w-0 truncate font-display text-xl leading-tight font-bold tracking-wider uppercase outline-none min-[900px]:text-2xl">
            {t(page.titleKey)}
          </h2>
        </div>
        <div ref={setActions} className="ml-auto flex flex-wrap items-center justify-end gap-2 empty:hidden" />
      </div>
      {/* relative: the page's absolutely placed parts (screen-reader-only texts) stay inside this box, not below it. */}
      <div className="relative min-h-0 flex-1 overflow-y-auto p-3 min-[900px]:p-4">
        <PageBackSlot value={setBack}>
          <PageActionsSlot value={actions}>
            <Outlet context={ctx} />
          </PageActionsSlot>
        </PageBackSlot>
      </div>
      <ImportBanner worldId={ctx.worldId} />
    </main>
  );
}
