import { useTranslation } from 'react-i18next';
import { createBrowserRouter, Navigate, type RouteObject } from 'react-router';
import { collect, type FeatureModule } from './app/feature.js';
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

/** The feature routes under one root with the error page; unknown paths go to `/`. */
export function appRoutes(features: readonly FeatureModule[]): RouteObject[] {
  return [{
    errorElement: <RouteError />,
    children: [...collect(features, 'routes'), { path: '*', element: <Navigate to="/" replace /> }],
  }];
}

export function createAppRouter(features: readonly FeatureModule[] = FEATURES) {
  return createBrowserRouter(appRoutes(features));
}
