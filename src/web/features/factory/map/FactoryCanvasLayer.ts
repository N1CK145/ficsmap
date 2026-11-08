import L from 'leaflet';
import type { DiffOverlay } from './diff.js';
import {
  drawCrate, drawLabel, drawReasonGlyph, drawMarkerPin, drawStationSymbol, drawVehicleArrow, fitText, readFactoryPalette, shade,
  type FactoryPalette,
} from './draw.js';
import { buildingLook, detailAt, GLYPH_MIN_PX, pxPerMapUnit, scaledLineWidth } from './lod.js';
import type { Scene, SceneBuilding, SceneStation, SceneVehicle } from './scene.js';
import { lineAlpha, lineWidthPx, type LineKind } from './style.js';
import type { ColorMode, FactoryLayer } from './useFactoryMap.js';

export const FACTORY_PANE = 'ficsmap-factory';
/**
 * Above the tiles (200), the explored-area veil (`FOG_PANE_Z`) and the cave areas (350), below the cave entrances (420),
 * the collectible markers (450), the resource nodes (455) and the vehicle calculator's route (460): the factory is
 * what is built on the ground; markers stay readable on top of it.
 */
export const FACTORY_PANE_Z = 410;
export const FOG_PANE = 'ficsmap-factory-fog';
export const FOG_PANE_Z = 300;

/** What one frame draws; the React layer keeps it current. */
export interface FactoryFrame {
  scene: Scene | null;
  layers: Readonly<Record<FactoryLayer, boolean>>;
  colorMode: ColorMode;
  diff: DiffOverlay | null;
  highlight: ReadonlySet<string>;
  /** The selected building or vehicle id. */
  selected: string | null;
  hover: string | null;
  /** The selected vehicle's way between its stops (map units, x, y per point) and its stops in order. */
  route: { legs: Float32Array[]; stops: { cx: number; cy: number; label: string }[] } | null;
  /** The building's picture at about `px` CSS px, or null (none, or not loaded yet). */
  picture(sb: SceneBuilding, px: number): HTMLImageElement | null;
  label(sb: SceneBuilding): string;
  stationLabel(st: SceneStation): string | null;
  vehicleLabel(v: SceneVehicle): string;
  /** A newer snapshot is loading: the shown one is drawn faded. */
  loading: boolean;
}

/** Chunk edge, map units (about 120 m in 1.2): paths are grouped per chunk, so a frame skips what is off screen. */
const CHUNK = 4;
/** Off-screen margin in CSS px for culling (glyphs and labels stick out of their building). */
const CULL_PX = 64;
const DOT_PX = 3;
/** Zoom from which belt and pipe attachments, poles and signs show their picture. */
const MINOR_PICTURE_ZOOM = 10;

/**
 * Fill groups are drawn in this order, so machines lie on top of the small logistics parts around them (and hit tests
 * prefer them the same way, see `pickBuilding`).
 */
function fillRank(key: string): number {
  return key === 'k:logistics' || key === 'p:np' ? 0 : key === 'k:building' ? 1 : 2;
}
const LABEL_FONT = '600 11px "Barlow Condensed", sans-serif';
const STATION_FONT = '600 12px "Barlow Condensed", sans-serif';

interface Chunk {
  minX: number; minY: number; maxX: number; maxY: number;
  buildings: number[];
  floor: Path2D | null;
  /** Building bodies per fill key: `k:<kind>` (category mode) and `p:<band>` / `p:np` (productivity mode). */
  fills: Map<string, Path2D>;
  soft: Map<string, Path2D>;
  /** Lines per `<kind>:<tier>`. */
  lines: Map<string, Path2D>;
  power: Path2D | null;
}

interface Paths { chunks: Chunk[] }

const pathCache = new WeakMap<Scene, Paths>();

