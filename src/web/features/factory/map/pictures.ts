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

const grey = new WeakMap<HTMLImageElement, HTMLCanvasElement | null>();

/**
 * A decoded picture in greys (the close-up's blueprint look: the game render must not compete with the colours that
 * carry meaning), made once per picture. Falls back to the picture itself where the pixels cannot be read.
 */
export function greyPicture(img: HTMLImageElement): CanvasImageSource {
  let c = grey.get(img);
  if (c === undefined) {
    c = null;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const g = canvas.getContext('2d', { willReadFrequently: true });
      if (g) {
        g.drawImage(img, 0, 0);
        const px = g.getImageData(0, 0, canvas.width, canvas.height);
        const d = px.data;
        for (let i = 0; i < d.length; i += 4) {
          const l = Math.round(0.2126 * d[i]! + 0.7152 * d[i + 1]! + 0.0722 * d[i + 2]!);
          d[i] = l; d[i + 1] = l; d[i + 2] = l;
        }
        g.putImageData(px, 0, 0);
        c = canvas;
      }
    } catch {
      // A tainted or unreadable picture stays in colour.
    }
    grey.set(img, c);
  }
  return c ?? img;
}
