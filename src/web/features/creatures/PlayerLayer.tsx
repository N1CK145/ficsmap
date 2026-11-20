import L from 'leaflet';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useMap } from 'react-leaflet';
import { worldToLatLng } from '../../../shared/geo.js';
import type { WorldCtx } from '../../app/feature.js';
import { useCreatureLayer, useShownSnapshot } from './useCreatures.js';

const PLAYER_PANE = 'ficsmap-players';
/** Above the vehicle route (460) and the markers: few, and what the user looks for while this is on. */
const PLAYER_PANE_Z = 470;

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/**
 * Where the players' characters stand in the save the timeline shows (a character stays in the world while its
 * player is offline): a white dot with the name on an accent plate (unlike the save's own map markers). The player
 * chosen with "Show" (Players panel, Statistik page) is drawn larger, with a pulse. Players without a character in
 * the save are left out.
 */
export function PlayerLayer({ ctx }: { ctx: WorldCtx }) {
  const map = useMap();
  const { t } = useTranslation();
  const visible = useCreatureLayer(s => s.players);
  const focused = useCreatureLayer(s => s.focusedPlayer);
  const { snapshot } = useShownSnapshot(ctx.worldId, visible);
  const bounds = ctx.index.ds.bounds;

  useEffect(() => {
    if (!visible || !snapshot?.players) return;
    const pane = map.getPane(PLAYER_PANE) ?? map.createPane(PLAYER_PANE);
    pane.style.zIndex = String(PLAYER_PANE_Z);
    const markers = snapshot.players.filter(p => p.pos).map(p => {
      const [x, y] = p.pos!;
      const name = p.name ?? t('stats.unnamed');
      const icon = L.divIcon({
        className: `ficsmap-player${focused === null ? '' : p.name === focused ? ' is-focused' : ' is-dimmed'}`,
        html: `<span class="ficsmap-player-dot" aria-hidden="true"></span><span class="ficsmap-player-name">${escapeHtml(name)}</span>`,
        iconSize: [0, 0],
      });
      return L.marker(worldToLatLng(x, y, bounds), { icon, pane: PLAYER_PANE, keyboard: false, interactive: false, title: name, zIndexOffset: p.name === focused ? 1000 : 0 }).addTo(map);
    });
    return () => { for (const m of markers) m.remove(); };
  }, [map, visible, focused, snapshot, bounds, t]);

  return null;
}