function chunkFor(map: Map<number, Chunk>, x: number, y: number): Chunk {
  const k = (Math.floor(x / CHUNK) + 1024) * 4096 + (Math.floor(y / CHUNK) + 1024);
  let c = map.get(k);
  if (!c) {
    c = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity, buildings: [], floor: null, fills: new Map(), soft: new Map(), lines: new Map(), power: null };
    map.set(k, c);
  }
  return c;
}

function grow(c: Chunk, minX: number, minY: number, maxX: number, maxY: number): void {
  if (minX < c.minX) c.minX = minX;
  if (minY < c.minY) c.minY = minY;
  if (maxX > c.maxX) c.maxX = maxX;
  if (maxY > c.maxY) c.maxY = maxY;
}

function addQuads(path: Path2D, q: ArrayLike<number>, from = 0, to = q.length): void {
  for (let i = from; i + 7 < to; i += 8) {
    path.moveTo(q[i]!, q[i + 1]!);
    path.lineTo(q[i + 2]!, q[i + 3]!);
    path.lineTo(q[i + 4]!, q[i + 5]!);
    path.lineTo(q[i + 6]!, q[i + 7]!);
    path.closePath();
  }
}

function addPolyline(path: Path2D, pts: ArrayLike<number>): void {
  path.moveTo(pts[0]!, pts[1]!);
  for (let i = 2; i + 1 < pts.length; i += 2) path.lineTo(pts[i]!, pts[i + 1]!);
}

function getOr<K, V>(m: Map<K, V>, k: K, make: () => V): V {
  let v = m.get(k);
  if (v === undefined) m.set(k, (v = make()));
  return v;
}

/** The scene as Path2D groups per chunk (map units), built once per scene. */
function pathsOf(scene: Scene): Paths {
  const hit = pathCache.get(scene);
  if (hit) return hit;
  const chunks = new Map<number, Chunk>();
  const f = scene.floor;
  for (let i = 0; i + 7 < f.length; i += 8) {
    const c = chunkFor(chunks, f[i]!, f[i + 1]!);
    c.floor ??= new Path2D();
    addQuads(c.floor, f, i, i + 8);
    grow(c, Math.min(f[i]!, f[i + 2]!, f[i + 4]!, f[i + 6]!), Math.min(f[i + 1]!, f[i + 3]!, f[i + 5]!, f[i + 7]!),
      Math.max(f[i]!, f[i + 2]!, f[i + 4]!, f[i + 6]!), Math.max(f[i + 1]!, f[i + 3]!, f[i + 5]!, f[i + 7]!));
  }
  scene.buildings.forEach((sb, i) => {
    const c = chunkFor(chunks, sb.cx, sb.cy);
    c.buildings.push(i);
    grow(c, sb.minX, sb.minY, sb.maxX, sb.maxY);
    const prodKey = sb.band ? `p:${sb.band}` : 'p:np';
    for (const key of [`k:${sb.kind}`, prodKey]) {
      addQuads(getOr(c.fills, key, () => new Path2D()), sb.hard);
      if (sb.soft.length > 0) addQuads(getOr(c.soft, key, () => new Path2D()), sb.soft);
    }
  });
  for (const l of scene.lines) {
    const c = chunkFor(chunks, (l.minX + l.maxX) / 2, (l.minY + l.maxY) / 2);
    addPolyline(getOr(c.lines, `${l.style.kind}:${l.style.tier}`, () => new Path2D()), l.pts);
    grow(c, l.minX, l.minY, l.maxX, l.maxY);
  }
  const p = scene.power;
  for (let i = 0; i + 3 < p.length; i += 4) {
    const c = chunkFor(chunks, (p[i]! + p[i + 2]!) / 2, (p[i + 1]! + p[i + 3]!) / 2);
    c.power ??= new Path2D();
    c.power.moveTo(p[i]!, p[i + 1]!);
    c.power.lineTo(p[i + 2]!, p[i + 3]!);
    grow(c, Math.min(p[i]!, p[i + 2]!), Math.min(p[i + 1]!, p[i + 3]!), Math.max(p[i]!, p[i + 2]!), Math.max(p[i + 1]!, p[i + 3]!));
  }
  const out = { chunks: [...chunks.values()] };
  pathCache.set(scene, out);
  return out;
}

