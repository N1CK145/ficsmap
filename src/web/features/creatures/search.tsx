import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { CREATURE_FAMILIES, type CreatureFamily } from '../../../shared/creatures.js';
import { worldToLatLng } from '../../../shared/geo.js';
import type { SearchEntry, SearchProvider, WorldCtx } from '../../app/feature.js';
import { PlayerIcon } from '../../components/icons.js';
import { useMapFit } from '../search/fit.js';
import { FAMILY_SWATCH } from './CreaturesPanel.js';
import { useCreatureData, useCreatureLayer, useShownSnapshot } from './useCreatures.js';

const ORDER = 37;
const AROUND = 2;

/**
 * The creature families ("Keiler", with their number of spawn points) and the players with a character in the shown
 * save, in the header search: the keyboard's way to the canvas layers (with `actors: []`, so choosing one on a page goes to the map). A family switches the creature layer on with
 * only that family; a player switches the players on, marks them and fits the map to them.
 */
function useCreatureEntries(ctx: WorldCtx, active: boolean): readonly SearchEntry[] | undefined {
  const { i18n } = useTranslation();
  const { language } = i18n;
  const data = useCreatureData(ctx.me.datasetVersion, ctx.worldId, active);
  const { snapshot } = useShownSnapshot(ctx.worldId, active);
  return useMemo(() => {
    if (!active || data === undefined) return undefined;
    const lang = language === 'de' ? 'de' : 'en';
    const t = i18n.getFixedT(lang);
    const fixed = { en: i18n.getFixedT('en'), de: i18n.getFixedT('de') };
    const out: SearchEntry[] = [];
    if (data) {
      const count = new Map<CreatureFamily, number>();
      for (const s of data.spawners) count.set(s.family, (count.get(s.family) ?? 0) + 1);
      for (const f of CREATURE_FAMILIES) {
        const n = count.get(f);
        if (!n) continue;
        out.push({
          id: `creatures:${f}`,
          label: t(`creatures.family.${f}`),
          detail: t('creatures.search.spawners', { count: n }),
          kindKey: 'search.kind.creature',
          terms: [fixed.en(`creatures.family.${f}`), fixed.de(`creatures.family.${f}`), f],
          actors: [],
          weight: ORDER,
          icon: <span aria-hidden="true" className={`inline-block size-3 rotate-45 ${FAMILY_SWATCH[f]}`} />,
          onSelect: () => useCreatureLayer.getState().showFamily(f),
        });
      }
    }
    for (const p of snapshot?.players ?? []) {
      if (!p.pos || !p.name) continue;
      const [x, y] = p.pos;
      out.push({
        id: `player:${p.name}`,
        label: p.name,
        kindKey: 'search.kind.player',
        terms: [p.name],
        actors: [],
        weight: ORDER,
        icon: <PlayerIcon className="text-accent" />,
        onSelect: () => {
          useCreatureLayer.getState().focusPlayer(p.name!);
          const [lat, lng] = worldToLatLng(x, y, ctx.index.ds.bounds);
          useMapFit.getState().fit([[lat - AROUND, lng - AROUND], [lat + AROUND, lng + AROUND]]);
        },
      });
    }
    return out;
  }, [active, data, snapshot, language, i18n, ctx.index]);
}

export const creaturesSearch: SearchProvider = { id: 'creatures', order: ORDER, useEntries: useCreatureEntries };
