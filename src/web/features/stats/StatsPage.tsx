import { useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router';
import { worldToLatLng } from '../../../shared/geo.js';
import { killsByName, killSummary } from '../../../shared/creatures.js';
import { countDeaths } from '../../../shared/factory/storage.js';
import { statsViews, type BuiltRow, type CountRow, type PlayerStats, type WorldStats } from '../../../shared/factory/statsView.js';
import type { WorldCtx } from '../../app/feature.js';
import { worldPath } from '../../app/pages.js';
import { Button, buttonClass } from '../../components/Button.js';
import { MapIcon } from '../../components/icons.js';
import { SegmentedControl } from '../../components/SegmentedControl.js';
import { StatTile } from '../../components/StatRow.js';
import { Window } from '../../components/Window.js';
import { PLAYER_PARAM } from '../creatures/PlayersPanel.js';
import { useCreatureLayer, useShownSnapshot } from '../creatures/useCreatures.js';
import { creatureIcon, useCreatureName } from '../creatures/names.js';
import { useFactoryData, type FactoryLabels } from '../factory/data.js';
import { nearestBiome, useFactoryFormat, type FactoryFormat } from '../factory/format.js';
import { TABLE, TD, TD_FIRST, TH, THEAD, TR } from '../factory/parts.js';
import { Timeline } from '../factory/Timeline.js';
import { useFactoryWorld, useTimeline } from '../factory/timeline.js';
import { GameIcon, IconsContext, useItemIcons } from '../machineWiki/icons.js';
import { useMapFit } from '../search/fit.js';

/** The world page id: `/w/:id/stats`. */
export const STATS_PAGE = 'stats';
const WORLD = '__world__';
/** Rows shown before "Show all". */
const FIRST_ROWS = 10;

/**
 * "Statistik" (`/w/:id/stats`): the game's own statistics of the save the timeline shows, for the world or one player
 * (switch on top). The world: play time, deaths (counted from death crates over the saves), creatures killed,
 * consumables used, buildings built and dismantled, items crafted by hand and picked up. A player: what the game counts
 * per player (built, dismantled, crafted, picked up) and where the character stands. Shares the save choice with the
 * Fabrik page and the map.
 */
export function StatsPage({ ctx }: { ctx: WorldCtx }) {
  const { t } = useTranslation();
  const fmt = useFactoryFormat();
  useFactoryWorld(ctx.worldId);
  const version = ctx.me.datasetVersion;
  const icons = useItemIcons(version);
  const sel = useTimeline(ctx.worldId);
  const { snapshot } = useShownSnapshot(ctx.worldId);
  const labels = useFactoryData(version, ctx.worldId)?.labels;
  const views = useMemo(() => (snapshot ? statsViews(snapshot) : null), [snapshot]);
  // The player shown is in the URL (`?p=<name>`), so the Players panel can link to one and the choice survives a reload.
  const [params, setParams] = useSearchParams();
  const view = params.get(PLAYER_PARAM) ?? WORLD;
  const setView = (v: string) => setParams(p => {
    const next = new URLSearchParams(p);
    if (v === WORLD) next.delete(PLAYER_PARAM); else next.set(PLAYER_PARAM, v);
    return next;
  }, { replace: true, preventScrollReset: true });

  if (sel.failed) return <p role="alert" className="text-conflict">{t('factory.loadFailed')}</p>;
  if (sel.list === undefined) return <p className="text-muted">{t('common.loading')}</p>;
  if (sel.ordered.length === 0) return <p className="text-muted">{t('stats.empty')}</p>;

  const player = views?.players.find(p => p.key === view);
  const options = [
    { value: WORLD, label: t('stats.world') },
    ...(views?.players ?? []).map(p => ({ value: p.key, label: p.unassigned ? t('stats.unassigned') : p.name ?? t('stats.unnamed') })),
  ];
  const deaths = sel.selected ? countDeaths(sel.list, sel.selected.saveTime) : null;
  return (
    <IconsContext.Provider value={icons}>
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-3">
        <Timeline sel={sel} fmt={fmt} loading={snapshot === undefined} compare={false} />
        {snapshot === undefined && <p className="text-muted">{t('common.loading')}</p>}
        {snapshot && !views && <p className="text-sm text-muted" data-testid="stats-unknown">{t('stats.unknown')}</p>}
        {views && labels && (
          <>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <SegmentedControl label={t('stats.viewLabel')} options={options} value={player ? view : WORLD} onChange={setView} />
            </div>
            {player
              ? <PlayerView ctx={ctx} p={player} labels={labels} fmt={fmt} hasUnassigned={views.players.some(x => x.unassigned)} />
              : <WorldView w={views.world} players={views.players} spawnerKills={snapshot?.spawners ? killSummary(killsByName(snapshot.spawners), views.world.totals.killed) : null} deaths={deaths} labels={labels} fmt={fmt} version={version} onPlayer={setView} />}
          </>
        )}
      </div>
    </IconsContext.Provider>
  );
}

function playTime(sec: number, t: (k: string, o?: Record<string, unknown>) => string): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return t('stats.playTimeValue', { h, m });
}