/**
 * Hatches for machines below 90 %, the second cue next to their colour: standing machines cross-hatched, throttled
 * ones with single diagonals.
 */
function hatchPattern(ctx: CanvasRenderingContext2D, color: string, cross: boolean): CanvasPattern | null {
  const c = document.createElement('canvas');
  c.width = 8;
  c.height = 8;
  const g = c.getContext('2d');
  if (!g) return null;
  g.strokeStyle = color;
  g.lineWidth = 1.6;
  g.beginPath();
  g.moveTo(-2, 10); g.lineTo(10, -2);
  g.moveTo(-2, 2); g.lineTo(2, -2);
  g.moveTo(6, 10); g.lineTo(10, 6);
  if (cross) {
    g.moveTo(-2, -2); g.lineTo(10, 10);
    g.moveTo(6, -2); g.lineTo(10, 2);
    g.moveTo(-2, 6); g.lineTo(2, 10);
  }
  g.stroke();
  return ctx.createPattern(c, 'repeat');
}

/**
 * The factory of one snapshot on one canvas in its own pane: the floor plan, lines, buildings (dots, boxes, boxes with
 * pictures and names by zoom), stations, vehicles, markers and crates, plus highlight, selection and changes. Redrawn
 * (one frame at most) on move, zoom and `redraw()`; scaled like the tiles during a zoom animation. The heavy geometry
 * is in map units as Path2D groups per chunk, drawn under one transform, so a frame costs little more than the fills.
 */
export class FactoryCanvasLayer extends L.Layer {
  private canvas: HTMLCanvasElement | null = null;
  private frame = 0;
  private animatingZoom = false;
  private palette: FactoryPalette | null = null;
  private hatch: { idle: CanvasPattern | null; throttled: CanvasPattern | null } | null = null;
  /** Duration of the last draw in ms (for measurements). */
  lastDrawMs = 0;

  constructor(private readonly getFrame: () => FactoryFrame) {
    super();
  }

