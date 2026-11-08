import L from 'leaflet';
import { PURITIES } from '../../../shared/resourceNodes.js';
import { drawNode, nodeRadius, nodeSize, type DrawNode, type NodePalette } from './drawNode.js';
import { nodeImage, onNodeImageLoad } from './nodeImages.js';
import { PURITY_TOKENS, RESOURCE_TOKENS } from './resourceStyle.js';

export const NODE_PANE = 'ficsmap-resource-nodes';
/**
 * Above the caves (350, entrances 420) and the collectible markers (450): the pane exists only while the layer is
 * switched on, and then the nodes are what the user looks for. Below the vehicle route's line (460).
 */
export const NODE_PANE_Z = 455;
const CULL_PX = 24;
/** Pick radius beyond the drawn disk, so small dots stay easy to hit. */
const PICK_SLACK = 6;

function readPalette(): NodePalette | null {
  const style = getComputedStyle(document.documentElement);
  const token = (name: string) => style.getPropertyValue(`--color-${name}`).trim();
  const resources: Record<string, string> = {};
  for (const t of RESOURCE_TOKENS) resources[t] = token(t);
  const purity = Object.fromEntries(PURITIES.map(q => [q, token(PURITY_TOKENS[q])])) as NodePalette['purity'];
  const p: NodePalette = { bg: token('bg'), fg: token('fg'), accent: token('accent'), shard: token('shard'), purity, resources };
  // The stylesheet may not be applied yet; try again on the next draw instead of caching blanks.
  return [p.bg, p.fg, p.accent, p.shard, ...Object.values(purity), ...Object.values(resources)].every(c => c !== '') ? p : null;
}

/**
 * The resource nodes on one canvas in their own pane, redrawn (one frame at most) on move, zoom, `redraw()` and
 * when a resource picture finishes loading. Like the collectible markers it scales with the tiles during a zoom
 * animation; hit tests go through `pick()`.
 */
export class NodeCanvasLayer extends L.Layer {
  private canvas: HTMLCanvasElement | null = null;
  private frame = 0;
  private animatingZoom = false;
  private palette: NodePalette | null = null;
  private unsubscribeImages: (() => void) | null = null;

  constructor(private readonly getNodes: () => readonly DrawNode[], private readonly getHighlight: () => string | null) {
    super();
  }

  override onAdd(map: L.Map): this {
    const pane = map.getPane(NODE_PANE) ?? map.createPane(NODE_PANE);
    pane.style.zIndex = String(NODE_PANE_Z);
    pane.style.pointerEvents = 'none';
    this.canvas = L.DomUtil.create('canvas', 'leaflet-zoom-animated', pane);
    this.unsubscribeImages = onNodeImageLoad(() => this.redraw());
    this.draw();
    return this;
  }

  override onRemove(): this {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.unsubscribeImages?.();
    this.unsubscribeImages = null;
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
      else drawNode(ctx, p.x, p.y, n, nodeSz, this.palette, false, nodeSz === 'dot' || !n.icon ? null : nodeImage(n.icon));
    }
    if (top) drawNode(ctx, top.x, top.y, top.n, nodeSz === 'dot' ? 'small' : nodeSz, this.palette, true, top.n.icon ? nodeImage(top.n.icon) : null);
  }
}
