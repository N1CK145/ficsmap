import L from 'leaflet';
import type { Band } from '../../../../shared/factory/analysis.js';
import type { DiffOverlay } from './diff.js';
import {
  bandPattern, drawCrate, drawMarkerPin, drawPlate, drawReasonGlyph, drawStationSymbol, drawVehicleArrow, fitText, lighten,
  overlaps, plateRect, readFactoryPalette, shade, type FactoryPalette, type PlateLine, type Rect,
} from './draw.js';
import { buildingLook, CLOSE_FROM, detailAt, GLYPH_MIN_PX, PRODUCT_PIN_ZOOM, pxPerMapUnit, scaledLineWidth } from './lod.js';
import { greyPicture } from './pictures.js';
import { chevronsAlong, type EdgeLoad, type LineEdgeGeom, type LineGeom } from './lineView.js';
import type { Scene, SceneBuilding, SceneStation, SceneVehicle } from './scene.js';
import { bandLook, lineAlpha, lineWidthPx, PAUSED_LOOK, type BandLook, type BandPattern, type LineKind } from './style.js';
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

/** The selected vehicle's route: legs between its stops and the stops themselves, map units. */
export interface FrameRoute {
  /**
   * x, y per point; `zero`: the leg leads to a stop where this vehicle moves nothing or to or from a problem station
   * (drawn in the danger colour, as is that stop's badge).
   */
  legs: { pts: Float32Array; zero: boolean }[];
  stops: { cx: number; cy: number; label: string; zero: boolean }[];
}

/** The production line shown: hovered (a building or a row of the panel's list) or selected. */
export interface FrameLine {
  geom: LineGeom;
  /** The building under the pointer, outlined a little stronger than the rest of its line. */
  focus: string | null;
}

/** What one frame draws; the React layer keeps it current. */
export interface FactoryFrame {
  scene: Scene | null;
  layers: Readonly<Record<FactoryLayer, boolean>>;
  colorMode: ColorMode;
  diff: DiffOverlay | null;
  highlight: ReadonlySet<string>;
  /** When the highlight was last set (`performance.now()`): its halo pulses once. Null: no pulse (or reduced motion). */
  pulse: number | null;
  /** The selected building or vehicle id. */
  selected: string | null;
  hover: string | null;
  route: FrameRoute | null;
  /** The production line lit up over a dimmed factory, or null. */
  line: FrameLine | null;
  /** The building's picture at about `px` CSS px, or null (none, or not loaded yet). */
  picture(sb: SceneBuilding, px: number): HTMLImageElement | null;
  /** An item's picture (a machine's product) at about `px` CSS px, or null. */
  itemPicture(item: string, px: number): HTMLImageElement | null;
  label(sb: SceneBuilding): string;
  /**
   * A station's line on its plate: red for a problem station, with the picture of what lies in it; `numbered` puts the
   * station's number first (as the Fabrik page names it).
   */
  stationLabel(st: SceneStation, numbered: boolean): { text: string; problem: boolean; item: string | null } | null;
  vehicleLabel(v: SceneVehicle): string;
  /** Label text size in CSS px: 13, 14 on coarse pointers. */
  fontPx: number;
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
/** Stations closer than this many CSS px share one label plate. */
const STATION_CLUSTER_PX = 40;
/** How long the highlight's halo pulse runs, ms. */
const PULSE_MS = 1100;
/** How much the factory outside a lit production line is dimmed (opacity of the `bg` veil). */
const LINE_VEIL = 0.62;
/** From this zoom a lit line's connections carry chevrons in the flow direction, this many CSS px apart. */
const CHEVRON_ZOOM = 5;
const CHEVRON_PX = 46;
/** Close up: opacity of the band hatching and of the tint at most, so the 3 px border and the glyph carry the status. */
const CLOSE_HATCH = 0.35;
const CLOSE_TINT = 0.35;
/** Close up: a problem machine's border in CSS px (a healthy one keeps a thin edge). */
const CLOSE_BORDER_PX = 3;
/** A lower floor of a stack is drawn shrunk to this share around its centre, and this faint. */
const UNDER_INSET = 0.8;
const UNDER_ALPHA = 0.35;
/** Width in CSS px of a lit line's connection per load; the bottleneck widest. */
const LOAD_WIDTH: Record<EdgeLoad | 'bottleneck' | 'inner', number> = { inner: 1.75, low: 2, mid: 2.75, unknown: 2.5, saturated: 4.5, bottleneck: 5.5 };
type PathKey = EdgeLoad | 'bottleneck' | 'inner';

/** A lit line's bodies and connections as paths in map units, made once per line geometry. */
interface LinePaths {
  bodies: Path2D;
  edges: Map<PathKey, Path2D>;
}
const linePathCache = new WeakMap<LineGeom, LinePaths>();

function linePaths(g: LineGeom): LinePaths {
  const hit = linePathCache.get(g);
  if (hit) return hit;
  const bodies = new Path2D();
  for (const sb of g.buildings) addQuads(bodies, sb.hard);
  const edges = new Map<PathKey, Path2D>();
  if (g.inner.length > 0) {
    const path = new Path2D();
    for (const pts of g.inner) addPolyline(path, pts);
    edges.set('inner', path);
  }
  for (const e of g.edges) {
    const key = e.bottleneck ? 'bottleneck' : e.load;
    const path = getOr(edges, key, () => new Path2D());
    for (const pts of e.paths) addPolyline(path, pts);
    for (const sb of e.lifts) addQuads(path, sb.outline);
  }
  const out = { bodies, edges };
  linePathCache.set(g, out);
  return out;
}

/** Drawn from light to heavy, so a full connection lies on top of a quiet one where they share a belt. */
const LOAD_ORDER: PathKey[] = ['inner', 'low', 'unknown', 'mid', 'saturated', 'bottleneck'];

/** The productivity fill key of a building: `p:paused`, `p:<band>` or `p:np` (no production). */
export function prodFillKey(sb: SceneBuilding): string {
  if (sb.paused) return 'p:paused';
  return sb.band ? `p:${sb.band}` : 'p:np';
}

/** The look of a productivity fill key, or null for buildings without production. */
function lookOfKey(key: string): BandLook | null {
  if (key === 'p:np') return null;
  if (key === 'p:paused') return PAUSED_LOOK;
  return bandLook(key.slice(2) as Band);
}

/**
 * Fill groups are drawn in this order, so machines lie on top of the small logistics parts around them (and hit tests
 * prefer them the same way, see `pickBuilding`); in the productivity mode problems lie on top of healthy machines.
 */
function fillRank(key: string): number {
  if (key.startsWith('p:')) {
    const look = lookOfKey(key);
    return look ? 2 + look.rank : 0;
  }
  return key === 'k:logistics' ? 0 : key === 'k:building' ? 1 : 2;
}

const font = (px: number, weight = 600) => `${weight} ${px}px "Barlow Condensed", sans-serif`;

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
  /** The close-up's groups (made on its first frame): `fills` without the lower floors of stacks, and those inset. */
  close: { top: Map<string, Path2D>; under: Map<string, Path2D> } | null;
}

