import './factoryMap.css';
import { createElement } from 'react';
import type { FeatureModule } from '../../../app/feature.js';
import { toggleTool } from '../../../app/tools.js';
import { FactoryInfo } from './FactoryInfo.js';
import { FactoryMapLayer } from './FactoryMapLayer.js';
import { FactoryPanel } from './FactoryPanel.js';
import { HighlightChip } from './HighlightChip.js';
import { FactoryIcon } from '../icons.js';
import { FactoryTimeline } from './Timeline.js';
import { useFactoryMap } from './useFactoryMap.js';

/**
 * The factory map: what the world's saves have built, drawn on the map from the stored factory snapshots (see
 * docs/architecture.md, "Factory map"). A switch in the map's tools, a sidebar panel with the layers and the legend,
 * the canvas layer, the timeline at the bottom of the map and the info window of the selected building, station or
 * vehicle. Snapshot choice, comparison and highlight are shared with the Fabrik page (`useFactoryView`).
 */
export const factoryMapFeature: FeatureModule = {
  id: 'factoryMap',
  tools: [toggleTool({
    id: 'factory-map', order: 32, labelKey: 'factoryMap.control', hintKey: 'factoryMap.hint', icon: createElement(FactoryIcon),
    useToggle: useFactoryMap,
  })],
  sidebarPanels: [{ id: 'factory-map', order: 45, titleKey: 'factoryMap.title', Component: FactoryPanel }],
  mapLayers: [{ id: 'factory-map', order: 4, Component: FactoryMapLayer }],
  mapOverlays: [
    { id: 'factory-timeline', order: 20, Component: FactoryTimeline },
    { id: 'factory-highlight', order: 25, Component: HighlightChip },
    { id: 'factory-info', order: 30, Component: FactoryInfo },
  ],
};
