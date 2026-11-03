import type { FeatureModule } from '../../app/feature.js';
import { ViewSwitch } from './ViewSwitch.js';

export { ListView } from './ListView.js';

/** The Map | List switch (spec §10.10). The world layout shows `ListView` in the main area while List is chosen. */
export const listViewFeature: FeatureModule = {
  id: 'listView',
  sidebarPanels: [{ id: 'view', order: 0, titleKey: 'list.view', Component: ViewSwitch, desktopOnly: true }],
};