interface Paths { chunks: Chunk[] }

const pathCache = new WeakMap<Scene, Paths>();

function chunkFor(map: Map<number, Chunk>, x: number, y: number): Chunk {
  const k = (Math.floor(x / CHUNK) + 1024) * 4096 + (Math.floor(y / CHUNK) + 1024);
  let c = map.get(k);
  if (!c) {
    c = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity, buildings: [], floor: null, fills: new Map(), soft: new Map(), lines: new Map(), power: null, close: null };
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
    const prodKey = prodFillKey(sb);
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

type Box = { minX: number; minY: number; maxX: number; maxY: number };

/** Quads shrunk to `k` around each quad's own centre. */
function insetQuads(q: ArrayLike<number>, k: number): number[] {
  const out: number[] = [];
  for (let i = 0; i + 7 < q.length; i += 8) {
    const cx = (q[i]! + q[i + 2]! + q[i + 4]! + q[i + 6]!) / 4, cy = (q[i + 1]! + q[i + 3]! + q[i + 5]! + q[i + 7]!) / 4;
    for (let j = 0; j < 8; j += 2) out.push(cx + (q[i + j]! - cx) * k, cy + (q[i + j + 1]! - cy) * k);
  }
  return out;
}

/** A chunk's close-up groups, made once: the upper buildings per fill key, and the lower floors of stacks inset. */
function closeGroups(c: Chunk, scene: Scene): NonNullable<Chunk['close']> {
  if (c.close) return c.close;
  const top = new Map<string, Path2D>(), under = new Map<string, Path2D>();
  for (const i of c.buildings) {
    const sb = scene.buildings[i]!;
    for (const key of [`k:${sb.kind}`, prodFillKey(sb)]) {
      if (sb.under) addQuads(getOr(under, key, () => new Path2D()), insetQuads(sb.hard, UNDER_INSET));
      else addQuads(getOr(top, key, () => new Path2D()), sb.hard);
    }
  }
  return (c.close = { top, under });
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
  private patterns = new Map<string, CanvasPattern | null>();
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

  /** A band pattern in a colour, made once. */
  private pattern(ctx: CanvasRenderingContext2D, kind: Exclude<BandPattern, 'none'>, color: string): CanvasPattern | null {
    const key = `${kind}|${color}`;
    if (!this.patterns.has(key)) this.patterns.set(key, bandPattern(ctx, kind, color));
    return this.patterns.get(key) ?? null;
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

    const zoom = map.getZoom();
    const s = pxPerMapUnit(zoom);
    const o = map.latLngToContainerPoint([0, 0]);
    const view = {
      minX: (-CULL_PX - o.x) / s, minY: (-CULL_PX - o.y) / s,
      maxX: (size.x + CULL_PX - o.x) / s, maxY: (size.y + CULL_PX - o.y) / s,
    };
    const inView = (a: Box) => a.maxX >= view.minX && a.minX <= view.maxX && a.maxY >= view.minY && a.minY <= view.maxY;
    const onScreen = (x: number, y: number) => x >= -CULL_PX && y >= -CULL_PX && x <= size.x + CULL_PX && y <= size.y + CULL_PX;
    const d = detailAt(zoom);
    const scene = f.scene;
    const chunks = pathsOf(scene).chunks.filter(inView);
    const L_ = f.layers;
    const fade = f.loading ? 0.55 : 1;
    /** Into map units: paths are in map units, line widths in CSS px / s. */
    const mapSpace = () => ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * o.x, dpr * o.y);
    const screenSpace = () => ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const sx = (mx: number) => o.x + mx * s;
    const sy = (my: number) => o.y + my * s;
    const lineH = f.fontPx + 5;
    const labelFont = font(f.fontPx);

    ctx.globalAlpha = fade;

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
        ctx.globalAlpha = lineAlpha(style) * fade;
        const px = kind === 'road' || kind === 'rail' ? Math.max(1, scaledLineWidth(lineWidthPx(style), zoom) * (zoom < 4 ? 0.5 : 1)) : scaledLineWidth(lineWidthPx(style), zoom);
        ctx.lineWidth = px / s;
        ctx.setLineDash(kind === 'hyper' ? [4 / s, 3 / s] : []);
        ctx.stroke(path);
      }
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = fade;

    // Power lines.
    if (L_.power && d.power) {
      ctx.strokeStyle = p.power;
      ctx.globalAlpha = 0.7 * fade;
      ctx.lineWidth = 1 / s;
      for (const c of chunks) if (c.power) ctx.stroke(c.power);
      ctx.globalAlpha = fade;
    }

    // Buildings.
    const prodMode = f.colorMode === 'productivity';
    const changes = f.diff !== null;
    const bandColor = (key: string): string => {
      if (key === 'p:paused') return p.edge;
      if (key === 'p:np') return p.kinds.logistics;
      return p.bands[key.slice(2) as Band] ?? p.kinds.building;
    };
    const fillOf = (key: string): string => (key.startsWith('k:') ? p.kinds[key.slice(2) as keyof FactoryPalette['kinds']] : bandColor(key));
    if (L_.buildings) {
      if (d.dots) {
        screenSpace();
        if (prodMode && !changes) this.drawProblemDots(ctx, scene, chunks, sx, sy, p);
        else {
          for (const c of chunks) {
            for (const i of c.buildings) {
              const sb = scene.buildings[i]!;
              if (sb.kind === 'logistics' || sb.kind === 'building') continue;
              ctx.fillStyle = changes ? p.kinds.logistics : p.kinds[sb.kind];
              ctx.fillRect(sx(sb.cx) - DOT_PX / 2, sy(sb.cy) - DOT_PX / 2, DOT_PX, DOT_PX);
            }
          }
        }
      } else {
        mapSpace();
        // With changes marked, every building is drawn in one neutral grey; the changes add their colours on top.
        const prefix = prodMode && !changes ? 'p:' : 'k:';
        for (const c of chunks) {
          const close = d.closeUp ? closeGroups(c, scene) : null;
          if (close) {
            // The lower floors of stacks first: inset, faint, with a thin edge, so the upper floor reads on its own.
            for (const [key, path] of close.under) {
              if (!key.startsWith(prefix)) continue;
              const fill = changes ? p.kinds.logistics : fillOf(key);
              ctx.globalAlpha = UNDER_ALPHA * fade;
              ctx.fillStyle = fill;
              ctx.fill(path);
              ctx.globalAlpha = 0.6 * fade;
              ctx.strokeStyle = fill;
              ctx.lineWidth = 1 / s;
              ctx.stroke(path);
            }
          }
          for (const [key, path] of [...(close ? close.top : c.fills)].sort((a, b) => fillRank(a[0]) - fillRank(b[0]))) {
            if (!key.startsWith(prefix)) continue;
            if (changes) {
              ctx.globalAlpha = 0.55 * fade;
              ctx.fillStyle = p.kinds.logistics;
              ctx.fill(path);
              if (d.outlines) {
                ctx.globalAlpha = 0.8 * fade;
                ctx.strokeStyle = shade(p.kinds.logistics, 0.4);
                ctx.lineWidth = 1 / s;
                ctx.stroke(path);
              }
              continue;
            }
            const fill = fillOf(key);
            if (prefix === 'k:') {
              // The blueprint look: a translucent body with a crisp, lighter 1 px edge.
              ctx.globalAlpha = (d.outlines ? 0.75 : 0.9) * fade;
              ctx.fillStyle = fill;
              ctx.fill(path);
              if (d.outlines) {
                ctx.globalAlpha = fade;
                ctx.strokeStyle = lighten(fill, 0.35);
                ctx.lineWidth = 1 / s;
                ctx.stroke(path);
              }
              continue;
            }
            const look = lookOfKey(key);
            if (!look) {
              // Buildings without production stay faint.
              ctx.globalAlpha = 0.3 * fade;
              ctx.fillStyle = fill;
              ctx.fill(path);
              continue;
            }
            // Close up the hatching and tint step back: a 3 px border in the band colour and the glyph carry the status.
            ctx.globalAlpha = (close ? Math.min(look.tint, CLOSE_TINT) : look.tint) * fade;
            ctx.fillStyle = fill;
            ctx.fill(path);
            if (look.pattern !== 'none') {
              const pat = this.pattern(ctx, look.pattern, look.pattern === 'cross' ? p.bg : fill);
              if (pat) {
                pat.setTransform(new DOMMatrix().scale(1 / s));
                ctx.fillStyle = pat;
                ctx.globalAlpha = (close ? CLOSE_HATCH : look.pattern === 'cross' ? 0.5 : 0.9) * fade;
                ctx.fill(path);
              }
            }
            if (d.outlines || look.rank > 0) {
              ctx.globalAlpha = (look.rank === 0 ? 0.85 : 1) * fade;
              ctx.strokeStyle = fill;
              ctx.lineWidth = (close && look.rank > 0 ? CLOSE_BORDER_PX : 1) / s;
              ctx.stroke(path);
            }
          }
          if (d.softBoxes) {
            for (const [key, path] of c.soft) {
              if (!key.startsWith(prefix)) continue;
              ctx.globalAlpha = (prefix === 'p:' ? 0.6 * (lookOfKey(key)?.tint ?? 0.3) : 0.35) * fade;
              ctx.fillStyle = changes ? p.kinds.logistics : fillOf(key);
              ctx.fill(path);
            }
          }
        }
        ctx.globalAlpha = fade;
      }
    }

    // Changes: everything else under a light veil, then added (green), removed (red ghosts) and productivity changes.
    if (f.diff) this.drawDiff(ctx, f.diff, f, p, chunks, s, mapSpace, screenSpace, sx, sy, inView, d.dots, fillOf);

    // Per-building detail: pictures, names, product pins and reason glyphs.
    if (L_.buildings && !d.dots) {
      screenSpace();
      for (const c of chunks) {
        for (const i of c.buildings) {
          const sb = scene.buildings[i]!;
          if (!inView(sb)) continue;
          this.drawBuildingDetail(ctx, sb, zoom, s, sx(sb.cx), sy(sb.cy), f, p, prodMode && !changes, labelFont);
        }
      }
    }

    // A production line (hovered or selected): the rest dimmed, its buildings clear and outlined, its belts and pipes
    // bold in their load's colour with the flow direction.
    if (f.line) this.drawLine(ctx, f.line, p, zoom, s, o, view, size, mapSpace, screenSpace, d.dots);

    // Highlight (the Fabrik page's "On the map"): a bright edge with a soft glow and a dark casing, and one pulse.
    screenSpace();
    ctx.globalAlpha = 1;
    let pulsing = false;
    if (f.highlight.size > 0) {
      const k = f.pulse === null ? 1 : (performance.now() - f.pulse) / PULSE_MS;
      pulsing = k < 1;
      for (const id of f.highlight) {
        const sb = scene.byId.get(id);
        if (!sb) continue;
        this.outline(ctx, sb, s, o, p.fg, 2.5, d.dots, 1, true, true);
        if (pulsing) this.outline(ctx, sb, s, o, p.fg, 2, d.dots, (1 - k) * 0.9, false, false, 4 + 22 * k);
      }
    }
    if (f.hover && f.hover !== f.selected) {
      const sb = scene.byId.get(f.hover);
      if (sb) this.outline(ctx, sb, s, o, p.fg, 1.5, d.dots, 0.75);
    }
    // The selection under the stations, vehicles and labels, so it never hides a plate.
    if (f.selected) {
      const sb = scene.byId.get(f.selected);
      if (sb) this.outline(ctx, sb, s, o, p.fg, 2.5, d.dots, 1, true);
    }

    // Labels never cover each other: placed greedily, the selected first, then stations, vehicles and markers.
    const placed: Rect[] = [];
    const place = (r: Rect, force = false) => {
      if (!force && placed.some(q => overlaps(q, r))) return false;
      placed.push(r);
      return true;
    };

    // Roads layer: the selected vehicle's route, stations and vehicles.
    if (L_.roads) {
      if (f.route) this.drawRoute(ctx, f.route, p, sx, sy, f.fontPx);
      ctx.globalAlpha = fade;
      const sym = zoom < 4 ? 10 : 16;
      const shown: { st: SceneStation; x: number; y: number }[] = [];
      for (const st of scene.stations) {
        const x = sx(st.cx), y = sy(st.cy);
        if (!onScreen(x, y)) continue;
        // Problem stations (no vehicles, nothing moved) in red; without vehicles also dashed.
        const ring = st.state === 'active' ? p.fg : p.conflict;
        drawStationSymbol(ctx, x, y, sym, st.s.loading, ring, p, st.state === 'idle');
        shown.push({ st, x, y });
      }
      const vehicles: { v: SceneVehicle; x: number; y: number; sel: boolean }[] = [];
      for (const v of scene.vehicles) {
        const x = sx(v.cx), y = sy(v.cy);
        if (!onScreen(x, y)) continue;
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
          ctx.strokeStyle = p.bg;
          ctx.lineWidth = 5;
          ctx.stroke();
          ctx.strokeStyle = p.fg;
          ctx.lineWidth = 2;
          ctx.stroke();
        }
        drawVehicleArrow(ctx, x, y, zoom < 4 ? 12 : 16, v.v.yaw, v.v.autopilot ? p.vehicle : p.muted, p);
        vehicles.push({ v, x, y, sel });
      }
      ctx.font = labelFont;
      // The selected vehicle's name always shows.
      for (const it of vehicles) {
        if (!it.sel) continue;
        const r = plateRect(ctx, [{ text: f.vehicleLabel(it.v), color: p.fg }], it.x + 12, it.y - 12 - lineH / 2, lineH, 'left');
        place(r, true);
        drawPlate(ctx, [{ text: f.vehicleLabel(it.v), color: p.fg }], r, lineH, p);
      }
      if (d.stationLabels) {
        // Stations next to each other share one plate: loading lines first, then unloading.
        const clusters: { x: number; y: number; items: typeof shown }[] = [];
        for (const it of shown) {
          const c = clusters.find(k => Math.hypot(k.x - it.x, k.y - it.y) < STATION_CLUSTER_PX);
          if (c) c.items.push(it);
          else clusters.push({ x: it.x, y: it.y, items: [it] });
        }
        for (const c of clusters) {
          const order = (st: SceneStation) => (st.s.loading === false ? 1 : st.s.loading === true ? 0 : 2);
          const lines: PlateLine[] = c.items
            .slice()
            .sort((a, b) => order(a.st) - order(b.st))
            .flatMap(({ st }) => {
              const l = f.stationLabel(st, d.stationNumbers);
              return l ? [{ text: l.text, color: l.problem ? p.conflict : p.fg, icon: l.item ? f.itemPicture(l.item, lineH - 3) : null }] : [];
            });
          if (lines.length === 0) continue;
          const cx = c.items.reduce((a, it) => a + it.x, 0) / c.items.length;
          const bottom = Math.max(...c.items.map(it => it.y)) + sym / 2 + 3;
          const r = plateRect(ctx, lines, cx, bottom, lineH);
          if (place(r)) drawPlate(ctx, lines, r, lineH, p);
        }
      }
      if (d.vehicleLabels) {
        for (const it of vehicles) {
          if (it.sel) continue;
          const line = [{ text: f.vehicleLabel(it.v), color: p.fg }];
          // Right of the arrow, else left of it.
          let r = plateRect(ctx, line, it.x + 12, it.y - 12 - lineH / 2, lineH, 'left');
          if (!place(r)) {
            r = plateRect(ctx, line, it.x - 12, it.y - 12 - lineH / 2, lineH, 'left');
            r = { ...r, x: it.x - 12 - r.w };
            if (!place(r)) continue;
          }
          drawPlate(ctx, line, r, lineH, p);
        }
      }
    }

    // Markers and crates.
    if (L_.markers) {
      ctx.font = labelFont;
      for (const m of scene.markers) {
        const x = sx(m.cx), y = sy(m.cy);
        if (!onScreen(x, y)) continue;
        const stamp = m.m.kind === 'RT_Stamp';
        drawMarkerPin(ctx, x, y, m.m.color, stamp, p);
        if (d.markerLabels && m.m.name) {
          const line = [{ text: m.m.name, color: p.fg }];
          const r = plateRect(ctx, line, x, y + 9, lineH);
          if (place(r)) drawPlate(ctx, line, r, lineH, p);
        }
      }
    }
    if (L_.crates) {
      for (const c of scene.crates) {
        const x = sx(c.cx), y = sy(c.cy);
        if (!onScreen(x, y)) continue;
        drawCrate(ctx, x, y, p);
      }
    }
    ctx.globalAlpha = 1;
    this.lastDrawMs = performance.now() - t0;
    if (pulsing) this.redraw();
  }

  /**
   * A lit production line: a `bg` veil over everything but its buildings' bodies, its connections bold (on a dark
   * casing) in the colour of their load (quiet `muted`, busy `fg`, full `power` and wider, the bottleneck `conflict`
   * and widest), chevrons along them in the flow direction from `CHEVRON_ZOOM`, a glyph on full ones and the
   * bottleneck, and an outline around each of its buildings (a ring around the machines' dots zoomed out).
   */
  private drawLine(
    ctx: CanvasRenderingContext2D, fl: FrameLine, p: FactoryPalette, zoom: number, s: number, o: L.Point, view: Box,
    size: L.Point, mapSpace: () => void, screenSpace: () => void, dots: boolean,
  ): void {
    const g = fl.geom;
    const paths = linePaths(g);
    ctx.save();
    // The veil with the line's bodies cut out (even-odd), so they keep their colours, pictures and names.
    mapSpace();
    const veil = new Path2D();
    veil.rect(view.minX, view.minY, view.maxX - view.minX, view.maxY - view.minY);
    if (!dots) veil.addPath(paths.bodies);
    ctx.globalAlpha = LINE_VEIL;
    ctx.fillStyle = p.bg;
    ctx.fill(veil, 'evenodd');
    ctx.globalAlpha = 1;
    // Connections: a dark casing under all, then each load's colour.
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const colour = (k: PathKey) => (k === 'bottleneck' ? p.conflict : k === 'saturated' ? p.power : k === 'low' || k === 'inner' ? p.muted : p.fg);
    ctx.strokeStyle = p.bg;
    ctx.globalAlpha = 0.85;
    for (const k of LOAD_ORDER) {
      const path = paths.edges.get(k);
      if (!path) continue;
      ctx.lineWidth = (LOAD_WIDTH[k] + 3) / s;
      ctx.stroke(path);
    }
    ctx.globalAlpha = 1;
    for (const k of LOAD_ORDER) {
      const path = paths.edges.get(k);
      if (!path) continue;
      ctx.strokeStyle = colour(k);
      ctx.lineWidth = LOAD_WIDTH[k] / s;
      ctx.stroke(path);
    }
    screenSpace();
    const sx = (mx: number) => o.x + mx * s, sy = (my: number) => o.y + my * s;
    const inView = (a: Box) => a.maxX >= view.minX && a.minX <= view.maxX && a.maxY >= view.minY && a.minY <= view.maxY;
    // Chevrons in the flow direction.
    if (zoom >= CHEVRON_ZOOM) {
      for (const e of g.edges) {
        const k = e.bottleneck ? 'bottleneck' : e.load;
        const arm = LOAD_WIDTH[k] + 2.5;
        ctx.beginPath();
        for (const pts of e.paths) {
          const scr = new Float32Array(pts.length);
          for (let i = 0; i + 1 < pts.length; i += 2) { scr[i] = sx(pts[i]!); scr[i + 1] = sy(pts[i + 1]!); }
          for (const c of chevronsAlong(scr, CHEVRON_PX, size.x, size.y)) {
            const ca = Math.cos(c.a), sa = Math.sin(c.a);
            // A ">" pointing along the flow, its tip a little ahead of the point.
            const tx = c.x + ca * arm * 0.5, ty = c.y + sa * arm * 0.5;
            ctx.moveTo(tx - ca * arm + sa * arm * 0.8, ty - sa * arm - ca * arm * 0.8);
            ctx.lineTo(tx, ty);
            ctx.lineTo(tx - ca * arm - sa * arm * 0.8, ty - sa * arm + ca * arm * 0.8);
          }
        }
        ctx.strokeStyle = p.bg;
        ctx.lineWidth = 4;
        ctx.stroke();
        ctx.strokeStyle = colour(k);
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }
    // Outlines: machines clear, logistics nodes fainter; the building under the pointer a little stronger.
    for (const sb of g.buildings) {
      if (!inView(sb)) continue;
      const machine = sb.b.prod !== undefined;
      if (dots && !machine) continue;
      const focus = sb.b.id === fl.focus;
      this.outline(ctx, sb, s, o, p.fg, focus ? 2.5 : machine ? 1.5 : 1, dots, focus || machine ? 0.95 : 0.7, machine || focus);
    }
    // Glyphs on full connections and the bottleneck: "!" on red, a "full" mark (two bars) on amber.
    for (const e of g.edges) {
      if (!e.mid || (!e.bottleneck && e.load !== 'saturated')) continue;
      const x = sx(e.mid.x), y = sy(e.mid.y);
      if (x < -16 || y < -16 || x > size.x + 16 || y > size.y + 16) continue;
      drawLoadGlyph(ctx, x, y, e, p);
    }
    ctx.restore();
  }

  /**
   * The productivity mode zoomed out: machines as marks whose shape says the band, so it is never colour alone.
   * Standing: a red ×; throttled: a diamond; nearly full: a small square; full and paused: a tiny dot. Drawn in rank
   * order, so problems lie on top.
   */
  private drawProblemDots(
    ctx: CanvasRenderingContext2D, scene: Scene, chunks: Chunk[], sx: (v: number) => number, sy: (v: number) => number, p: FactoryPalette,
  ): void {
    const byRank = new Map<number, { sb: SceneBuilding; look: BandLook }[]>();
    for (const c of chunks) {
      for (const i of c.buildings) {
        const sb = scene.buildings[i]!;
        if (!sb.b.prod || !sb.band) continue;
        const look = sb.paused ? PAUSED_LOOK : bandLook(sb.band);
        (byRank.get(look.rank) ?? byRank.set(look.rank, []).get(look.rank)!).push({ sb, look });
      }
    }
    for (const rank of [...byRank.keys()].sort((a, b) => a - b)) {
      for (const { sb, look } of byRank.get(rank)!) {
        const x = sx(sb.cx), y = sy(sb.cy);
        const color = sb.paused ? p.edge : p.bands[sb.band!] ?? p.kinds.building;
        ctx.fillStyle = color;
        switch (look.dot) {
          case 'none': break;
          case 'tiny':
            ctx.globalAlpha = 0.7;
            ctx.fillRect(x - 1, y - 1, 2, 2);
            ctx.globalAlpha = 1;
            break;
          case 'square':
            ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
            break;
          case 'diamond':
            ctx.beginPath();
            ctx.moveTo(x, y - 4.5); ctx.lineTo(x + 4.5, y); ctx.lineTo(x, y + 4.5); ctx.lineTo(x - 4.5, y);
            ctx.closePath();
            ctx.strokeStyle = p.bg;
            ctx.lineWidth = 1.5;
            ctx.stroke();
            ctx.fill();
            break;
          case 'cross':
            ctx.beginPath();
            ctx.moveTo(x - 4, y - 4); ctx.lineTo(x + 4, y + 4);
            ctx.moveTo(x + 4, y - 4); ctx.lineTo(x - 4, y + 4);
            ctx.lineCap = 'round';
            ctx.strokeStyle = p.bg;
            ctx.lineWidth = 4.5;
            ctx.stroke();
            ctx.strokeStyle = color;
            ctx.lineWidth = 2.25;
            ctx.stroke();
            break;
        }
      }
    }
  }

  private drawBuildingDetail(
    ctx: CanvasRenderingContext2D, sb: SceneBuilding, zoom: number, s: number, x: number, y: number, f: FactoryFrame, p: FactoryPalette,
    glyphs: boolean, labelFont: string,
  ): void {
    // Stations are their symbol and plate (roads layer); their picture and name would sit under the plate.
    if (f.layers.roads && f.scene?.stationById.has(sb.b.id)) return;
    // The lower floor of a stack: only the upper one carries picture, name and glyphs (their info is a click away).
    if (sb.under && zoom >= CLOSE_FROM) return;
    // Belt and pipe attachments, poles and signs: a picture only at the closest zoom, never a name (clarity first).
    const minor = sb.kind === 'logistics';
    const raw = buildingLook(zoom, sb.minSide);
    const look = minor ? (zoom >= MINOR_PICTURE_ZOOM && raw !== 'box' ? 'picture' : 'box') : raw;
    const side = sb.minSide * s;
    // The item it makes, pinned to a corner from `PRODUCT_PIN_ZOOM` on; picture and name move up to make room.
    const pin = !minor && sb.product && zoom >= PRODUCT_PIN_ZOOM && side >= 20 ? Math.round(Math.max(14, Math.min(32, side * 0.3))) : 0;
    const lift = look === 'labelled' && pin > 0 ? Math.min(pin * 0.6, side * 0.12) : 0;
    let picTop = y;
    let picSize = 0;
    // The game render only at the closest detail, in greys and faded, so it never competes with the colours.
    if (look === 'labelled' || (minor && look === 'picture')) {
      picSize = Math.min(look === 'labelled' ? side * 0.45 - lift * 0.5 : side * 0.7, 96);
      const img = f.picture(sb, picSize);
      if (img) {
        picTop = look === 'labelled' ? y - picSize * 0.65 - lift : y - picSize / 2;
        ctx.globalAlpha = 0.6;
        ctx.drawImage(greyPicture(img), x - picSize / 2, picTop, picSize, picSize);
        ctx.globalAlpha = 1;
      }
    }
    if (look === 'labelled') {
      ctx.save();
      ctx.font = labelFont;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const text = fitText(ctx, f.label(sb), Math.max(side, sb.maxSide * s * 0.5) - 8);
      if (text) {
        const h = f.fontPx + 4;
        ctx.fillStyle = p.bg;
        ctx.globalAlpha = 0.8;
        const tw = ctx.measureText(text).width;
        const ty = y + picSize * 0.5 - lift;
        ctx.fillRect(x - tw / 2 - 3, ty - h / 2, tw + 6, h);
        ctx.globalAlpha = 1;
        ctx.fillStyle = p.fg;
        ctx.fillText(text, x, ty + 0.5);
      }
      ctx.restore();
    }
    // The item it makes, in colour, pinned to the tile's lower right corner (as the planner's nodes show a recipe):
    // six Constructors side by side become screws, rods and plates.
    if (pin > 0 && sb.product) {
      const img = f.itemPicture(sb.product, pin);
      if (img) {
        const q = sb.outline;
        // The corner of the outline furthest right and down on screen.
        let bx = -Infinity, by = -Infinity;
        for (let k = 0; k < 8; k += 2) {
          const cx = x + (q[k]! - sb.cx) * s, cy = y + (q[k + 1]! - sb.cy) * s;
          if (cx + cy > bx + by) { bx = cx; by = cy; }
        }
        const pad = 3;
        const left = Math.min(bx, x + sb.maxSide * s) - pin - pad - 4, top = by - pin - pad - 4;
        ctx.fillStyle = p.panel;
        ctx.strokeStyle = p.edge;
        ctx.lineWidth = 1;
        ctx.fillRect(left, top, pin + 4, pin + 4);
        ctx.strokeRect(left + 0.5, top + 0.5, pin + 3, pin + 3);
        ctx.drawImage(img, left + 2, top + 2, pin, pin);
      }
    }
    // Reason glyphs: only in the productivity mode and on buildings large enough to carry them.
    const reasons = sb.reasons;
    if (glyphs && sb.band && reasons.length > 0 && side >= GLYPH_MIN_PX) {
      const r = Math.min(9, Math.max(6, side / 6));
      const shown = side >= 48 ? reasons.slice(0, 3) : reasons.slice(0, 1);
      const ring = sb.paused ? p.edge : p.bands[sb.band] ?? p.kinds.building;
      const gx = picSize > 0 ? x + picSize / 2 : x;
      const gy = picSize > 0 ? picTop : y;
      shown.forEach((k, i) => drawReasonGlyph(ctx, gx + i * (r * 2 + 2) - (picSize > 0 ? 0 : (shown.length - 1) * (r + 1)), gy, r, k, ring, p));
    }
  }

  /**
   * An outline a little outside the building (a ring around its dot when zoomed out); `casing` adds a dark edge under
   * it, `glow` a soft wide halo, `grow` CSS px more distance (the highlight's pulse).
   */
  private outline(
    ctx: CanvasRenderingContext2D, sb: SceneBuilding, s: number, o: L.Point, color: string, width: number, dots: boolean, alpha = 1, casing = false,
    glow = false, grow = 0,
  ): void {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    if (dots) ctx.arc(o.x + sb.cx * s, o.y + sb.cy * s, (glow ? 9 : 7) + grow, 0, Math.PI * 2);
    else {
      const q = sb.outline;
      // Small buildings get a halo no smaller than about 18 px, so a marked miner still stands out zoomed out.
      const pad = 2 + width / 2 + grow + (glow ? Math.max(0, (18 - sb.minSide * s) / 2) : 0);
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
    ctx.lineJoin = 'round';
    if (glow) {
      ctx.globalAlpha = alpha * 0.28;
      ctx.strokeStyle = color;
      ctx.lineWidth = width + 9;
      ctx.stroke();
      ctx.globalAlpha = alpha;
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
    inView: (a: Box) => boolean, dots: boolean, fillOf: (key: string) => string,
  ): void {
    const scene = f.scene!;
    // A light veil over what did not change (the buildings under it are already grey).
    screenSpace();
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = p.bg;
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.globalAlpha = 1;
    mapSpace();
    // Foundations, walls and ramps are counted in the timeline's bar but not tinted: thousands of green squares would
    // drown the buildings that changed. Lines.
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
    // Added and changed buildings in their colours, added ones outlined green.
    const prodMode = f.colorMode === 'productivity';
    const added = new Path2D();
    if (!dots) {
      for (const c of chunks) {
        for (const i of c.buildings) {
          const sb = scene.buildings[i]!;
          const isAdded = diff.added.has(sb.b.id);
          if (!isAdded && !diff.productivity.has(sb.b.id)) continue;
          const path = new Path2D();
          addQuads(path, sb.hard);
          ctx.fillStyle = prodMode || !isAdded ? fillOf(prodFillKey(sb)) : p.kinds[sb.kind];
          ctx.globalAlpha = 0.9;
          ctx.fill(path);
          ctx.globalAlpha = 1;
          if (isAdded) addQuads(added, sb.outline);
        }
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
      const x = sx(sb.minX) + 7, y = sy(sb.maxY) - 7;
      ctx.beginPath();
      if (dir > 0) { ctx.moveTo(x, y - 6); ctx.lineTo(x + 6, y + 5); ctx.lineTo(x - 6, y + 5); }
      else { ctx.moveTo(x, y + 6); ctx.lineTo(x + 6, y - 5); ctx.lineTo(x - 6, y - 5); }
      ctx.closePath();
      ctx.fillStyle = dir > 0 ? p.free : p.conflict;
      ctx.strokeStyle = p.bg;
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.stroke();
      ctx.fill();
    }
  }

  /** The selected vehicle's route in the text colour on a dark casing; legs into stops that move nothing in red. */
  private drawRoute(ctx: CanvasRenderingContext2D, route: FrameRoute, p: FactoryPalette, sx: (v: number) => number, sy: (v: number) => number, fontPx: number): void {
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const trace = (legs: FrameRoute['legs']) => {
      ctx.beginPath();
      for (const { pts } of legs) {
        ctx.moveTo(sx(pts[0]!), sy(pts[1]!));
        for (let i = 2; i + 1 < pts.length; i += 2) ctx.lineTo(sx(pts[i]!), sy(pts[i + 1]!));
      }
    };
    trace(route.legs);
    ctx.strokeStyle = p.bg;
    ctx.globalAlpha = 0.75;
    ctx.lineWidth = 7;
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.lineWidth = 3.5;
    trace(route.legs.filter(l => !l.zero));
    ctx.strokeStyle = p.fg;
    ctx.stroke();
    trace(route.legs.filter(l => l.zero));
    ctx.strokeStyle = p.conflict;
    ctx.stroke();
    ctx.font = font(fontPx, 700);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const h = fontPx + 5;
    for (const st of route.stops) {
      const x = sx(st.cx) + 14, y = sy(st.cy) - 14;
      const w = Math.max(h, ctx.measureText(st.label).width + 8);
      ctx.beginPath();
      ctx.roundRect(x - w / 2, y - h / 2, w, h, h / 2);
      ctx.fillStyle = st.zero ? p.conflict : p.fg;
      ctx.strokeStyle = p.bg;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fill();
      ctx.fillStyle = p.bg;
      ctx.fillText(st.label, x, y + 0.5);
    }
    ctx.restore();
  }
}

/** The mark on a full connection (two bars on `power`) or on the line's bottleneck ("!" on `conflict`), 8 px radius. */
function drawLoadGlyph(ctx: CanvasRenderingContext2D, x: number, y: number, e: LineEdgeGeom, p: FactoryPalette): void {
  const r = 8;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = e.bottleneck ? p.conflict : p.power;
  ctx.strokeStyle = p.bg;
  ctx.lineWidth = 2.5;
  ctx.stroke();
  ctx.fill();
  ctx.strokeStyle = p.bg;
  ctx.lineCap = 'round';
  ctx.lineWidth = 2;
  ctx.beginPath();
  if (e.bottleneck) {
    ctx.moveTo(x, y - 4.5);
    ctx.lineTo(x, y + 0.5);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y + 3.6, 1.2, 0, Math.PI * 2);
    ctx.fillStyle = p.bg;
    ctx.fill();
    return;
  }
  // Two bars across the flow: the belt is at its limit.
  const ca = Math.cos(e.mid?.a ?? 0), sa = Math.sin(e.mid?.a ?? 0);
  for (const off of [-2, 2]) {
    const cx = x + ca * off, cy = y + sa * off;
    ctx.moveTo(cx - sa * 4, cy + ca * 4);
    ctx.lineTo(cx + sa * 4, cy - ca * 4);
  }
  ctx.stroke();
}
