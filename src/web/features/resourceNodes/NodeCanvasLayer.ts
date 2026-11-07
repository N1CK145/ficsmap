import L from 'leaflet';
import { drawNode, nodeRadius, nodeSize, type DrawNode, type NodePalette } from './drawNode.js';
import { RESOURCE_TOKENS } from './resourceStyle.js';

const PANE = 'ficsmap-resource-nodes';
/** Above the caves (350, entrances 420), below the collectible markers (450). */
const PANE_Z = '430';
const CULL_PX = 24;
/** Pick radius beyond the drawn disk, so small dots stay easy to hit. */
const PICK_SLACK = 6;

function readPalette(): NodePalette | null {
  const style = getComputedStyle(document.documentElement);
  const token = (name: string) => style.getPropertyValue(`--color-${name}`).trim();
  const resources: Record<string, string> = {};
  for (const t of RESOURCE_TOKENS) resources[t] = token(t);
  const p: NodePalette = { bg: token('bg'), fg: token('fg'), accent: token('accent'), shard: token('shard'), resources };
  // The stylesheet may not be applied yet; try again on the next draw instead of caching blanks.
  return [p.bg, p.fg, p.accent, p.shard, ...Object.values(resources)].every(c => c !== '') ? p : null;
}

/**
 * The resource nodes on one canvas in their own pane, redrawn (one frame at most) on move, zoom and
 * `redraw()`. Like the collectible markers it scales with the tiles during a zoom animation; hit tests go
 * through `pick()`.
 */
export class NodeCanvasLayer extends L.Layer {
  private canvas: HTMLCanvasElement | null = null;
  private frame = 0;
  private animatingZoom = false;
  private palette: NodePalette | null = null;

  constructor(private readonly getNodes: () => readonly DrawNode[], private readonly getHighlight: () => string | null) {
    super();
  }

  override onAdd(map: L.Map): this {
    const pane = map.getPane(PANE) ?? map.createPane(PANE);
    pane.style.zIndex = PANE_Z;
    pane.style.pointerEvents = 'none';
    this.canvas = L.DomUtil.create('canvas', 'leaflet-zoom-animated', pane);
    this.draw();
    return this;
  }

  override onRemove(): this {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.canvas?.remove();
    this.canvas = null;
    return this;
  }

  override getEvents(): Record<string, L.LeafletEventHandlerFn> {
    return {
      move: this.redraw,
      zoom: this.redraw,
      viewreset: this.redraw,
      resize: this.redraw,
      zoomanim: this.onZoomAnim as L.LeafletEventHandlerFn,
      zoomend: this.onZoomEnd,
    };
  }

  redraw(): this {
    if (!this.frame && this.canvas) {
      this.frame = requestAnimationFrame(() => {
        this.frame = 0;
        this.draw();
      });
    }
    return this;
  }

  /** The node whose marker is nearest to a container point, within its disk plus some slack. */
  pick(x: number, y: number): string | null {
    const map = this._map as L.Map | undefined;
    if (!map) return null;
    const size = nodeSize(map.getZoom());
    let best: string | null = null;
    let bestD = Infinity;
    for (const n of this.getNodes()) {
      const r = nodeRadius(n, size);
      if (r === 0) continue;
      const p = map.latLngToContainerPoint([n.lat, n.lng]);
      const d = Math.hypot(p.x - x, p.y - y);
      if (d <= r + PICK_SLACK && d < bestD) {
        best = n.id;
        bestD = d;
      }
    }
    return best;
  }

  private onZoomAnim(e: L.ZoomAnimEvent): void {
    const map = this._map as L.Map | undefined;
    if (!map || !this.canvas) return;
    this.animatingZoom = true;
    const topLeft = map.containerPointToLatLng([0, 0]);
    const target = map.project(topLeft, e.zoom).subtract(map.project(e.center, e.zoom)).add(map.getSize().divideBy(2));
    L.DomUtil.setTransform(this.canvas, map.containerPointToLayerPoint(target), map.getZoomScale(e.zoom, map.getZoom()));
  }

  private onZoomEnd(): void {
    this.animatingZoom = false;
    this.redraw();
  }

  private draw(): void {
    const map = this._map as L.Map | undefined;
    const canvas = this.canvas;
    if (!map || !canvas || this.animatingZoom) return;
    const size = map.getSize();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(size.x * dpr);
    const h = Math.round(size.y * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      canvas.style.width = `${size.x}px`;
      canvas.style.height = `${size.y}px`;
    }
    L.DomUtil.setPosition(canvas, map.containerPointToLayerPoint([0, 0]));
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.x, size.y);
    this.palette ??= readPalette();
    if (!this.palette) return;
    const nodeSz = nodeSize(map.getZoom());
    const highlight = this.getHighlight();
    let top: { n: DrawNode; x: number; y: number } | null = null;
    for (const n of this.getNodes()) {
      const p = map.latLngToContainerPoint([n.lat, n.lng]);
      if (p.x < -CULL_PX || p.y < -CULL_PX || p.x > size.x + CULL_PX || p.y > size.y + CULL_PX) continue;
      if (n.id === highlight) top = { n, x: p.x, y: p.y };
      else drawNode(ctx, p.x, p.y, n, nodeSz, this.palette);
    }
    if (top) drawNode(ctx, top.x, top.y, top.n, nodeSz === 'dot' ? 'small' : nodeSz, this.palette, true);
  }
}
