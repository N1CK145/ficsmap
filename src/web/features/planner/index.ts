import type { FeatureModule, Tool } from '../../app/feature.js';
import { PlannerDialog } from './PlannerHost.js';
import { usePlanner } from './usePlanner.js';

/** "Planner" in the tool navigation: opens the planner. */
export const plannerTool: Tool = {
  id: 'planner', order: 40, labelKey: 'planner.button', hintKey: 'planner.hint', action: true,
  useTool: () => {
    const open = usePlanner(s => s.open);
    return { available: true, run: open };
  },
};

/**
 * Production planner: the chain from target items and rates down to miners and pumps, with machines,
 * recipes (alternates selectable), by-products and power. Needs `recipes.json` in the dataset. Opened from
 * the tool navigation; the dialog is a header item so it renders in the top layer.
 */
export const plannerFeature: FeatureModule = {
  id: 'planner',
  tools: [plannerTool],
  headerItems: [{ id: 'planner-dialog', order: 1000, Component: PlannerDialog }],
};