function WorldView({ w, players, spawnerKills, deaths, labels, fmt, version, onPlayer }: {
  w: WorldStats; players: readonly PlayerStats[]; spawnerKills: ReturnType<typeof killSummary> | null; deaths: { deaths: number; known: boolean } | null;
  labels: FactoryLabels; fmt: FactoryFormat; version: string; onPlayer(key: string): void;
}) {
  const { t } = useTranslation();
  const creature = useCreatureName();
  const item = (cls: string) => labels.item(cls, fmt.lang);
  return (
    <>
      <dl aria-label={t('stats.figures')} className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-8">
        <StatTile label={t('stats.playTime')} main className="col-span-2">{w.playTimeSec === null ? '–' : playTime(w.playTimeSec, t)}</StatTile>
        {/* The game keeps no death count: a lower bound from death crates, said as one ("≥ 3"), never a bare 0. */}
        <StatTile label={t('stats.deaths')} sub={deaths?.known === false ? t('stats.deathsPartial') : t('stats.deathsHint')}>
          <span data-testid="stats-deaths">
            {!deaths ? '–' : deaths.deaths > 0 ? t('stats.deathsValue', { count: deaths.deaths }) : <span className="text-base text-muted">{t('stats.noDeaths')}</span>}
          </span>
        </StatTile>
        <StatTile label={t('stats.killed')} sub={spawnerKills ? t('stats.killedOnSpawners', { kills: spawnerKills.kills, spawners: spawnerKills.spawners, without: spawnerKills.withoutSpawner }) : undefined}>{fmt.int(w.totals.killed)}</StatTile>
        <StatTile label={t('stats.built')} sub={t('stats.standing', { count: w.totals.current })}>{fmt.int(w.totals.built)}</StatTile>
        <StatTile label={t('stats.dismantled')}>{fmt.int(w.totals.dismantled)}</StatTile>
        <StatTile label={t('stats.crafted')}>{fmt.int(w.totals.crafted)}</StatTile>
        <StatTile label={t('stats.pickedUp')}>{fmt.int(w.totals.pickedUp)}</StatTile>
      </dl>
      <PlayersTable players={players} fmt={fmt} labels={labels} onPlayer={onPlayer} />
      <div className="grid gap-3 lg:grid-cols-2 lg:items-start">
        <CountList id="killed" title={t('stats.killedTitle')} rows={w.killed} name={creature}
          icon={cls => <img src={creatureIcon(version, cls)} alt="" width={20} height={20} className="shrink-0 chamfer bg-cr-disc p-px" />} fmt={fmt} empty={t('stats.none')} />
        <CountList id="crafted" title={t('stats.craftedTitle')} rows={w.crafted} name={item} fmt={fmt} empty={t('stats.none')} />
        <CountList id="picked" title={t('stats.pickedUpTitle')} rows={w.pickedUp} name={item} fmt={fmt} empty={t('stats.none')} />
        {w.produced.length > 0 && <CountList id="produced" title={t('stats.producedTitle')} rows={w.produced} name={item} fmt={fmt} empty={t('stats.none')} />}
        {/* Short (nuts, berries, medkits): last, so it does not stand as an empty box beside the long kill list. */}
        <CountList id="consumed" title={t('stats.consumedTitle')} rows={w.consumed} name={item} fmt={fmt} empty={t('stats.none')} />
      </div>
      <BuiltTable rows={w.built} labels={labels} fmt={fmt} world />
    </>
  );
}

