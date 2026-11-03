import { useSyncExternalStore } from 'react';
import type { CollectibleType } from '../../../shared/collectibleTypes.js';

/** URL of a type's game icon in a dataset version. */
export function typeIconUrl(version: string, type: CollectibleType): string {
  return `/data/${encodeURIComponent(version)}/icons/${encodeURIComponent(type.icon)}.png`;
}

type Entry = { img: HTMLImageElement; state: 'loading' | 'ready' | 'failed' };

const images = new Map<string, Entry>();
/** Per dataset version: the icon keys its map.json lists, or null while it loads (or when it failed). */
const indexes = new Map<string, Set<string> | null>();
const listeners = new Set<() => void>();
let generation = 0;

function notify(): void {
  generation++;
  for (const l of listeners) l();
}

/**
 * The icon keys of a dataset version (`icons` in its map.json), loaded once. Only listed icons are
 * requested, so a dataset without some of them (e.g. before a re-extraction) causes no 404s.
 */
function iconIndex(version: string): Set<string> | null {
  if (indexes.has(version)) return indexes.get(version)!;
  indexes.set(version, null);
  void fetch(`/data/${encodeURIComponent(version)}/map.json`)
    .then(res => (res.ok ? res.json() : null))
    .then((map: { icons?: Record<string, string> } | null) => {
      indexes.set(version, new Set(Object.keys(map?.icons ?? {})));
      notify();
    })
    .catch(() => { /* no index: every type keeps its shape */ });
  return null;
}

/** Whether the dataset has the type's icon; false while that is not known yet. */
export function hasTypeIcon(version: string, type: CollectibleType): boolean {
  return iconIndex(version)?.has(type.icon) ?? false;
}

/**
 * The type's game icon, decoded and ready for drawImage, or null while it loads or when the dataset
 * does not have it; callers then draw the shape. `onTypeImageLoad` listeners run when one finishes.
 */
export function typeImage(version: string, type: CollectibleType): HTMLImageElement | null {
  if (!hasTypeIcon(version, type)) return null;
  const url = typeIconUrl(version, type);
  let e = images.get(url);
  if (!e) {
    const img = new Image();
    const entry: Entry = { img, state: 'loading' };
    img.onload = () => {
      entry.state = img.naturalWidth > 0 ? 'ready' : 'failed';
      notify();
    };
    img.onerror = () => { entry.state = 'failed'; };
    img.src = url;
    images.set(url, entry);
    e = entry;
  }
  return e.state === 'ready' ? e.img : null;
}

/** Subscribes to finished icon (and icon index) loads; returns the unsubscribe function. */
export function onTypeImageLoad(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** For React: the icon URL when the dataset has the icon, else null (re-renders once the index arrives). */
export function useTypeIconUrl(version: string | undefined, type: CollectibleType): string | null {
  useSyncExternalStore(onTypeImageLoad, () => generation);
  return version !== undefined && hasTypeIcon(version, type) ? typeIconUrl(version, type) : null;
}
