import { createElement } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { FeatureModule } from '../../app/feature.js';
import { useUiStore } from '../../app/store.js';
import { toggleTool, type ToggleStore } from '../../app/tools.js';
import { CollectiblesIcon } from '../../components/icons.js';

/** The collectible markers' switch (`markersVisible` in the UI store) in the `{ visible, toggle }` shape of `toggleTool`. */
export const useMarkerToggle = (): ToggleStore =>
  useUiStore(useShallow(s => ({ visible: s.markersVisible, toggle: s.toggleMarkers })));

/**
 * The world map. The world layout renders `MapView` as its main area; the map then hosts every
 * feature's `mapLayers`, `mapControls` and the active `mapModes` banner. Its own tool is the switch of the collectible
 * markers ("Collectibles", first of the map's switches), which `MapView` draws on its marker canvas.
 */
export const mapFeature: FeatureModule = {
  id: 'map',
  tools: [toggleTool({
    id: 'collectibles', order: 10, labelKey: 'map.collectibles.control', hintKey: 'map.collectibles.hint', icon: createElement(CollectiblesIcon),
    useToggle: useMarkerToggle,
  })],
};
