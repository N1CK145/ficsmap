import L from 'leaflet';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useMap } from 'react-leaflet';
import { NO_HEIGHT } from '../../../shared/heightmap.js';
import type { WorldBounds } from '../../../shared/types.js';
import { UNITS_PER_METER } from '../../../shared/geo.js';
import type { WorldCtx } from '../../app/feature.js';
import { IMAGE_BOUNDS } from '../map/imageBounds.js';
import { HEIGHT_GRADIENT, paintHeights } from './heightColors.js';
import { useHeightLayer, useHeightSource, type HeightSource } from './useHeights.js';

const PANE = 'ficsmap-heights';
/** Above the map tiles (200), below the caves (350) and the marker canvas (450). */
const PANE_Z = 300;
const OPACITY = 0.75;
const TILE = 256;
/** Up to this zoom a map tile spans 1875 m or more: drawn from the 8 m overview instead of 500 m tiles. */
const OVERVIEW_MAX_ZOOM = 2;

/** Draws the heights as map tiles: each 256 px tile from the overview or the 2 m tiles it covers. */
class HeightGridLayer extends L.GridLayer {
  constructor(private readonly source: HeightSource, private readonly world: WorldBounds, options: L.GridLayerOptions) {
    super(options);
  }

  override createTile(coords: L.Coords, done: L.DoneCallback): HTMLElement {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = TILE;
    this.draw(canvas, coords).then(() => done(undefined, canvas), e => done(e instanceof Error ? e : new Error(String(e)), canvas));
    return canvas;
  }

  private async draw(canvas: HTMLCanvasElement, coords: L.Coords): Promise<void> {
    const { meta } = this.source;
    const w = this.world;
    // CRS.Simple: the zoom-0 image is 256 units; a pixel at zoom z is 2^-z units.
    const unit = 2 ** coords.z;
    const wx = (px: number) => w.minX + ((coords.x * TILE + px + 0.5) / unit / 256) * (w.maxX - w.minX);
    const wy = (py: number) => w.minY + ((coords.y * TILE + py + 0.5) / unit / 256) * (w.maxY - w.minY);
    let sample: (px: number, py: number) => number | null;
    if (coords.z <= OVERVIEW_MAX_ZOOM) {
      const grid = await this.source.overview();
      if (!grid) return;
      const size = meta.cell * meta.overview.factor, ow = meta.overview.width, oh = meta.overview.height;
      sample = (px, py) => {
        const i = Math.floor((wx(px) - meta.minX) / size), j = Math.floor((wy(py) - meta.minY) / size);
        const v = i < 0 || j < 0 || i >= ow || j >= oh ? NO_HEIGHT : grid[j * ow + i]!;
        return v === NO_HEIGHT ? null : v * meta.step;
      };
    } else {
      const span = meta.cell * meta.tile;
      const ti0 = Math.floor((wx(0) - meta.minX) / span), ti1 = Math.floor((wx(TILE - 1) - meta.minX) / span);
      const tj0 = Math.floor((wy(0) - meta.minY) / span), tj1 = Math.floor((wy(TILE - 1) - meta.minY) / span);
      const tilesX = Math.ceil(meta.width / meta.tile), tilesY = Math.ceil(meta.height / meta.tile);
      const tiles = new Map<number, Int16Array>();
      await Promise.all([...range(Math.max(0, tj0), Math.min(tilesY - 1, tj1))].flatMap(tj =>
        [...range(Math.max(0, ti0), Math.min(tilesX - 1, ti1))].map(async ti => {
          const t = await this.source.tile(ti, tj);
          if (t) tiles.set(tj * tilesX + ti, t);
        })));
      sample = (px, py) => {
        const i = Math.floor((wx(px) - meta.minX) / meta.cell), j = Math.floor((wy(py) - meta.minY) / meta.cell);
        if (i < 0 || j < 0 || i >= meta.width || j >= meta.height) return null;
        const ti = Math.floor(i / meta.tile), tj = Math.floor(j / meta.tile);
        const v = tiles.get(tj * tilesX + ti)?.[(j - tj * meta.tile) * meta.tile + (i - ti * meta.tile)] ?? NO_HEIGHT;
        return v === NO_HEIGHT ? null : v * meta.step;
      };
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const img = ctx.createImageData(TILE, TILE);
    paintHeights(img.data, TILE, sample, meta.range[0], meta.range[1]);
    ctx.putImageData(img, 0, 0);
  }
}

function* range(a: number, b: number) {
  for (let k = a; k <= b; k++) yield k;
}

/**
 * The height map as a colour layer, while switched on: the highest surface per spot, light (low) to dark
 * (high), over the map tiles and under caves and markers, with a legend bottom left. Not interactive.
 */
export function HeightLayer({ ctx }: { ctx: WorldCtx }) {
  const { t, i18n } = useTranslation();
  const map = useMap();
  const visible = useHeightLayer(s => s.visible);
  const source = useHeightSource(ctx.me.datasetVersion, visible);
  const world = ctx.index.ds.bounds;

  useEffect(() => {
    if (!visible || !source) return;
    if (!map.getPane(PANE)) {
      const pane = map.createPane(PANE);
      pane.style.zIndex = String(PANE_Z);
      pane.style.pointerEvents = 'none';
    }
    const layer = new HeightGridLayer(source, world, { pane: PANE, tileSize: TILE, opacity: OPACITY, bounds: L.latLngBounds(IMAGE_BOUNDS), noWrap: true });
    layer.addTo(map);
    return () => { layer.remove(); };
  }, [map, visible, source, world]);

  if (!visible || !source) return null;
  const metres = new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 0 });
  const [lo, hi] = source.meta.range;
  return (
    <div
      className="pointer-events-none absolute bottom-10 left-2 z-[800] chamfer border border-line bg-panel/90 px-2 py-1 text-xs text-fg"
      data-testid="height-legend"
    >
      <div className="mb-1 font-display font-semibold tracking-wider text-muted uppercase">{t('heights.legend')}</div>
      <div className="h-2 w-40 rounded-sm" style={{ background: HEIGHT_GRADIENT }} />
      <div className="mt-0.5 flex justify-between tabular-nums">
        <span>{t('heights.metres', { value: metres.format(lo / UNITS_PER_METER) })}</span>
        <span>{t('heights.metres', { value: metres.format(hi / UNITS_PER_METER) })}</span>
      </div>
    </div>
  );
}