  override onAdd(map: L.Map): this {
    const pane = map.getPane(FACTORY_PANE) ?? map.createPane(FACTORY_PANE);
    pane.style.zIndex = String(FACTORY_PANE_Z);
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

  /** Map units of a container point. */
  toMapUnits(x: number, y: number): { mx: number; my: number; s: number } | null {
    const map = this._map as L.Map | undefined;
    if (!map) return null;
    const o = map.latLngToContainerPoint([0, 0]);
    const s = pxPerMapUnit(map.getZoom());
    return { mx: (x - o.x) / s, my: (y - o.y) / s, s };
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
    const t0 = performance.now();
    const size = map.getSize();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(size.x * dpr), h = Math.round(size.y * dpr);
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
    this.palette ??= readFactoryPalette();
    const p = this.palette;
    const f = this.getFrame();
    if (!p || !f.scene) return;
    this.hatch ??= { idle: hatchPattern(ctx, p.bg, true), throttled: hatchPattern(ctx, p.bg, false) };

    const zoom = map.getZoom();
    const s = pxPerMapUnit(zoom);
    const o = map.latLngToContainerPoint([0, 0]);
    const view = {
      minX: (-CULL_PX - o.x) / s, minY: (-CULL_PX - o.y) / s,
      maxX: (size.x + CULL_PX - o.x) / s, maxY: (size.y + CULL_PX - o.y) / s,
    };
    const inView = (a: { minX: number; minY: number; maxX: number; maxY: number }) =>
      a.maxX >= view.minX && a.minX <= view.maxX && a.maxY >= view.minY && a.minY <= view.maxY;
    const d = detailAt(zoom);
    const scene = f.scene;
    const chunks = pathsOf(scene).chunks.filter(inView);
    const L_ = f.layers;
    /** Into map units: paths are in map units, line widths in CSS px / s. */
    const mapSpace = () => ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * o.x, dpr * o.y);
    const screenSpace = () => ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const sx = (mx: number) => o.x + mx * s;
    const sy = (my: number) => o.y + my * s;

    ctx.globalAlpha = f.loading ? 0.55 : 1;

    // Floor plan.
    if (L_.floor) {
      mapSpace();
      ctx.fillStyle = p.kinds.structure;
      ctx.strokeStyle = p.floorEdge;
      ctx.lineWidth = 0.6 / s;
      for (const c of chunks) {
        if (!c.floor) continue;
        ctx.fill(c.floor);
        if (d.outlines) ctx.stroke(c.floor);
      }
    }

    // Belts, pipes, hypertubes; roads and rails with the roads layer.
    const lineOn = (k: LineKind) => (k === 'road' || k === 'rail' ? L_.roads : L_.lines && d.lines);
    mapSpace();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const c of chunks) {
      for (const [key, path] of c.lines) {
        const [kind, tierS] = key.split(':') as [LineKind, string];
        if (!lineOn(kind)) continue;
        const style = { kind, tier: Number(tierS) };
        ctx.strokeStyle = p.lines[kind];
        ctx.globalAlpha = lineAlpha(style) * (f.loading ? 0.55 : 1);
        const px = kind === 'road' || kind === 'rail' ? Math.max(1, scaledLineWidth(lineWidthPx(style), zoom) * (zoom < 4 ? 0.5 : 1)) : scaledLineWidth(lineWidthPx(style), zoom);
        ctx.lineWidth = px / s;
        ctx.setLineDash(kind === 'hyper' ? [4 / s, 3 / s] : []);
        ctx.stroke(path);
      }
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = f.loading ? 0.55 : 1;

    // Power lines.
    if (L_.power && d.power) {
      ctx.strokeStyle = p.power;
      ctx.globalAlpha = 0.7 * (f.loading ? 0.55 : 1);
      ctx.lineWidth = 1 / s;
      for (const c of chunks) if (c.power) ctx.stroke(c.power);
      ctx.globalAlpha = f.loading ? 0.55 : 1;
    }

    // Buildings.
    const prodMode = f.colorMode === 'productivity';
    const fillOf = (key: string): string => {
      const [mode, v] = key.split(':') as [string, string];
      if (mode === 'k') return p.kinds[v as keyof FactoryPalette['kinds']];
      return v === 'np' ? p.kinds.logistics : p.bands[v as keyof FactoryPalette['bands']];
    };
    if (L_.buildings) {
      if (d.dots) {
        screenSpace();
        for (const c of chunks) {
          for (const i of c.buildings) {
            const sb = scene.buildings[i]!;
            if (!prodMode ? sb.kind === 'logistics' || sb.kind === 'building' : !sb.b.prod) continue;
            ctx.fillStyle = prodMode ? p.bands[sb.band!] : p.kinds[sb.kind];
            ctx.fillRect(sx(sb.cx) - DOT_PX / 2, sy(sb.cy) - DOT_PX / 2, DOT_PX, DOT_PX);
          }
        }
      } else {
        mapSpace();
        const prefix = prodMode ? 'p:' : 'k:';
        for (const c of chunks) {
          for (const [key, path] of [...c.fills].sort((a, b) => fillRank(a[0]) - fillRank(b[0]))) {
            if (!key.startsWith(prefix)) continue;
            const fill = fillOf(key);
            const faint = key === 'p:np';
            ctx.globalAlpha = (faint ? 0.45 : 0.92) * (f.loading ? 0.55 : 1);
            ctx.fillStyle = fill;
            ctx.fill(path);
            if (d.outlines) {
              ctx.strokeStyle = shade(fill, 0.55);
              ctx.lineWidth = 1 / s;
              ctx.stroke(path);
            }
            const hatch = key === 'p:idle' ? this.hatch.idle : key === 'p:throttled' ? this.hatch.throttled : null;
            if (hatch) {
              hatch.setTransform(new DOMMatrix().scale(1 / s));
              ctx.fillStyle = hatch;
              ctx.globalAlpha = 0.6 * (f.loading ? 0.55 : 1);
              ctx.fill(path);
            }
          }
          if (d.softBoxes) {
            for (const [key, path] of c.soft) {
              if (!key.startsWith(prefix)) continue;
              ctx.globalAlpha = 0.35 * (f.loading ? 0.55 : 1);
              ctx.fillStyle = fillOf(key);
              ctx.fill(path);
            }
          }
        }
        ctx.globalAlpha = f.loading ? 0.55 : 1;
      }
    }

    // Changes: everything else fades a little, then added (green), removed (red ghosts) and productivity changes.
    if (f.diff) this.drawDiff(ctx, f.diff, f, p, chunks, s, mapSpace, screenSpace, sx, sy, inView, d.dots);

    // Per-building detail: pictures, names and issue glyphs.
    if (L_.buildings && !d.dots) {
      screenSpace();
      for (const c of chunks) {
        for (const i of c.buildings) {
          const sb = scene.buildings[i]!;
          if (!inView(sb)) continue;
          this.drawBuildingDetail(ctx, sb, zoom, s, sx(sb.cx), sy(sb.cy), f, p, prodMode);
        }
      }
    }

    // Highlight (the Fabrik page's "On the map"), hover and selection.
    screenSpace();
    if (f.highlight.size > 0) {
      for (const id of f.highlight) {
        const sb = scene.byId.get(id);
        if (sb) this.outline(ctx, sb, s, o, p.fg, 3, d.dots, 1, true);
      }
    }
    if (f.hover && f.hover !== f.selected) {
      const sb = scene.byId.get(f.hover);
      if (sb) this.outline(ctx, sb, s, o, p.fg, 1.5, d.dots, 0.75);
    }

    // Roads layer: the selected vehicle's route, stations and vehicles.
    if (L_.roads) {
      if (f.route) this.drawRoute(ctx, f.route, p, sx, sy);
      ctx.globalAlpha = f.loading ? 0.55 : 1;
      for (const st of scene.stations) {
        const x = sx(st.cx), y = sy(st.cy);
        if (x < -CULL_PX || y < -CULL_PX || x > size.x + CULL_PX || y > size.y + CULL_PX) continue;
        const ring = st.state === 'active' ? p.fg : st.state === 'empty' ? p.conflict : p.muted;
        const sym = zoom < 4 ? 10 : 16;
        drawStationSymbol(ctx, x, y, sym, st.s.loading, ring, p, st.state === 'idle');
        if (d.stationLabels) {
          const text = f.stationLabel(st);
          if (text) drawLabel(ctx, text, x, y + sym / 2 + 11, STATION_FONT, p);
        }
      }
      for (const v of scene.vehicles) {
        const x = sx(v.cx), y = sy(v.cy);
        if (x < -CULL_PX || y < -CULL_PX || x > size.x + CULL_PX || y > size.y + CULL_PX) continue;
        const sel = f.selected === v.v.id;
        if (zoom >= 8) {
          // The body's outline at its real size under the arrow.
          ctx.save();
          ctx.beginPath();
          const q = v.outline;
          ctx.moveTo(sx(q[0]!), sy(q[1]!));
          for (let k = 2; k < 8; k += 2) ctx.lineTo(sx(q[k]!), sy(q[k + 1]!));
          ctx.closePath();
          ctx.fillStyle = `${p.vehicle}55`;
          ctx.strokeStyle = p.vehicle;
          ctx.lineWidth = 1.5;
          ctx.fill();
          ctx.stroke();
          ctx.restore();
        }
        if (sel) {
          ctx.beginPath();
          ctx.arc(x, y, 13, 0, Math.PI * 2);
          ctx.strokeStyle = p.fg;
          ctx.lineWidth = 2;
          ctx.stroke();
        }
        drawVehicleArrow(ctx, x, y, zoom < 4 ? 12 : 16, v.v.yaw, v.v.autopilot ? p.vehicle : p.muted, p);
        // Right of the arrow: a station's label sits under its symbol, where vehicles often stand.
        if (d.vehicleLabels || sel) drawLabel(ctx, f.vehicleLabel(v), x + 12, y - 12, LABEL_FONT, p, p.fg, 'left');
      }
    }

    if (f.selected) {
      const sb = scene.byId.get(f.selected);
      if (sb) this.outline(ctx, sb, s, o, p.accent, 2.5, d.dots, 1, true);
    }

    // Markers and crates.
    if (L_.markers) {
      for (const m of scene.markers) {
        const x = sx(m.cx), y = sy(m.cy);
        if (x < -CULL_PX || y < -CULL_PX || x > size.x + CULL_PX || y > size.y + CULL_PX) continue;
        const stamp = m.m.kind === 'RT_Stamp';
        drawMarkerPin(ctx, x, y, m.m.color, stamp, p);
        if (d.markerLabels && m.m.name) drawLabel(ctx, m.m.name, x, y + 16, LABEL_FONT, p);
      }
    }
    if (L_.crates) {
      for (const c of scene.crates) {
        const x = sx(c.cx), y = sy(c.cy);
        if (x < -CULL_PX || y < -CULL_PX || x > size.x + CULL_PX || y > size.y + CULL_PX) continue;
        drawCrate(ctx, x, y, p);
      }
    }
    ctx.globalAlpha = 1;
    this.lastDrawMs = performance.now() - t0;
  }

