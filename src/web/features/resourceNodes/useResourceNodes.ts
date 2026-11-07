import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { create } from 'zustand';
import type { ResourceNodesDto } from '../../../shared/api.js';
import {
  applyOverrides, extractorsByNode, readResourceNodes,
  type ExtractorInfo, type NodeFilter, type Occupancy, type Purity, type ResourceNode, type ResourceNodesFile,
} from '../../../shared/resourceNodes.js';
import { api, ApiClientError } from '../../app/api.js';
import { loadResourceNodeView, saveResourceNodeView, type ResourceNodeView } from '../../app/persist.js';
import { queryKeys } from '../../app/queryKeys.js';

/**
 * The dataset's resource nodes (`/data/<v>/resource-nodes.json`): null for a dataset built without
 * them, undefined while loading or while not `enabled`.
 */
export function useResourceNodeFile(version: string, enabled = true): ResourceNodesFile | null | undefined {
  return useQuery({
    queryKey: queryKeys.resourceNodes(version),
    enabled,
    queryFn: async () => {
      try {
        return await api<ResourceNodesFile>('GET', `/data/${encodeURIComponent(version)}/resource-nodes.json`);
      } catch (e) {
        if (e instanceof ApiClientError && e.status === 404) return null;
        throw e;
      }
    },
    staleTime: Infinity,
  }).data;
}

/** The world's resource nodes from its last save import (refetched on an import event). */
export function useNodeOverrides(worldId: string, enabled = true): ResourceNodesDto | undefined {
  return useQuery({
    queryKey: queryKeys.nodeOverrides(worldId),
    enabled,
    queryFn: () => api<ResourceNodesDto>('GET', `/api/worlds/${encodeURIComponent(worldId)}/resource-nodes`),
  }).data;
}

export interface WorldNodes {
  file: ResourceNodesFile;
  /** The nodes as this world has them: the dataset's, with the last save import's resource and purity applied. */
  nodes: ResourceNode[];
  /** Null until the world's import data loaded (the defaults show meanwhile). */
  overrides: ResourceNodesDto | null;
  /** The extractors per node from the last save import; empty without one. */
  extractors: ReadonlyMap<string, ExtractorInfo[]>;
}

const NO_EXTRACTORS: ReadonlyMap<string, ExtractorInfo[]> = new Map();

/**
 * The world's resource nodes: null for a dataset without them, undefined while loading or not `enabled`.
 * The default nodes show while the world's own data are still loading.
 */
export function useWorldNodes(version: string, worldId: string, enabled = true): WorldNodes | null | undefined {
  const file = useResourceNodeFile(version, enabled);
  const overrides = useNodeOverrides(worldId, enabled && !!file);
  const base = useMemo(() => (file ? readResourceNodes(file) : null), [file]);
  return useMemo(() => {
    if (file === undefined) return undefined;
    if (file === null || base === null) return null;
    const extractors = overrides?.extractors?.length ? extractorsByNode(base, overrides.extractors) : NO_EXTRACTORS;
    return { file, nodes: overrides ? applyOverrides(base, overrides.overrides) : base, overrides: overrides ?? null, extractors };
  }, [file, base, overrides]);
}

interface NodeLayerState extends ResourceNodeView {
  toggle(): void;
  toggleResource(id: string): void;
  /** Shows only this resource (or all again when it already is the only one shown among `all`). */
  showOnlyResource(id: string, all: readonly string[]): void;
  setAllResources(shown: boolean, all: readonly string[]): void;
  togglePurity(p: Purity): void;
  setOccupancy(o: Occupancy): void;
}

function persisted(s: ResourceNodeView): ResourceNodeView {
  const v = { visible: s.visible, hiddenResources: s.hiddenResources, purities: s.purities, occupancy: s.occupancy };
  saveResourceNodeView(v);
  return v;
}

/** Whether the resource node layer shows, and its filters; remembered per device. */
export const useNodeLayer = create<NodeLayerState>()((set, get) => {
  const update = (patch: Partial<ResourceNodeView>) => set(persisted({ ...get(), ...patch }));
  return {
    ...loadResourceNodeView(),
    toggle: () => update({ visible: !get().visible }),
    toggleResource: id => {
      const hidden = get().hiddenResources;
      update({ hiddenResources: hidden.includes(id) ? hidden.filter(r => r !== id) : [...hidden, id] });
    },
    showOnlyResource: (id, all) => {
      const hidden = get().hiddenResources;
      const onlyThis = all.every(r => (r === id) !== hidden.includes(r));
      update({ hiddenResources: onlyThis ? [] : all.filter(r => r !== id) });
    },
    setAllResources: (shown, all) => update({ hiddenResources: shown ? [] : [...all] }),
    togglePurity: p => {
      const on = get().purities;
      update({ purities: on.includes(p) ? on.filter(x => x !== p) : [...on, p] });
    },
    setOccupancy: occupancy => update({ occupancy }),
  };
});

/**
 * The filter of the layer as sets. The occupancy filter applies only while the world has extractors from a save
 * import (`extractors`); without them every node shows, whatever the device remembers.
 */
export function useNodeFilter(extractors?: ReadonlyMap<string, unknown>): NodeFilter {
  const hidden = useNodeLayer(s => s.hiddenResources);
  const purities = useNodeLayer(s => s.purities);
  const occupancy = useNodeLayer(s => s.occupancy);
  return useMemo((): NodeFilter => {
    const f: NodeFilter = { hiddenResources: new Set(hidden), purities: new Set(purities) };
    return extractors && extractors.size > 0 ? { ...f, occupancy, occupied: extractors } : f;
  }, [hidden, purities, occupancy, extractors]);
}
