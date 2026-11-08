/**
 * The resources' game pictures for the node canvas, loaded once per URL and kept for the session. `nodeImage` starts
 * a load and returns the picture once it is decoded; until then, or when it fails, it returns null and the canvas
 * draws the resource-coloured disk instead. Listeners (the layer's redraw) run when a picture finishes.
 */

/** The picture size to load: covers the largest picture a node draws (22 CSS px) on a 2x screen. */
export const NODE_IMAGE_PX = 64;

type Entry = { img: HTMLImageElement; state: 'loading' | 'ready' | 'failed' };

const images = new Map<string, Entry>();
const listeners = new Set<() => void>();

export function nodeImage(url: string): HTMLImageElement | null {
  let e = images.get(url);
  if (!e) {
    const img = new Image();
    const entry: Entry = { img, state: 'loading' };
    img.decoding = 'async';
    img.onload = () => {
      entry.state = img.naturalWidth > 0 ? 'ready' : 'failed';
      for (const l of listeners) l();
    };
    img.onerror = () => { entry.state = 'failed'; };
    img.src = url;
    images.set(url, entry);
    e = entry;
  }
  return e.state === 'ready' ? e.img : null;
}

/** Subscribes to finished picture loads; returns the unsubscribe function. */
export function onNodeImageLoad(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
