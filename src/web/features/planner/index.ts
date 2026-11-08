import type { FeatureModule } from '../../app/feature.js';
import { pageTool } from '../../app/tools.js';
import { PlannerPage } from './PlannerPage.js';

/** "Planner" in the tool navigation: leads to the planner page. */
export const plannerTool = pageTool({ id: 'planner', order: 40, labelKey: 'planner.button', hintKey: 'planner.hint', page: 'planner' });

/**
 * Production planner: the chain from target items and rates down to miners and pumps, with machines,
 * recipes (alternates selectable), by-products and power. Needs `recipes.json` in the dataset. A world page
 * (`/w/:id/planner`) at full width, reached from the tool navigation; the plan lives in `usePlanner`.
 */
export const plannerFeature: FeatureModule = {
  id: 'planner',
  tools: [plannerTool],
  pages: [{ id: 'planner', titleKey: 'planner.title', Component: PlannerPage }],
};
