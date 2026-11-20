import './creatures.css';
import { createElement } from 'react';
import type { FeatureModule } from '../../app/feature.js';
import { CrateIcon, PawIcon, PlayerIcon } from '../../components/icons.js';
import { toggleTool } from '../../app/tools.js';
import { CreatureLayer } from './CreatureLayer.js';
import { DeathCrateLayer } from './DeathCrateLayer.js';
import { CreaturesPanel } from './CreaturesPanel.js';
import { PlayerLayer } from './PlayerLayer.js';
import { PlayersPanel } from './PlayersPanel.js';
import { creaturesSearch } from './search.js';
import { useCrateToggle, useCreatureFile, useCreatureLayer, usePlayerToggle } from './useCreatures.js';

/**
 * Creatures and players: the creature spawners from the game data (`creatures.json`, optional in a dataset) as a map
 * layer with the kills from the save the timeline shows (`FactorySnapshot.spawners`), a sidebar panel with the
 * filters, and the players' characters from the same save with their own panel (show one on the map, open their statistics), and the death crates of the world's saves. The
 * switches sit in the tool navigation.
 */
export const creaturesFeature: FeatureModule = {
  id: 'creatures',
  sidebarPanels: [
    { id: 'creatures', order: 42, titleKey: 'creatures.title', Component: CreaturesPanel },
    { id: 'players', order: 43, titleKey: 'players.title', Component: PlayersPanel },
  ],
  searchProviders: [creaturesSearch],
  mapLayers: [
    { id: 'creatures', order: 7, Component: CreatureLayer },
    { id: 'death-crates', order: 8, Component: DeathCrateLayer },
    { id: 'players', order: 9, Component: PlayerLayer },
  ],
  tools: [
    toggleTool({
      id: 'creatures', order: 31, labelKey: 'creatures.control', hintKey: 'creatures.hint', icon: createElement(PawIcon),
      useToggle: () => ({ visible: useCreatureLayer(s => s.visible), toggle: useCreatureLayer(s => s.toggle) }),
      useAvailable: ctx => Boolean(useCreatureFile(ctx.me.datasetVersion)),
    }),
    toggleTool({
      id: 'players', order: 33, labelKey: 'creatures.playersControl', hintKey: 'creatures.playersHint', icon: createElement(PlayerIcon),
      useToggle: usePlayerToggle,
    }),
    toggleTool({
      id: 'death-crates', order: 34, labelKey: 'deathCrates.control', hintKey: 'deathCrates.hint', icon: createElement(CrateIcon),
      useToggle: useCrateToggle,
    }),
  ],
};
