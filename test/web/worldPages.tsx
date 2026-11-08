import { QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { createMemoryRouter, Link, RouterProvider } from 'react-router';
import { collect, type FeatureModule, type WorldCtx } from '../../src/web/app/feature.js';
import { FeaturesProvider } from '../../src/web/app/FeaturesContext.js';
import { useWorldPage, worldPath, WORLD_ROUTE_ID } from '../../src/web/app/pages.js';
import { ToolButton } from '../../src/web/features/worlds/ToolsNav.js';
import { WorldPageView } from '../../src/web/features/worlds/WorldPageView.js';
import { appRoutes } from '../../src/web/router.js';

/**
 * Renders features' world pages as the world layout does, without loading a world: the app's routes (so the pages are
 * child routes of `/w/:id`), a link to the map and the features' tools as buttons (as the tabs and the section menu
 * have them), and on `/w/:id` itself `map` in place of the map. The context's `navigate` is the router's.
 */
export function renderWorldPages({ features, ctx, url, map }: { features: FeatureModule[]; ctx: WorldCtx; url: string; map?: ReactNode }) {
  const world: WorldCtx = { ...ctx, navigate: (to, opts) => void router.navigate(to, opts) };
  function Shell() {
    const { t } = useTranslation();
    const page = useWorldPage();
    return (
      <>
        <nav aria-label="Tools">
          <Link to={worldPath(world.worldId)}>{t('nav.map')}</Link>
          {collect(features, 'tools').map(tool => <ToolButton key={tool.id} tool={tool} ctx={world} />)}
        </nav>
        {page ? <WorldPageView key={page.id} page={page} ctx={world} /> : <div role="region" aria-label="Map">{map}</div>}
      </>
    );
  }
  const all: FeatureModule[] = [{ id: 'shell', routes: [{ id: WORLD_ROUTE_ID, path: '/w/:id', Component: Shell }] }, ...features];
  const router = createMemoryRouter(appRoutes(all), { initialEntries: [url] });
  render(
    <QueryClientProvider client={ctx.queryClient}>
      <FeaturesProvider features={all}><RouterProvider router={router} /></FeaturesProvider>
    </QueryClientProvider>,
  );
  return { router, ctx: world };
}