function PlayerView({ ctx, p, labels, fmt, hasUnassigned }: { ctx: WorldCtx; p: PlayerStats; labels: FactoryLabels; fmt: FactoryFormat; hasUnassigned: boolean }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const item = (cls: string) => labels.item(cls, fmt.lang);
  const where = p.pos ? nearestBiome(ctx.index, p.pos[0], p.pos[1], fmt.lang) : undefined;
  // Switches the players on, marks this one and fits the map to a small area around the character.
  const showPlayers = () => {
    if (!p.pos) return;
    useCreatureLayer.getState().focusPlayer(p.name);
    const [lat, lng] = worldToLatLng(p.pos[0], p.pos[1], ctx.index.ds.bounds);
    const d = 2;
    useMapFit.getState().fit([[lat - d, lng - d], [lat + d, lng + d]]);
    void navigate(worldPath(ctx.worldId));
  };
  return (
    <>
      <dl aria-label={t('stats.figures')} className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatTile label={t('stats.built')} main={p.totals.built > 0}>{fmt.int(p.totals.built)}</StatTile>
        <StatTile label={t('stats.dismantled')}>{fmt.int(p.totals.dismantled)}</StatTile>
        <StatTile label={t('stats.crafted')}>{fmt.int(p.totals.crafted)}</StatTile>
        <StatTile label={t('stats.pickedUp')}>{fmt.int(p.totals.pickedUp)}</StatTile>
      </dl>
      {!p.unassigned && <div className="flex flex-wrap items-center gap-x-3 gap-y-1 chamfer border border-line bg-panel px-3 py-2 text-sm" data-testid="stats-position">
        <span className="font-semibold">{t('stats.position')}</span>
        <span className="text-muted">{p.pos ? (where ? t('stats.near', { biome: where }) : t('stats.onMap')) : t('stats.noPosition')}</span>
        {p.pos && (
          <button type="button" onClick={showPlayers} className={`ml-auto ${buttonClass({ variant: 'ghost', size: 'sm' })}`}>
            <MapIcon />{t('factory.showOnMap')}
          </button>
        )}
      </div>}
      <p className="text-xs text-muted">{t(p.unassigned ? 'stats.unassignedNote' : 'stats.perPlayerNote')}</p>
      {/* Playing (a character in the world) but nothing counted: the game made a new player id, the old counts are unassigned. */}
      {!p.unassigned && hasUnassigned && p.pos && p.totals.built + p.totals.crafted + p.totals.pickedUp === 0 && (
        <p className="chamfer border border-line border-l-4 border-l-accent bg-panel px-3 py-2 text-sm" data-testid="stats-new-id">{t('stats.newId')}</p>
      )}
      <div className="grid gap-3 lg:grid-cols-2 lg:items-start">
        <CountList id="crafted" title={t('stats.craftedTitle')} rows={p.crafted} name={item} fmt={fmt} empty={t('stats.none')} />
        <CountList id="picked" title={t('stats.pickedUpTitle')} rows={p.pickedUp} name={item} fmt={fmt} empty={t('stats.none')} />
      </div>
      <BuiltTable rows={p.built} labels={labels} fmt={fmt} world={false} />
    </>
  );
}

