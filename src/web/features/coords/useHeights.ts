import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import { create } from 'zustand';
import { decodeHeightTile, heightCell, heightTileName, heightValue, OVERVIEW_FILE, type HeightmapMeta } from '../../../shared/heightmap.js';
import { api, ApiClientError } from '../../app/api.js';
import { queryKeys } from '../../app/queryKeys.js';

async function fetchTile(url: string): Promise<Int16Array> {
  const res = await fetch(url, { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  // Plain gzip files (no Content-Encoding), so the browser hands over the compressed bytes.
  const raw = await new Response(res.body!.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  return decodeHeightTile(new Int16Array(raw));
}

/**
 * The height files of one dataset version (src/shared/heightmap.ts), fetched on demand and kept: 500 m tiles
 * and the overview. A file that fails to load counts as missing (null). Shared by everything that shows heights.
 */
export class HeightSource {
  private readonly files = new Map<string, Int16Array | null | Promise<Int16Array | null>>();
  private readonly listeners = new Set<() => void>();

  constructor(readonly version: string, readonly meta: HeightmapMeta) {}

  /** A decoded file: now (array or null), or a promise while it loads. */
  load(name: string): Int16Array | null | Promise<Int16Array | null> {
    const hit = this.files.get(name);
    if (hit !== undefined) return hit;
    const url = `/data/${encodeURIComponent(this.version)}/height/${name}?v=${encodeURIComponent(this.meta.id)}`;
    const p = fetchTile(url).catch(() => null).then(t => {
      this.files.set(name, t);
      for (const l of this.listeners) l();
      return t;
    });
    this.files.set(name, p);
    return p;
  }

  tile(ti: number, tj: number) { return this.load(heightTileName(ti, tj)); }
  overview() { return this.load(OVERVIEW_FILE); }

  /** Height (cm) of the highest surface at a world point; null for none, undefined while its tile loads. */
  heightAt(x: number, y: number): number | null | undefined {
    const c = heightCell(this.meta, x, y);
    if (!c) return null;
    const t = this.tile(c.ti, c.tj);
    if (t instanceof Promise) return undefined;
    return t === null ? null : heightValue(this.meta, t, c.k);
  }

  /** Called whenever a file finished loading; returns the unsubscribe. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
}

const sources = new Map<string, HeightSource>();

function sourceFor(version: string, meta: HeightmapMeta): HeightSource {
  const key = `${version}\n${meta.id}`;
  let s = sources.get(key);
  if (!s) sources.set(key, s = new HeightSource(version, meta));
  return s;
}

/**
 * The height map of a dataset version (`/data/<v>/height/meta.json`): its HeightSource, null for a dataset
 * without heights, undefined while the meta loads or while not `enabled`.
 */
export function useHeightSource(version: string, enabled = true): HeightSource | null | undefined {
  const meta = useQuery({
    queryKey: queryKeys.heightmap(version),
    enabled,
    queryFn: async () => {
      try {
        return await api<HeightmapMeta>('GET', `/data/${encodeURIComponent(version)}/height/meta.json`);
      } catch (e) {
        if (e instanceof ApiClientError && e.status === 404) return null;
        throw e;
      }
    },
    staleTime: Infinity,
  }).data;
  return meta === undefined ? undefined : meta === null ? null : sourceFor(version, meta);
}

/**
 * `heightAt(x, y)` for a dataset version: the highest surface (cm) at a world point, null where there is
 * none (or the dataset has no heights), undefined while its tile loads; the hook re-renders once it has.
 */
export function useHeights(version: string, enabled = true): { available: boolean | undefined; heightAt: (x: number, y: number) => number | null | undefined } {
  const source = useHeightSource(version, enabled);
  const [, setLoaded] = useState(0);
  useEffect(() => source?.subscribe(() => setLoaded(n => n + 1)), [source]);
  const heightAt = useCallback(
    (x: number, y: number) => (source === undefined ? undefined : source === null ? null : source.heightAt(x, y)),
    [source],
  );
  return { available: source === undefined ? undefined : source !== null, heightAt };
}

const STORAGE_KEY = 'ficsmap:heights';

function readVisible(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

/** Whether the height layer is shown; remembered per device (best effort, like the cave layer). */
export const useHeightLayer = create<{ visible: boolean; toggle(): void }>()(set => ({
  visible: readVisible(),
  toggle: () => set(s => {
    const visible = !s.visible;
    try {
      localStorage.setItem(STORAGE_KEY, visible ? '1' : '0');
    } catch {
      // Not remembering is fine.
    }
    return { visible };
  }),
}));
