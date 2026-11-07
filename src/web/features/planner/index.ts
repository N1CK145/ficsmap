import type { FeatureModule } from '../../app/feature.js';
import { PlannerButton, PlannerDialog } from './PlannerHost.js';
import { usePlanner } from './usePlanner.js';

/**
 * The tool description for the header's tool navigation (feature/search): once that extension point
 * exists, replace the `planner-button` header item with `tools: [toggleTool(PLANNER_TOOL)]`.
 */
export const PLANNER_TOOL = { id: 'planner', order: 60, labelKey: 'planner.button', hintKey: 'planner.hint', useToggle: usePlanner } as const;

/**
 * Production planner: the chain from target items and rates down to miners and pumps, with machines,
 * recipes (alternates selectable), by-products and power. Needs `recipes.json` in the dataset.
 * For now a header button (`headerItems`) opens it; the dialog is a header item of its own so it
 * stays when the button moves into the tool navigation.
 */
export const plannerFeature: FeatureModule = {
  id: 'planner',
  headerItems: [
    { id: 'planner-button', order: 60, Component: PlannerButton },
    { id: 'planner-dialog', order: 1000, Component: PlannerDialog },
  ],
};