function ShowAll({ total, all, setAll }: { total: number; all: boolean; setAll(f: (x: boolean) => boolean): void }) {
  const { t } = useTranslation();
  if (total <= FIRST_ROWS) return null;
  return (
    <div className="px-3 pt-1">
      <Button variant="ghost" size="sm" onClick={() => setAll(x => !x)} aria-expanded={all}>
        {all ? t('factory.showFewer') : t('factory.showAll', { count: total })}
      </Button>
    </div>
  );
}

/** Classes with a count, most first: picture, name, count; the first rows, then "Show all". */
function CountList({ id, title, rows, name, icon, fmt, empty }: {
  id: string; title: string; rows: readonly CountRow[]; name(cls: string): string; icon?: (cls: string) => ReactNode; fmt: FactoryFormat; empty: string;
}) {
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, FIRST_ROWS);
  const total = rows.reduce((n, r) => n + r[1], 0);
  return (
    <Window title={title} subtitle={rows.length > 0 ? fmt.int(total) : undefined} bodyClassName="py-2" as="section">
      {rows.length === 0 ? <p className="px-3 text-sm text-muted">{empty}</p> : (
        <ul className="flex flex-col px-3 text-sm" data-testid={`stats-${id}`}>
          {shown.map(([cls, n]) => {
            const label = name(cls);
            return (
              <li key={cls} className="flex min-w-0 items-center gap-2 border-b border-line/60 py-1 last:border-b-0">
                {icon ? icon(cls) : <GameIcon cls={cls} px={20} placeholder />}
                <span className="min-w-0 flex-1 truncate" title={label}>{label}</span>
                <span className="shrink-0 font-display font-semibold tabular-nums">{fmt.int(n)}</span>
              </li>
            );
          })}
        </ul>
      )}
      <ShowAll total={rows.length} all={all} setAll={setAll} />
    </Window>
  );
}

