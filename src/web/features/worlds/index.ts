import type { FeatureModule } from '../../app/feature.js';
import { WORLD_ROUTE_ID } from '../../app/pages.js';
import { LoginPage } from './LoginPage.js';
import { ProfilePage } from './ProfilePage.js';
import { RemovedPage } from './RemovedPage.js';
import { WorldLayout } from './WorldLayout.js';
import { WorldListPage } from './WorldListPage.js';

export const worldsFeature: FeatureModule = {
  id: 'worlds',
  routes: [
    { path: '/login', Component: LoginPage },
    { path: '/', Component: WorldListPage },
    { path: '/profile', Component: ProfilePage },
    // The settings view and the features' world pages (added by the router) are child routes, so the world layout
    // (and its stream, dialogs, state) stays mounted.
    { id: WORLD_ROUTE_ID, path: '/w/:id', Component: WorldLayout, children: [{ path: 'settings', Component: () => null }] },
    { path: '/removed', Component: RemovedPage },
  ],
};
