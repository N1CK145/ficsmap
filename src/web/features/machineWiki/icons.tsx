import { useQuery } from '@tanstack/react-query';
import { createContext, useContext, useMemo, useState } from 'react';
import { iconSizeFor, itemIconPath, ITEM_ICONS_DIR, parseItemIconIndex } from '../../../shared/icons.js';
import { api } from '../../app/api.js';
import { queryKeys } from '../../app/queryKeys.js';

/** The pictures of a dataset version: which classes have one, and their URLs for a display size. */
export interface ItemIcons {
  has(cls: string): boolean;
  /** `src` for `px` CSS pixels, plus a `srcSet` with every size, so the browser picks a sharp one for the screen. */
  urls(cls: string, px: number): { src: string; srcSet: string };
}

/**
 * The pictures of a dataset version (`/data/<v>/icons/items/index.json`, dataset part `icons`). null for a dataset
 * without them, or when the index cannot be loaded: the wiki then shows no pictures. Fetched only while `enabled`.
 */
export function useItemIcons(version: string, enabled = true): ItemIcons | null {
  const q = useQuery({
    queryKey: queryKeys.itemIcons(version),
    enabled,
    queryFn: async () => {
      try {
        return parseItemIconIndex(await api<unknown>('GET', `/data/${encodeURIComponent(version)}/${ITEM_ICONS_DIR}/index.json`));
      } catch {
        return null; // pictures are an extra: no index, no pictures
      }
    },
    staleTime: Infinity,
  });
  const index = q.data;
  return useMemo(() => {
    if (!index) return null;
    const known = new Set(index.icons);
    const base = `/data/${encodeURIComponent(version)}/`;
    const url = (cls: string, size: number) => base + itemIconPath(encodeURIComponent(cls), size);
    return {
      has: cls => known.has(cls),
      urls: (cls, px) => ({
        src: url(cls, iconSizeFor(index.sizes, px)),
        srcSet: index.sizes.map(s => `${url(cls, s)} ${s}w`).join(', '),
      }),
    };
  }, [index, version]);
}

export const IconsContext = createContext<ItemIcons | null>(null);

/**
 * A game picture of an item, machine or vehicle, `px` CSS pixels square, loaded lazily. Decorative by default (empty
 * alt, hidden from screen readers) because a name stands next to it; pass `alt` where the picture stands for itself.
 * Without a picture (no index, not in it, or the file fails) it renders nothing, or with `placeholder` an empty box
 * of the same size, so layouts keep their shape. `icons` stands in for the context where there is none (the header search).
 */
export function GameIcon({ cls, px, alt = '', placeholder = false, className = '', icons: given }: {
  cls: string; px: number; alt?: string; placeholder?: boolean; className?: string; icons?: ItemIcons | null;
}) {
  const fromContext = useContext(IconsContext);
  const icons = given === undefined ? fromContext : given;
  const [failed, setFailed] = useState<string | null>(null);
  const urls = icons?.has(cls) ? icons.urls(cls, px) : null;
  const style = { width: px, height: px };
  if (!urls || failed === urls.src) {
    return placeholder ? <span aria-hidden="true" data-testid="icon-placeholder" className={`inline-block shrink-0 ${className}`} style={style} /> : null;
  }
  return (
    <img src={urls.src} srcSet={urls.srcSet} sizes={`${px}px`} width={px} height={px} alt={alt}
      aria-hidden={alt === '' ? true : undefined} loading="lazy" decoding="async" draggable={false}
      onError={() => setFailed(urls.src)} className={`inline-block shrink-0 object-contain ${className}`} style={style} />
  );
}