/** Buildings per class: built, dismantled, and for the world how many stand now and the most at once. */
function BuiltTable({ rows, labels, fmt, world }: { rows: readonly BuiltRow[]; labels: FactoryLabels; fmt: FactoryFormat; world: boolean }) {
  const { t } = useTranslation();
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, FIRST_ROWS);
  const cols = { built: t('stats.colBuilt'), dismantled: t('stats.colDismantled'), current: t('stats.colCurrent'), max: t('stats.colMax') };
  return (
    <Window title={t('stats.builtTitle')} subtitle={t('stats.builtSubtitle', { count: rows.length })} bodyClassName="py-2" as="section" className={world ? '' : 'max-w-3xl'}>
      {rows.length === 0 ? <p className="px-3 text-sm text-muted">{t('stats.none')}</p> : (
        <table role="table" className={TABLE} data-testid="stats-built">
          <thead role="rowgroup" className={THEAD}>
            <tr role="row">
              <th role="columnheader" scope="col" className={TH}>{t('stats.colBuilding')}</th>
              <th role="columnheader" scope="col" className={`${TH} text-right`}>{cols.built}</th>
              <th role="columnheader" scope="col" className={`${TH} text-right`}>{cols.dismantled}</th>
              {world && <th role="columnheader" scope="col" className={`${TH} text-right`}>{cols.current}</th>}
              {world && <th role="columnheader" scope="col" className={`${TH} text-right`}>{cols.max}</th>}
            </tr>
          </thead>
          <tbody role="rowgroup" className="max-sm:block">
            {shown.map(r => {
              const name = labels.building(r.cls, fmt.lang);
              const num = (label: string, n: number | undefined) => (
                <td role="cell" className={`${TD} text-right`}><span aria-hidden="true" className="text-xs text-muted sm:hidden">{label}</span>{n === undefined ? '–' : fmt.int(n)}</td>
              );
              return (
                <tr key={r.cls} role="row" className={`${TR} max-sm:first:border-t-0`}>
                  <td role="cell" className={TD_FIRST}>
                    <span className="flex min-w-0 items-center gap-2">
                      <GameIcon cls={labels.buildingPicture(r.cls)} px={20} placeholder />
                      <span className="min-w-0 truncate" title={name}>{name}</span>
                    </span>
                  </td>
                  {num(cols.built, r.built)}
                  {num(cols.dismantled, r.dismantled)}
                  {world && num(cols.current, r.current)}
                  {world && num(cols.max, r.max)}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <ShowAll total={rows.length} all={all} setAll={setAll} />
    </Window>
  );
}

/**
 * The players side by side (the world view): what the game counts per player, the unassigned counts last, most
 * built first; a name opens that player's view.
 */
function PlayersTable({ players, fmt, labels, onPlayer }: { players: readonly PlayerStats[]; fmt: FactoryFormat; labels: FactoryLabels; onPlayer(key: string): void }) {
  const { t } = useTranslation();
  const hasUnassigned = players.some(p => p.unassigned);
  if (players.length === 0) return null;
  const cols = { built: t('stats.colBuilt'), dismantled: t('stats.colDismantled'), crafted: t('stats.colCrafted'), picked: t('stats.colPickedUp'), top: t('stats.colTop') };
  return (
    <Window title={t('stats.playersTitle')} bodyClassName="py-2" as="section" className="max-w-5xl">
      <table role="table" className={TABLE} data-testid="stats-players">
        <thead role="rowgroup" className={THEAD}>
          <tr role="row">
            <th role="columnheader" scope="col" className={TH}>{t('stats.colPlayer')}</th>
            <th role="columnheader" scope="col" className={`${TH} text-right`}>{cols.built}</th>
            <th role="columnheader" scope="col" className={`${TH} text-right`}>{cols.dismantled}</th>
            <th role="columnheader" scope="col" className={`${TH} text-right`}>{cols.crafted}</th>
            <th role="columnheader" scope="col" className={`${TH} text-right`}>{cols.picked}</th>
            <th role="columnheader" scope="col" className={TH}>{cols.top}</th>
          </tr>
        </thead>
        <tbody role="rowgroup" className="max-sm:block">
          {players.map(p => {
            const name = p.unassigned ? t('stats.unassigned') : p.name ?? t('stats.unnamed');
            const top = p.built[0];
            // In the world but nothing counted while unassigned counts exist: the game gave the player a new id.
            const reset = !p.unassigned && hasUnassigned && p.pos !== null && p.totals.built + p.totals.crafted + p.totals.pickedUp === 0;
            const num = (label: string, n: number) => (
              <td role="cell" className={`${TD} text-right`}><span aria-hidden="true" className="text-xs text-muted sm:hidden">{label}</span>{reset ? '–' : fmt.int(n)}</td>
            );
            return (
              <tr key={p.key} role="row" className={`${TR} max-sm:first:border-t-0`}>
                <td role="cell" className={TD_FIRST}>
                  <button type="button" onClick={() => onPlayer(p.key)} className={`text-left font-semibold underline-offset-2 hover:underline focus-ring ${p.unassigned ? 'text-muted' : 'text-accent'}`}>
                    {name}
                  </button>
                  {reset && <span className="ml-2 chamfer border border-line px-1.5 text-xs text-muted" title={t('stats.newId')}>{t('stats.newIdTag')}</span>}
                </td>
                {num(cols.built, p.totals.built)}
                {num(cols.dismantled, p.totals.dismantled)}
                {num(cols.crafted, p.totals.crafted)}
                {num(cols.picked, p.totals.pickedUp)}
                <td role="cell" className={`${TD} max-sm:col-span-2 max-sm:items-center`}>
                  <span aria-hidden="true" className="text-xs text-muted sm:hidden">{cols.top}</span>
                  {top ? <span className="flex min-w-0 items-center gap-2"><GameIcon cls={labels.buildingPicture(top.cls)} px={20} placeholder /><span className="min-w-0 truncate max-sm:whitespace-normal">{labels.building(top.cls, fmt.lang)} · {fmt.int(top.built)}</span></span> : '–'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Window>
  );
}
