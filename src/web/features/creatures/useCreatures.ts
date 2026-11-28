import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { create } from 'zustand';
import { CREATURE_FAMILIES, killsByName, killState, readCreatures, type CreatureFamily, type CreatureSpawner, type CreaturesFile, type KillState, type SpawnerKills } from '../../../shared/creatures.js';
import type { FactorySnapshot, SnapshotSummary } from '../../../shared/factory/snapshot.js';
import { api, ApiClientError } from '../../app/api.js';
import { queryKeys } from '../../app/queryKeys.js';
import { useSnapshot } from '../factory/api.js';
import { useTimeline } from '../factory/timeline.js';

/** The dataset's creature spawners: null for a dataset built without them, undefined while loading or not `enabled`. */
export function useCreatureFile(version: string, enabled = true): CreaturesFile | null | undefined {
  return useQuery({
    queryKey: queryKeys.creatures(version),
    enabled,
    queryFn: async () => {
      try {
        return await api<CreaturesFile>('GET', `/data/${encodeURIComponent(version)}/creatures.json`);
      } catch (e) {
        if (e instanceof ApiClientError && e.status === 404) return null;
        throw e;
      }
    },
    staleTime: Infinity,
  }).data;
}

/**
 * The snapshot of the save the timeline shows (the newest without a choice), shared with the factory map: undefined
 * while it loads, null without one.
 */
export function useShownSnapshot(worldId: string, enabled = true): { snapshot: FactorySnapshot | null | undefined; summary: SnapshotSummary | null; list: SnapshotSummary[] | undefined } {
  const sel = useTimeline(worldId);
  const id = enabled ? sel.selected?.id ?? null : null;
  const q = useSnapshot(worldId, id);
  const snapshot = id === null ? (sel.list === undefined ? undefined : null) : q.isError ? null : q.data;
  return { snapshot, summary: sel.selected, list: sel.list };
}

export interface CreatureData {
  spawners: CreatureSpawner[];
  /** Kills per spawner from the shown save; empty without a snapshot that has them. */
  kills: ReadonlyMap<string, SpawnerKills>;
  /** Whether the shown save reported kill state at all (snapshots before it was read do not). */
  hasKills: boolean;
  /** The shown save's time (unix ms), null without one. */
  saveTime: number | null;
}

const NO_KILLS: ReadonlyMap<string, SpawnerKills> = new Map();

export function useCreatureData(version: string, worldId: string, enabled = true): CreatureData | null | undefined {
  const file = useCreatureFile(version, enabled);
  const { snapshot, summary } = useShownSnapshot(worldId, enabled && !!file);
  const spawners = useMemo(() => (file ? readCreatures(file) : null), [file]);
  return useMemo(() => {
    if (file === undefined) return undefined;
    if (file === null || spawners === null) return null;
    const has = !!snapshot?.spawners;
    return { spawners, kills: has ? killsByName(snapshot!.spawners) : NO_KILLS, hasKills: has, saveTime: summary?.saveTime ?? null };
  }, [file, spawners, snapshot, summary]);
}

/** All spawners, or those in one kill state (`killState`); the three states add up to all. */
export type KillFilter = 'all' | KillState;
export const KILL_FILTERS: readonly KillFilter[] = ['all', 'dead', 'back', 'untouched'];

interface CreatureView { visible: boolean; hidden: CreatureFamily[]; kill: KillFilter; players: boolean; crates: boolean }
const KEY = 'ficsmap:creatures';
const DEFAULTS: CreatureView = { visible: false, hidden: [], kill: 'all', players: false, crates: false };

function load(): CreatureView {
  try {
    const d = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<CreatureView> | null;
    if (!d || typeof d !== 'object') return DEFAULTS;
    return {
      visible: d.visible === true,
      hidden: Array.isArray(d.hidden) ? d.hidden.filter((f): f is CreatureFamily => CREATURE_FAMILIES.includes(f)) : [],
      kill: KILL_FILTERS.includes(d.kill as KillFilter) ? d.kill! : 'all',
      players: d.players === true,
      crates: d.crates === true,
    };
  } catch {
    return DEFAULTS;
  }
}

function save(v: CreatureView): void {
  try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* remembering is best effort */ }
}

interface CreatureLayerState extends CreatureView {
  /** The player "Show" was chosen for (`SnapshotPlayer.name`), marked on the map until the layer goes off; not remembered. */
  focusedPlayer: string | null;
  toggle(): void;
  /** Switches the layer on. */
  show(): void;
  /** Switches the players on and marks one of them. */
  focusPlayer(name: string | null): void;
  toggleFamily(f: CreatureFamily): void;
  /** Switches the layer on with only this family shown (a search result). */
  showFamily(f: CreatureFamily): void;
  setKill(k: KillFilter): void;
  togglePlayers(): void;
  /** The death crates on the map (`DeathCrateLayer`). */
  toggleCrates(): void;
  showCrates(): void;
}

/** Whether the creature layer and the players show, and the creature filter; remembered per device. */
export const useCreatureLayer = create<CreatureLayerState>()((set, get) => {
  const update = (patch: Partial<CreatureView>) => {
    const s = { ...get(), ...patch };
    const v: CreatureView = { visible: s.visible, hidden: s.hidden, kill: s.kill, players: s.players, crates: s.crates };
    save(v);
    set(v);
  };
  return {
    ...load(),
    focusedPlayer: null,
    focusPlayer: name => { if (!get().players) update({ players: true }); set({ focusedPlayer: name }); },
    toggle: () => update({ visible: !get().visible }),
    show: () => { if (!get().visible) update({ visible: true }); },
    showFamily: f => update({ visible: true, hidden: CREATURE_FAMILIES.filter(x => x !== f) }),
    toggleFamily: f => { const h = get().hidden; update({ hidden: h.includes(f) ? h.filter(x => x !== f) : [...h, f] }); },
    setKill: kill => update({ kill }),
    toggleCrates: () => update({ crates: !get().crates }),
    showCrates: () => update({ crates: true }),
    togglePlayers: () => { update({ players: !get().players }); set({ focusedPlayer: null }); },
  };
});

/** For the death crates' switch in the tools. */
export function useCrateToggle(): { visible: boolean; toggle(): void } {
  const visible = useCreatureLayer(s => s.crates);
  const toggle = useCreatureLayer(s => s.toggleCrates);
  return { visible, toggle };
}

/** For the players' switch in the tools (`toggleTool` wants `visible` and `toggle`). */
export function usePlayerToggle(): { visible: boolean; toggle(): void } {
  const visible = useCreatureLayer(s => s.players);
  const toggle = useCreatureLayer(s => s.togglePlayers);
  return { visible, toggle };
}

export function filterSpawners(data: CreatureData, hidden: ReadonlySet<CreatureFamily>, kill: KillFilter): CreatureSpawner[] {
  return data.spawners.filter(s => {
    if (hidden.has(s.family)) return false;
    return kill === 'all' || killState(data.kills.get(s.name)) === kill;
  });
}
