let probe: HTMLElement | null = null;

/**
 * The computed style to read colour tokens from for drawing on the map (canvas layers, Leaflet paths): always the
 * dark palette, as the map stays dark in the light theme too (theme.css). Read from a hidden element marked
 * `data-theme="dark"`, so the light theme's overrides do not reach it.
 */
export function mapStyle(): CSSStyleDeclaration {
  if (!probe?.isConnected) {
    probe = document.createElement('span');
    probe.dataset.theme = 'dark';
    probe.hidden = true;
    document.body.appendChild(probe);
  }
  return getComputedStyle(probe);
}
