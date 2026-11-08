import type { FeatureModule } from '../../app/feature.js';
import { SaveWatcherSection } from './SaveWatcherSection.js';

/** The save watcher: upload tokens and the script generator in the world settings (owner). */
export const saveWatcherFeature: FeatureModule = {
  id: 'saveWatcher',
  settingsSections: [{ id: 'save-watcher', order: 45, ownerOnly: true, Component: SaveWatcherSection }],
};
