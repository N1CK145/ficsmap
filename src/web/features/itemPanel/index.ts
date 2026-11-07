import { typeById } from '../../../shared/collectibleTypes.js';
import type { FeatureModule } from '../../app/feature.js';
import { useUiStore } from '../../app/store.js';
import { Nearby } from './sections/Nearby.js';
import { CrashSite } from './sections/CrashSite.js';
import { PowerSlug } from './sections/PowerSlug.js';
import { ToOpen } from './sections/ToOpen.js';
import { crashSitesSearch } from './search.js';
import { SelectionPan } from './SelectionPan.js';

/**
 * The item detail panel (spec §10.2). The world layout renders `ItemPanel`; this feature adds the
 * default `inspect` map mode (a click selects), the pan that keeps the selection visible, and the
 * panel's own sections, and the drop pods' crash sites in the search.
 */
export const itemPanelFeature: FeatureModule = {
  id: 'itemPanel',
  mapModes: [{ id: 'inspect', onMarkerClick: item => useUiStore.getState().select(item.name) }],
  mapLayers: [{ id: 'selection-pan', order: 100, Component: SelectionPan }],
  searchProviders: [crashSitesSearch],
  itemDetailSections: [
    { id: 'to-open', order: 10, applies: item => typeById(item.type).details === 'dropPod', Component: ToOpen },
    { id: 'crash-site', order: 15, applies: item => typeById(item.type).details === 'dropPod', Component: CrashSite },
    { id: 'power-slug', order: 20, applies: item => typeById(item.type).details === 'powerSlug', Component: PowerSlug },
    { id: 'nearby', order: 30, applies: () => true, Component: Nearby },
  ],
};
