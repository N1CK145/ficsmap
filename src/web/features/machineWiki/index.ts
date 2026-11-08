import type { FeatureModule } from '../../app/feature.js';
import { pageTool } from '../../app/tools.js';
import { MachineWikiPage } from './MachineWikiPage.js';
import { machinesSearch } from './search.js';
import { WIKI_PAGE } from './useMachineWiki.js';

export { MachineWikiPage } from './MachineWikiPage.js';
export { useMachineData, useMachineWiki, WIKI_PAGE, wikiPath } from './useMachineWiki.js';
export { GameIcon, IconsContext, useItemIcons, type ItemIcons } from './icons.js';

/** "Machines" in the tool navigation: leads to the wiki page. */
export const machineWikiTool = pageTool({ id: 'machine-wiki', order: 60, labelKey: 'machineWiki.open', hintKey: 'machineWiki.openHint', page: WIKI_PAGE });

/**
 * Machine and vehicle wiki: stats, game description, build cost, unlocks and recipes of every machine
 * and vehicle, from the dataset's `machines.json`, with the game's pictures of machines, vehicles and items
 * (dataset part `icons`, optional) and a filter by unlock tier. A world page at full width (`/w/:id/wiki`, an entry
 * at `/w/:id/wiki/<entry>`), reached from the tool navigation or a search result; anything else can open an entry by
 * navigating to `wikiPath(worldId, id)`. Its search text and tier filter live in `useMachineWiki`.
 */
export const machineWikiFeature: FeatureModule = {
  id: 'machineWiki',
  tools: [machineWikiTool],
  pages: [{ id: WIKI_PAGE, subPath: ':entry?', titleKey: 'machineWiki.title', Component: MachineWikiPage }],
  searchProviders: [machinesSearch],
};
