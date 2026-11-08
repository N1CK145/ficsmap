import { useTranslation } from 'react-i18next';
import { createBrowserRouter, Navigate, useOutletContext, type RouteObject } from 'react-router';
import { collect, type FeatureModule, type WorldCtx, type WorldPage } from './app/feature.js';
import { pageRoutePath, WORLD_ROUTE_ID } from './app/pages.js';
import { buttonClass } from './components/Button.js';
import { FEATURES } from './features/index.js';

function RouteError() {
  const { t } = useTranslation();
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 p-4 text-center">
      <h1 className="font-display text-3xl font-bold">{t('error.title')}</h1>
      <a href={window.location.href} className={buttonClass({ variant: 'primary' })}>{t('error.reload')}</a>
    </main>
  );
}

/** A world page in the world layout's outlet, which passes the world down as the outlet context. */
function WorldPageOutlet({ page }: { page: WorldPage }) {
  const ctx = useOutletContext<WorldCtx>();
  return <page.Component ctx={ctx} />;
}

/** The features' world pages as child routes of the world route (`/w/:id/<page>`); other routes stay as they are. */
function withWorldPages(route: RouteObject, pages: readonly WorldPage[]): RouteObject {
  if (route.id !== WORLD_ROUTE_ID || route.index) return route;
  const children = pages.map(p => ({ path: pageRoutePath(p), element: <WorldPageOutlet page={p} /> }));
  return { ...route, children: [...(route.children ?? []), ...children] };
}

/** The feature routes under one root with the error page; unknown paths go to `/`. */
export function appRoutes(features: readonly FeatureModule[]): RouteObject[] {
  const pages = collect(features, 'pages');
  return [{
    errorElement: <RouteError />,
    children: [...collect(features, 'routes').map(r => withWorldPages(r, pages)), { path: '*', element: <Navigate to="/" replace /> }],
  }];
}

export function createAppRouter(features: readonly FeatureModule[] = FEATURES) {
  return createBrowserRouter(appRoutes(features));
}
