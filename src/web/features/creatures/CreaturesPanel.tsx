import { useId, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { CREATURE_FAMILIES, killSummary, type CreatureFamily } from '../../../shared/creatures.js';
import { useMe } from '../worlds/queries.js';
import { useFactoryFormat } from '../factory/format.js';
import { filterSpawners, KILL_FILTERS, useCreatureData, useCreatureLayer } from './useCreatures.js';

const ROW = 'flex h-8 w-full items-center gap-2 chamfer px-2 text-left text-sm select-none focus-ring hover:bg-raised max-[899px]:h-11';
export const FAMILY_SWATCH: Record<CreatureFamily, string> = {
  hog: 'bg-cr-hog', spitter: 'bg-cr-spitter', stinger: 'bg-cr-stinger', hatcher: 'bg-cr-hatcher', wildlife: 'bg-cr-wildlife',
};

/**
 * The Creatures panel: the layer switch, the filter by kill state (all, dead right now, back again, never killed; the
 * three states add up to all) and by family, each with its count, the save's kill figures (`killSummary`, the same as
 * on the Statistik page) and the legend of the map's shapes.
 */
export function CreaturesPanel({ worldId }: { worldId: string }) {
  const { t } = useTranslation();
  const fmt = useFactoryFormat();
  const version = useMe().data?.datasetVersion;
  const visible = useCreatureLayer(s => s.visible);
  const hidden = useCreatureLayer(s => s.hidden);
  const kill = useCreatureLayer(s => s.kill);
  const { toggle, toggleFamily, setKill } = useCreatureLayer.getState();
  const data = useCreatureData(version ?? '', worldId, version !== undefined);
  const familyLabel = useId();
  const killLabel = useId();
  const radioName = useId();

  const counts = useMemo(() => {
    if (!data) return null;
    const byFamily = new Map<CreatureFamily, number>();
    for (const s of filterSpawners(data, new Set(), kill)) byFamily.set(s.family, (byFamily.get(s.family) ?? 0) + 1);
    const byKill = Object.fromEntries(KILL_FILTERS.map(k => [k, filterSpawners(data, new Set(hidden), k).length]));
    return { byFamily, byKill, summary: killSummary(data.kills, null) };
  }, [data, kill, hidden]);

  if (data === null) return <p className="text-sm text-muted">{t('creatures.none')}</p>;
  if (data === undefined || !counts) return null;
  const families = CREATURE_FAMILIES.filter(f => data.spawners.some(s => s.family === f));
  return (
    <div className="flex flex-col gap-3">
      <button type="button" aria-pressed={visible} onClick={toggle} className={`${ROW} justify-between border border-line`}>
        <span>{t('creatures.show')}</span>
        <span className={visible ? 'text-accent' : 'text-muted'}>{t(visible ? 'resourceNodes.on' : 'resourceNodes.off')}</span>
      </button>

      <fieldset className="min-w-0" disabled={!data.hasKills}>
        <legend id={killLabel} className="mb-1 text-xs text-muted">{t('creatures.killLabel')}</legend>
        <div className="flex flex-col">
          {KILL_FILTERS.map(k => (
            <label key={k} className={`${ROW} cursor-pointer has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent ${kill === k ? 'text-fg' : 'text-muted'} has-[:disabled]:cursor-default has-[:disabled]:opacity-50`}>
              <input type="radio" name={radioName} value={k} checked={kill === k} onChange={() => setKill(k)} className="size-3.5 shrink-0 accent-accent" />
              <span className="min-w-0 flex-1 truncate">{t(`creatures.kill.${k}`)}</span>
              <span className="shrink-0 font-display tabular-nums">{fmt.int(counts.byKill[k] ?? 0)}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <p className="-mt-2 text-xs text-muted" data-testid="creatures-source">
        {data.hasKills && data.saveTime !== null
          ? t('creatures.source', { kills: counts.summary.kills, spawners: counts.summary.spawners, date: fmt.dateShort(data.saveTime) })
          : t('creatures.noKillData')}
      </p>

      <div>
        <div id={familyLabel} className="mb-1 text-xs text-muted">{t('creatures.familyLabel')}</div>
        <ul aria-labelledby={familyLabel} className="flex flex-col">
          {families.map(f => {
            const on = !hidden.includes(f);
            return (
              <li key={f}>
                <button type="button" aria-pressed={on} onClick={() => toggleFamily(f)} className={`${ROW} ${on ? 'text-fg' : 'text-muted'}`}>
                  <span aria-hidden="true" className={`size-2.5 shrink-0 rotate-45 ${FAMILY_SWATCH[f]} ${on ? '' : 'opacity-40'}`} />
                  <span className="min-w-0 flex-1 truncate">{t(`creatures.family.${f}`)}</span>
                  <span className="shrink-0 font-display tabular-nums">{fmt.int(counts.byFamily.get(f) ?? 0)}</span>
                </button>
              </li>
            );
          })}
        </ul>
        <p className="mt-1 text-xs text-muted">{t('creatures.legend')}</p>
      </div>
    </div>
  );
}
