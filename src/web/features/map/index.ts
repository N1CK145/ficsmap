import type { FeatureModule } from '../../app/feature.js';

/**
 * The world map. The world layout renders `MapView` as its main area; the map then hosts every
 * feature's `mapLayers`, `mapControls` and the active `mapModes` banner. No extension points yet.
 */
export const mapFeature: FeatureModule = { id: 'map' };