  private drawBuildingDetail(
    ctx: CanvasRenderingContext2D, sb: SceneBuilding, zoom: number, s: number, x: number, y: number, f: FactoryFrame, p: FactoryPalette, prodMode: boolean,
  ): void {
    // Belt and pipe attachments, poles and signs: a picture only at the closest zoom, never a name (clarity first).
    const minor = sb.kind === 'logistics';
    const raw = buildingLook(zoom, sb.minSide);
    const look = minor ? (zoom >= MINOR_PICTURE_ZOOM && raw !== 'box' ? 'picture' : 'box') : raw;
    const side = sb.minSide * s;
    let picTop = y;
    let picSize = 0;
    if (look === 'picture' || look === 'labelled') {
      picSize = Math.min(look === 'labelled' ? side * 0.45 : side * 0.7, 96);
      const img = f.picture(sb, picSize);
      if (img) {
        picTop = look === 'labelled' ? y - picSize * 0.65 : y - picSize / 2;
        ctx.drawImage(img, x - picSize / 2, picTop, picSize, picSize);
      }
    }
    if (look === 'labelled') {
      ctx.save();
      ctx.font = LABEL_FONT;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const text = fitText(ctx, f.label(sb), Math.max(side, sb.maxSide * s * 0.5) - 6);
      if (text) {
        ctx.fillStyle = p.bg;
        ctx.globalAlpha = 0.8;
        const tw = ctx.measureText(text).width;
        const ty = y + picSize * 0.5;
        ctx.fillRect(x - tw / 2 - 2, ty - 7, tw + 4, 14);
        ctx.globalAlpha = 1;
        ctx.fillStyle = p.fg;
        ctx.fillText(text, x, ty + 0.5);
      }
      ctx.restore();
    }
    // Reason glyphs: in the productivity mode on every machine large enough that is not full; in the category mode only
    // on machines below 90 %.
    const reasons = sb.reasons;
    if (sb.band && reasons.length > 0 && side >= GLYPH_MIN_PX && (prodMode || sb.band === 'idle' || sb.band === 'throttled')) {
      const r = Math.min(9, Math.max(5, side / 6));
      const shown = side >= 48 ? reasons.slice(0, 3) : reasons.slice(0, 1);
      const gx = picSize > 0 ? x + picSize / 2 : x;
      const gy = picSize > 0 ? picTop : y;
      shown.forEach((k, i) => drawReasonGlyph(ctx, gx + i * (r * 2 + 2) - (picSize > 0 ? 0 : (shown.length - 1) * (r + 1)), gy, r, k, p.bands[sb.band!], p));
    }
  }

