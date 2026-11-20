import L from 'leaflet';
import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useMap } from 'react-leaflet';
import { summarize } from '../../../shared/factory/inventory.js';
import type { SnapshotCrate } from '../../../shared/factory/snapshot.js';
import { deathCrateHistory, DEATH_CRATE } from '../../../shared/factory/storage.js';
import { worldToLatLng } from '../../../shared/geo.js';
import type { WorldCtx } from '../../app/feature.js';
import { useFactoryData, type FactoryLabels } from '../factory/data.js';
import { useFactoryFormat, type FactoryFormat } from '../factory/format.js';
import { useCreatureLayer, useShownSnapshot } from './useCreatures.js';

const CRATE_PANE = 'ficsmap-death-crates';
/** Just below the players (470): a crate is where someone died, the player is who to look for. */
const CRATE_PANE_Z = 465;
/** Items listed in a crate's tooltip; the rest as "+N". */
const ITEMS_SHOWN = 6;

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/**
 * Where players died: every death crate in the world's saves up to the one the timeline shows (`deathCrateHistory`,
 * from the snapshot summaries, so no other snapshot is loaded), the deaths the Statistik page counts. A crate that
 * still lies there in the shown save is drawn full and its tooltip lists what is in it; one that is gone (looted, or
 * removed by the game) is faded and says when it was last seen.
 */
export function DeathCrateLayer({ ctx }: { ctx: WorldCtx }) {
  const visible = useCreatureLayer(s => s.crates);
  return visible ? <Crates ctx={ctx} /> : null;
}

function Crates({ ctx }: { ctx: WorldCtx }) {
  const map = useMap();
  const { t } = useTranslation();
  const fmt = useFactoryFormat();
  const { snapshot, summary, list } = useShownSnapshot(ctx.worldId);
  const labels = useFactoryData(ctx.me.datasetVersion, ctx.worldId)?.labels;
  const bounds = ctx.index.ds.bounds;
  const crates = useMemo(() => (list && summary ? deathCrateHistory(list, summary.saveTime) : []), [list, summary]);
  const present = useMemo(() => new Map((snapshot?.crates ?? []).filter(c => c.kind === DEATH_CRATE && c.id).map(c => [c.id!, c])), [snapshot]);

  useEffect(() => {
    if (!summary) return;
    const pane = map.getPane(CRATE_PANE) ?? map.createPane(CRATE_PANE);
    pane.style.zIndex = String(CRATE_PANE_Z);
    const markers = crates.map(c => {
      const here = present.get(c.id);
      const gone = c.lastSeen < summary.saveTime && !here;
      const title = t('factory.inventory.crate.death');
      const icon = L.divIcon({
        className: `ficsmap-crate${gone ? ' is-gone' : ''}`,
        html: '<span class="ficsmap-crate-box" aria-hidden="true"></span>',
        iconSize: [0, 0],
      });
      const m = L.marker(worldToLatLng(c.x, c.y, bounds), { icon, pane: CRATE_PANE, keyboard: true, title, alt: title }).addTo(map);
      m.bindTooltip(tooltip(c.firstSeen, c.lastSeen, gone, here, labels, fmt, t), { direction: 'top', offset: [0, -10], className: 'ficsmap-crate-tip' });
      return m;
    });
    return () => { for (const m of markers) m.remove(); };
  }, [map, crates, present, summary, bounds, labels, fmt, t]);

  return null;
}

function tooltip(
  firstSeen: number, lastSeen: number, gone: boolean, here: SnapshotCrate | undefined, labels: FactoryLabels | undefined,
  fmt: FactoryFormat, t: (k: string, o?: Record<string, unknown>) => string,
): string {
  const lines = [`<strong>${escapeHtml(t('factory.inventory.crate.death'))}</strong>`];
  lines.push(escapeHtml(gone ? t('deathCrates.gone', { date: fmt.dateShort(lastSeen) }) : t('deathCrates.here')));
  lines.push(`<span class="ficsmap-crate-muted">${escapeHtml(t('deathCrates.firstSeen', { date: fmt.dateShort(firstSeen) }))}</span>`);
  const items = here?.inv ? summarize(here.inv) : [];
  if (items.length > 0) {
    const shown = items.slice(0, ITEMS_SHOWN).map(l => `${escapeHtml(labels ? labels.item(l.item, fmt.lang) : l.item)} ×${fmt.int(l.total)}`);
    if (items.length > ITEMS_SHOWN) shown.push(escapeHtml(t('deathCrates.more', { count: items.length - ITEMS_SHOWN })));
    lines.push(`<span class="ficsmap-crate-items">${shown.join('<br>')}</span>`);
  } else if (here) {
    lines.push(escapeHtml(t('deathCrates.empty')));
  }
  return lines.join('<br>');
}
