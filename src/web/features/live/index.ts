import type { FeatureModule } from '../../app/feature.js';
import { LiveDot } from './LiveDot.js';

/** The world event stream (mounted by the world layout) and its header dot. */
export const liveFeature: FeatureModule = {
  id: 'live',
  headerItems: [{ id: 'live-dot', order: 10, Component: LiveDot }],
};
