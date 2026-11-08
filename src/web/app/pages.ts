import { useMemo } from 'react';
import { matchPath, useLocation } from 'react-router';
import { collect, type WorldPage } from './feature.js';
import { useFeatures } from './FeaturesContext.js';

/** The id of the `/w/:id` route; the router adds the features' `pages` to it as child routes. */
export const WORLD_ROUTE_ID = 'world';

/** `/w/<world>`: the world's map; with segments a path under it, e.g. `worldPath(id, 'wiki', entry)`. Each part is encoded. */
export function worldPath(worldId: string, ...segments: string[]): string {
  return `/w/${[worldId, ...segments].map(encodeURIComponent).join('/')}`;
}

/** A page's route path below `/w/:id`: its id, then its `subPath` (`wiki/:entry?`). */
export function pageRoutePath(page: WorldPage): string {
  return page.subPath ? `${page.id}/${page.subPath}` : page.id;
}

/** The world page shown now (from the URL), or undefined on the map, the list view and the settings. */
export function useWorldPage(): WorldPage | undefined {
  const features = useFeatures();
  const { pathname } = useLocation();
  const pages = useMemo(() => collect(features, 'pages'), [features]);
  return pages.find(p => matchPath(`/w/:id/${pageRoutePath(p)}`, pathname) !== null);
}
