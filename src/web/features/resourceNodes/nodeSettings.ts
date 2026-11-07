import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { changedNodeSettings, type NodeSettings } from '../../../shared/resourceNodes.js';

/**
 * The world's changed node settings in the UI language, with the names the game's own settings use (string table
 * `Menus_UI`, keys `Games/GameModes/ResourceRandom*` and `.../ResourceNodePurity*`, mapped to the enum values by the
 * settings assets `US_GM_ResourceRandomization` and `US_GM_NodePurity`, build 517554), e.g. "Resource Node
 * Randomization: Basic Resource Rich". A value this version does not know shows as the save stores it.
 */
export function useNodeSettingsText(): (s: NodeSettings | null) => string {
  const { t } = useTranslation();
  return useCallback((s: NodeSettings | null) => changedNodeSettings(s).map(c => t('resourceNodes.nodeSettings.entry', {
    name: t(`resourceNodes.nodeSettings.${c.setting}`),
    value: c.member === null ? c.raw : t(`resourceNodes.nodeSettings.${c.setting}Values.${c.member}`),
  })).join('; '), [t]);
}
