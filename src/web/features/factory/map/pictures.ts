/**
 * Game pictures for the factory canvas, loaded once per URL and kept for the session. `factoryPicture` starts a load
 * and returns the picture once it is decoded; until then (or when it fails) null, and the canvas draws the box alone.
 * Listeners (the layer's redraw) run when a picture finishes.
 */

type Entry = { img: HTMLImageElement; state: 'loading' | 'ready' | 'failed' };

const images = new Map<string, Entry>();
const listeners = new Set<() => void>();

export function factoryPicture(url: string): HTMLImageElement | null {
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

export function onFactoryPictureLoad(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
