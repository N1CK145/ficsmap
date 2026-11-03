import type { FeatureModule } from '../../app/feature.js';
import { ProgressPanel } from './ProgressPanel.js';

/** Progress per type in the sidebar, with the type filters and the collected visibility. */
export const progressFeature: FeatureModule = {
  id: 'progress',
  sidebarPanels: [{ id: 'progress', order: 10, titleKey: 'progress.title', Component: ProgressPanel }],
};
