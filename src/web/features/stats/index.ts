import { createElement } from 'react';
import type { FeatureModule } from '../../app/feature.js';
import { StatsIcon } from '../../components/icons.js';
import { pageTool } from '../../app/tools.js';
import { STATS_PAGE, StatsPage } from './StatsPage.js';

/**
 * "Statistik" in the world's navigation, after the Fabrik page: the game's statistics of a save for the world and per
 * player (`src/shared/factory/statsView.ts`), from the stored factory snapshots.
 */
export const statsFeature: FeatureModule = {
  id: 'stats',
  tools: [pageTool({ id: 'stats', order: 36, labelKey: 'stats.title', hintKey: 'stats.hint', page: STATS_PAGE, icon: createElement(StatsIcon) })],
  pages: [{ id: STATS_PAGE, titleKey: 'stats.title', Component: StatsPage }],
};
