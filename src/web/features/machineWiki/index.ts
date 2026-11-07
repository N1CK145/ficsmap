import type { FeatureModule, WorldCtx } from '../../app/feature.js';
import { MachineWikiHeaderItem } from './MachineWikiDialog.js';
import { useMachineWiki } from './useMachineWiki.js';

export { MachineWikiDialog } from './MachineWikiDialog.js';
export { useMachineData, useMachineWiki } from './useMachineWiki.js';

/**
 * The tool navigation's entry for the wiki, in the shape of `Tool` from feature/search
 * (`src/web/app/feature.ts` there). Once that is merged: type it as `Tool`, add `tools: [machineWikiTool]`
 * to the feature, and keep a header item that renders only `<MachineWikiDialog>`.
 */
export const machineWikiTool = {
  id: 'machine-wiki',
  order: 36,
  labelKey: 'machineWiki.open',
  hintKey: 'machineWiki.openHint',
  useTool: (_ctx: WorldCtx): { available: boolean; run(): void } => {
    const show = useMachineWiki(s => s.show);
    return { available: true, run: () => show() };
  },
};

/**
 * Machine and vehicle wiki: stats, game description, build cost, unlocks and recipes of every machine
 * and vehicle, from the dataset's `machines.json`. Self-contained: its own open state (`useMachineWiki`)
 * and dialog; for now opened from a header button.
 */
export const machineWikiFeature: FeatureModule = {
  id: 'machineWiki',
  headerItems: [{ id: 'machine-wiki', order: 36, Component: MachineWikiHeaderItem }],
};
