import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { worldToLatLng } from '../../../shared/geo.js';
import { worldPath } from '../../app/pages.js';
import { buttonClass } from '../../components/Button.js';
import { PlayerIcon, StatsIcon } from '../../components/icons.js';
import { useFactoryFormat } from '../factory/format.js';
import { useDataset } from '../map/useDataset.js';
import { useMapFit } from '../search/fit.js';
import { useMe } from '../worlds/queries.js';
import { useCreatureLayer, useShownSnapshot } from './useCreatures.js';

const ROW = 'flex h-8 w-full items-center gap-2 chamfer px-2 text-left text-sm select-none focus-ring hover:bg-raised max-[899px]:h-11';
/** Half the side of the area the map fits to around a player (map units; the fit caps the zoom). */
const AROUND = 2;

/** `?p=<key>` on the Statistik page opens that player (`StatsPage`). */
export const PLAYER_PARAM = 'p';

/**
 * The Players panel: the players' layer switch, and per player of the shown save its name, "Show" for one with a
 * character in the world (switches the layer on, marks the player and fits the map to them; "not in the world" else)
 * and a link to their statistics.
 */
export function PlayersPanel({ worldId }: { worldId: string }) {
  const { t } = useTranslation();
  const fmt = useFactoryFormat();
  const version = useMe().data?.datasetVersion;
  const index = useDataset(version ?? '');
  const visible = useCreatureLayer(s => s.players);
  const focused = useCreatureLayer(s => s.focusedPlayer);
  const { togglePlayers, focusPlayer } = useCreatureLayer.getState();
  const { snapshot, summary } = useShownSnapshot(worldId);
  const named = (snapshot?.players ?? []).filter(p => p.name);
  const placed = named.filter(p => p.pos);

  const show = (name: string, pos: [number, number, number]) => {
    focusPlayer(name);
    if (!index) return;
    const [lat, lng] = worldToLatLng(pos[0], pos[1], index.ds.bounds);
    useMapFit.getState().fit([[lat - AROUND, lng - AROUND], [lat + AROUND, lng + AROUND]]);
  };

  return (
    <div className="flex flex-col gap-3">
      <button type="button" aria-pressed={visible} onClick={togglePlayers} className={`${ROW} justify-between border border-line`}>
        <span>{t('players.show')}</span>
        <span className={visible ? 'text-accent' : 'text-muted'}>{t(visible ? 'resourceNodes.on' : 'resourceNodes.off')}</span>
      </button>
      {snapshot && placed.length === 0 && <p className="text-sm text-muted">{t('players.none')}</p>}
      {named.length > 0 && (
        <ul className="flex flex-col gap-1" data-testid="players-list">
          {named.map(p => (
            <li key={p.id} className={`flex min-w-0 items-center gap-2 chamfer border px-2 py-1 ${focused === p.name && visible ? 'border-accent bg-accent/10' : 'border-line'}`}>
              <PlayerIcon className={p.pos ? 'text-accent' : 'text-muted'} />
              <span className={`min-w-0 flex-1 truncate text-sm ${p.pos ? 'font-semibold' : 'text-muted'}`} title={p.name}>{p.name}</span>
              {p.pos
                ? <button type="button" onClick={() => show(p.name!, p.pos!)} aria-label={`${t('players.center')}: ${p.name}`} className={buttonClass({ variant: 'ghost', size: 'sm' })}>{t('players.center')}</button>
                : <span className="shrink-0 text-xs text-muted">{t('players.away')}</span>}
              <Link
                to={`${worldPath(worldId, 'stats')}?${PLAYER_PARAM}=${encodeURIComponent(p.name!)}`}
                aria-label={`${t('players.stats')}: ${p.name}`} title={t('players.stats')}
                className={buttonClass({ variant: 'ghost', size: 'sm' })}
              >
                <StatsIcon />
              </Link>
            </li>
          ))}
        </ul>
      )}
      {summary && <p className="text-xs text-muted">{t('players.source', { date: fmt.dateShort(summary.saveTime) })}</p>}
    </div>
  );
}
