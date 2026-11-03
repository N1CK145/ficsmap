import type { FeatureModule } from '../../app/feature.js';
import { LoginPage } from './LoginPage.js';
import { RemovedPage } from './RemovedPage.js';
import { WorldLayout } from './WorldLayout.js';
import { WorldListPage } from './WorldListPage.js';

export const worldsFeature: FeatureModule = {
  id: 'worlds',
  routes: [
    { path: '/login', Component: LoginPage },
    { path: '/', Component: WorldListPage },
    // The settings view is a child route so the world layout (and its stream, dialogs, state) stays mounted.
    { path: '/w/:id', Component: WorldLayout, children: [{ path: 'settings', Component: () => null }] },
    { path: '/removed', Component: RemovedPage },
  ],
};