  /** An outline a little outside the building (a ring around its dot when zoomed out); `casing` adds a dark edge under it. */
  private outline(
    ctx: CanvasRenderingContext2D, sb: SceneBuilding, s: number, o: L.Point, color: string, width: number, dots: boolean, alpha = 1, casing = false,
  ): void {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    if (dots) ctx.arc(o.x + sb.cx * s, o.y + sb.cy * s, 7, 0, Math.PI * 2);
    else {
      const q = sb.outline;
      const pad = 2 + width / 2;
      const cx = o.x + sb.cx * s, cy = o.y + sb.cy * s;
      for (let k = 0; k < 8; k += 2) {
        const x = o.x + q[k]! * s, y = o.y + q[k + 1]! * s;
        const dx = x - cx, dy = y - cy, len = Math.hypot(dx, dy) || 1;
        const px = x + (dx / len) * pad, py = y + (dy / len) * pad;
        if (k === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
    }
    if (casing && this.palette) {
      ctx.strokeStyle = this.palette.bg;
      ctx.lineWidth = width + 3;
      ctx.stroke();
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.stroke();
    ctx.restore();
  }

  private drawDiff(
    ctx: CanvasRenderingContext2D, diff: DiffOverlay, f: FactoryFrame, p: FactoryPalette, chunks: Chunk[], s: number,
    mapSpace: () => void, screenSpace: () => void, sx: (v: number) => number, sy: (v: number) => number,
    inView: (a: { minX: number; minY: number; maxX: number; maxY: number }) => boolean, dots: boolean,
  ): void {
    const scene = f.scene!;
    // A veil over what did not change.
    screenSpace();
    ctx.globalAlpha = 0.45;
    ctx.fillStyle = p.bg;
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.globalAlpha = 1;
    mapSpace();
    // Floor pieces.
    if (f.layers.floor) {
      const added = new Path2D(), removed = new Path2D();
      for (let i = 0; i + 7 < diff.floorAdded.length; i += 8) addQuads(added, diff.floorAdded, i, i + 8);
      for (let i = 0; i + 7 < diff.floorRemoved.length; i += 8) addQuads(removed, diff.floorRemoved, i, i + 8);
      ctx.fillStyle = p.kinds.structure;
      ctx.fill(added);
      ctx.strokeStyle = p.free;
      ctx.lineWidth = 1 / s;
      ctx.stroke(added);
      ctx.setLineDash([3 / s, 2 / s]);
      ctx.strokeStyle = p.conflict;
      ctx.stroke(removed);
      ctx.setLineDash([]);
    }
    // Lines.
    if (f.layers.lines || f.layers.roads) {
      const added = new Path2D();
      for (const l of scene.lines) if (diff.linesAdded.has(l.id) && inView(l)) addPolyline(added, l.pts);
      ctx.strokeStyle = p.free;
      ctx.lineWidth = 2 / s;
      ctx.stroke(added);
      const removed = new Path2D();
      for (const l of diff.linesRemoved) if (inView(l)) addPolyline(removed, l.pts);
      ctx.strokeStyle = p.conflict;
      ctx.setLineDash([4 / s, 3 / s]);
      ctx.stroke(removed);
      ctx.setLineDash([]);
    }
    if (!f.layers.buildings) return;
    // Removed buildings: red ghosts with a dashed edge.
    if (!dots) {
      const ghosts = new Path2D();
      for (const g of diff.removed) if (inView(g)) addQuads(ghosts, g.hard);
      ctx.fillStyle = p.conflict;
      ctx.globalAlpha = 0.3;
      ctx.fill(ghosts);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = p.conflict;
      ctx.lineWidth = 1.5 / s;
      ctx.setLineDash([4 / s, 3 / s]);
      ctx.stroke(ghosts);
      ctx.setLineDash([]);
    }
    // Added and changed buildings at full strength again, added ones outlined green.
    const prodMode = f.colorMode === 'productivity';
    const added = new Path2D();
    for (const c of chunks) {
      for (const i of c.buildings) {
        const sb = scene.buildings[i]!;
        if (!diff.added.has(sb.b.id) && !diff.productivity.has(sb.b.id)) continue;
        if (dots) continue;
        const path = new Path2D();
        addQuads(path, sb.hard);
        ctx.fillStyle = prodMode ? (sb.band ? p.bands[sb.band] : p.kinds.logistics) : p.kinds[sb.kind];
        ctx.fill(path);
        if (diff.added.has(sb.b.id)) addQuads(added, sb.outline);
      }
    }
    ctx.strokeStyle = p.free;
    ctx.lineWidth = 2 / s;
    ctx.stroke(added);
    screenSpace();
    if (dots) {
      for (const sb of scene.buildings) {
        if (!diff.added.has(sb.b.id)) continue;
        ctx.fillStyle = p.free;
        ctx.fillRect(sx(sb.cx) - 2, sy(sb.cy) - 2, 4, 4);
      }
      for (const g of diff.removed) {
        ctx.fillStyle = p.conflict;
        ctx.fillRect(sx(g.cx) - 2, sy(g.cy) - 2, 4, 4);
      }
      return;
    }
    // Productivity changes: a triangle up (better) or down (worse) at the building's lower left.
    for (const [id, dir] of diff.productivity) {
      const sb = scene.byId.get(id);
      if (!sb || !inView(sb)) continue;
      const x = sx(sb.minX) + 6, y = sy(sb.maxY) - 6;
      ctx.beginPath();
      if (dir > 0) { ctx.moveTo(x, y - 5); ctx.lineTo(x + 5, y + 4); ctx.lineTo(x - 5, y + 4); }
      else { ctx.moveTo(x, y + 5); ctx.lineTo(x + 5, y - 4); ctx.lineTo(x - 5, y - 4); }
      ctx.closePath();
      ctx.fillStyle = dir > 0 ? p.free : p.conflict;
      ctx.strokeStyle = p.bg;
      ctx.lineWidth = 1.5;
      ctx.fill();
      ctx.stroke();
    }
  }

  private drawRoute(ctx: CanvasRenderingContext2D, route: NonNullable<FactoryFrame['route']>, p: FactoryPalette, sx: (v: number) => number, sy: (v: number) => number): void {
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const [color, width] of [[p.bg, 7], [p.accent, 3.5]] as const) {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.globalAlpha = color === p.bg ? 0.7 : 1;
      ctx.beginPath();
      for (const leg of route.legs) {
        ctx.moveTo(sx(leg[0]!), sy(leg[1]!));
        for (let i = 2; i + 1 < leg.length; i += 2) ctx.lineTo(sx(leg[i]!), sy(leg[i + 1]!));
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.font = '700 11px "Barlow Condensed", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const st of route.stops) {
      const x = sx(st.cx) + 14, y = sy(st.cy) - 14;
      const w = Math.max(16, ctx.measureText(st.label).width + 8);
      ctx.beginPath();
      ctx.roundRect(x - w / 2, y - 8, w, 16, 8);
      ctx.fillStyle = p.accent;
      ctx.fill();
      ctx.fillStyle = p.onAccent;
      ctx.fillText(st.label, x, y + 0.5);
    }
    ctx.restore();
  }
}
