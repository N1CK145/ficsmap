import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { indexBuildings, type BuildingCategory, type BuildingIndex, type BuildingsFile } from '../../../shared/buildings.js';
import { analyzeFactory, analyzeRoutes, diffFactory, type AnalysisData, type FactoryAnalysis, type FactoryDiff, type RouteAnalysis } from '../../../shared/factory/analysis.js';
import type { FactorySnapshot } from '../../../shared/factory/snapshot.js';
import { descriptorClass, type MachineData } from '../../../shared/machines.js';
import type { Names, RecipeIndex } from '../../../shared/recipes.js';
import { api, ApiClientError } from '../../app/api.js';
import { useMachineData } from '../machineWiki/useMachineWiki.js';
import { useRecipes } from '../planner/useRecipes.js';
import { useWorldNodes } from '../resourceNodes/useResourceNodes.js';
import { useSnapshot } from './api.js';

/**
 * The dataset's `buildings.json` (names, pictures and footprints of every buildable): null for a dataset without it,
 * undefined while loading.
 */
export function useBuildings(version: string, enabled = true): BuildingIndex | null | undefined {
  return useQuery({
    queryKey: ['buildings', version],
    enabled,
    queryFn: async () => {
      try {
        return indexBuildings(await api<BuildingsFile>('GET', `/data/${encodeURIComponent(version)}/buildings.json`));
      } catch (e) {
        if (e instanceof ApiClientError && e.status === 404) return null;
        throw e;
      }
    },
    staleTime: Infinity,
  }).data;
}

/** `Build_GeneratorIntegratedBiomass_C` → "Generator Integrated Biomass": the last resort when no data names a class. */
export function prettyClass(cls: string): string {
  return cls.replace(/^(Build|BP|Desc|BUILD)_/i, '').replace(/_C$/, '').replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim();
}

/** Names and pictures of building, vehicle and item classes from whatever dataset parts there are. */
export interface FactoryLabels {
  building(cls: string, lang: keyof Names): string;
  /** Descriptor class of the building's picture (may have no file; `GameIcon` then shows nothing). */
  buildingPicture(cls: string): string;
  /** The building's category from `buildings.json` (undefined without it). */
  category(cls: string): BuildingCategory | undefined;
  item(cls: string, lang: keyof Names): string;
  isFluid(item: string): boolean;
}

/**
 * The named building a nameless class is a variant of: the class without `Integrated` (the HUB's burner
 * `Build_GeneratorIntegratedBiomass_C` → `Build_GeneratorBiomass_C`), else the one named class that starts like it
 * (`Build_GeneratorBiomass_Automated_C`, the Biomass Burner). Undefined when there is none or more than one.
 */
export function namedVariant(cls: string, buildings: BuildingIndex): string | undefined {
  const named = (c: string) => { const b = buildings.get(c); return b && !b.missing?.includes('name') ? c : undefined; };
  const base = cls.replace('Integrated', '').replace(/_C$/, '');
  const direct = named(`${base}_C`);
  if (direct) return direct;
  const all = [...buildings.byCategory.values()].flat().filter(c => c.startsWith(`${base}_`) && named(c));
  return all.length === 1 ? all[0] : undefined;
}

export function factoryLabels(recipes: RecipeIndex | null, machines: MachineData | null, buildings: BuildingIndex | null): FactoryLabels {
  const wiki = new Map(machines?.machines.map(m => [m.id, m]) ?? []);
  const known = (cls: string, lang: keyof Names): string | undefined => {
    const b = buildings?.get(cls);
    if (b && !b.missing?.includes('name')) return b.name[lang];
    return wiki.get(cls)?.name[lang] ?? recipes?.machines.get(cls)?.name[lang] ?? recipes?.extractors.get(cls)?.name[lang]
      ?? wiki.get(descriptorClass(cls.replace(/^BP_/, 'Build_')))?.name[lang];
  };
  return {
    building: (cls, lang) => {
      const own = known(cls, lang);
      if (own) return own;
      // A part of another building without a name of its own (the HUB's burner): "Biomass Burner (HUB)".
      const b = buildings?.get(cls);
      const variant = buildings ? namedVariant(cls, buildings) : undefined;
      const host = b?.partOf?.length === 1 ? known(b.partOf[0]!, lang) : undefined;
      if (variant) return host ? `${known(variant, lang)} (${host})` : known(variant, lang)!;
      if (host) return host;
      return prettyClass(cls);
    },
    buildingPicture: cls => {
      const b = buildings?.get(cls);
      if (b?.icon) return b.icon;
      const variant = buildings && b?.missing?.includes('name') ? namedVariant(cls, buildings) : undefined;
      return (variant && buildings?.get(variant)?.icon) || descriptorClass(cls.replace(/^BP_/, 'Build_'));
    },
    category: cls => buildings?.get(cls)?.category,
    item: (cls, lang) => recipes?.items.get(cls)?.name[lang] ?? machines?.items[cls]?.name[lang] ?? prettyClass(cls),
    isFluid: item => {
      const form = recipes?.items.get(item)?.form ?? machines?.items[item]?.form;
      return form === 'liquid' || form === 'gas';
    },
  };
}

export interface FactoryData {
  /** What the analysis needs; null when the dataset has no recipe data (then there are no rates). */
  analysis: AnalysisData | null;
  labels: FactoryLabels;
}

/**
 * The dataset parts the factory views read: recipes (rates), machines (generator power, Somersloop slots, names),
 * buildings (names, pictures) and the world's resource nodes (extractor purity). Undefined while the recipes load.
 */
export function useFactoryData(version: string, worldId: string): FactoryData | undefined {
  const { index: recipes } = useRecipes(version);
  const { data: machines } = useMachineData(version);
  const buildings = useBuildings(version);
  const nodes = useWorldNodes(version, worldId);
  return useMemo(() => {
    if (recipes === undefined) return undefined;
    const labels = factoryLabels(recipes, machines ?? null, buildings ?? null);
    if (recipes === null) return { analysis: null, labels };
    const analysis: AnalysisData = { recipes };
    if (machines) analysis.machines = new Map(machines.machines.map(m => [m.id, m]));
    if (nodes) analysis.nodes = new Map(nodes.nodes.map(n => [n.name, n]));
    if (buildings) analysis.buildings = buildings;
    return { analysis, labels };
  }, [recipes, machines, buildings, nodes]);
}

export interface SnapshotAnalysis {
  snapshot: FactorySnapshot;
  analysis: FactoryAnalysis;
  routes: RouteAnalysis;
}

/** A snapshot with its analysis (undefined while either loads; null without an id). */
export function useSnapshotAnalysis(worldId: string, id: number | null, data: AnalysisData | null | undefined): { value: SnapshotAnalysis | null | undefined; failed: boolean } {
  const q = useSnapshot(worldId, id);
  const value = useMemo(() => {
    if (id === null) return null;
    if (!q.data || !data) return undefined;
    return { snapshot: q.data, analysis: analyzeFactory(q.data, data), routes: analyzeRoutes(q.data, data.recipes.items) };
  }, [id, q.data, data]);
  return { value, failed: q.isError };
}

/** The difference between two analysed snapshots (`before` older), or null when one is missing. */
export function useFactoryDiff(before: SnapshotAnalysis | null | undefined, after: SnapshotAnalysis | null | undefined): FactoryDiff | null {
  return useMemo(() => (before && after ? diffFactory(before, after) : null), [before, after]);
}
