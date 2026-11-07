import type { FeatureModule, Tool } from '../../app/feature.js';
import { MachineWikiHost } from './MachineWikiDialog.js';
import { machinesSearch } from './search.js';
import { useMachineWiki } from './useMachineWiki.js';

export { MachineWikiDialog } from './MachineWikiDialog.js';
export { useMachineData, useMachineWiki } from './useMachineWiki.js';

/** "Machines" in the tool navigation: opens the wiki. */
export const machineWikiTool: Tool = {
  id: 'machine-wiki', order: 60, labelKey: 'machineWiki.open', hintKey: 'machineWiki.openHint', action: true,
  useTool: () => {
    const show = useMachineWiki(s => s.show);
    return { available: true, run: () => show() };
  },
};

/**
 * Machine and vehicle wiki: stats, game description, build cost, unlocks and recipes of every machine
 * and vehicle, from the dataset's `machines.json`. Self-contained: its own open state (`useMachineWiki`)
 * and dialog (a header item, so it renders in the top layer), opened from the tool navigation or a search result; anything
 * else can open an entry with `useMachineWiki.getState().show(id)`.
 */
export const machineWikiFeature: FeatureModule = {
  id: 'machineWiki',
  tools: [machineWikiTool],
  searchProviders: [machinesSearch],
  headerItems: [{ id: 'machine-wiki-dialog', order: 1000, Component: MachineWikiHost }],
};
