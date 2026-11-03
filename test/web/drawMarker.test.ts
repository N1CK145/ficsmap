import { typeById } from '../../src/shared/collectibleTypes.js';
import { drawMarker, ICON, NO_PULSES, type MarkerPalette } from '../../src/web/features/map/drawMarker.js';
import { markerVisual, type MarkerState } from '../../src/web/features/map/markerStyle.js';

const palette: MarkerPalette = { bg: '#000000', fg: '#ffffff', accent: '#ff8800', conflict: '#ff0000', power: '#ffd23f', free: '#3ddc84', types: { sloop: '#cc00cc', hdd: '#c8cdd3' } };

/** A 2D context stub that records drawImage calls and the alpha they ran with. */
function stubCtx() {
  const images: { args: unknown[]; alpha: number }[] = [];
  const ctx: Record<string, unknown> = { globalAlpha: 1, images };
  const fills: string[] = [];
  for (const m of ['beginPath', 'arc', 'roundRect', 'moveTo', 'lineTo', 'closePath', 'stroke', 'fillText']) ctx[m] = () => {};
  ctx.fill = () => { fills.push(ctx.fillStyle as string); };
  (images as unknown as { fills: string[] }).fills = fills;
  ctx.drawImage = (...args: unknown[]) => images.push({ args, alpha: ctx.globalAlpha as number });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, images };
}

const visual = (s: MarkerState, zoom: number) => markerVisual(s, {
  visibility: 'show', zoom, selected: false, inScope: true, typeEnabled: true, onlyConflicts: false, routeIndex: null,
});
const img = {} as CanvasImageSource;

describe('drawMarker with a game icon', () => {
  it('draws the icon centred on the marker when zoomed in', () => {
    const { ctx, images } = stubCtx();
    drawMarker(ctx, 100, 50, typeById('somersloop'), visual('uncollected', 3), palette, NO_PULSES, img);
    expect(images).toHaveLength(1);
    expect(images[0]!.args).toEqual([img, 100 - ICON.size / 2, 50 - ICON.size / 2, ICON.size, ICON.size]);
    expect(images[0]!.alpha).toBe(1);
  });

  it('fades the icon of a collected marker', () => {
    const { ctx, images } = stubCtx();
    drawMarker(ctx, 0, 0, typeById('somersloop'), visual('collected', 3), palette, NO_PULSES, img);
    expect(images[0]!.alpha).toBeCloseTo(ICON.collectedAlpha);
  });

  it('keeps dots and the shape fallback without drawing an image', () => {
    const { ctx, images } = stubCtx();
    drawMarker(ctx, 0, 0, typeById('somersloop'), visual('uncollected', 0), palette, NO_PULSES, img);
    drawMarker(ctx, 0, 0, typeById('somersloop'), visual('uncollected', 3), palette, NO_PULSES, null);
    expect(images).toHaveLength(0);
  });
});

describe('icon marker geometry', () => {
  it('leaves 3 px between the icon and the ring', () => {
    expect(ICON.discR - ICON.ring / 2 - ICON.size / 2).toBe(3);
  });
});

describe('drop-pod badges', () => {
  const fillsOf = (pod: 'power' | 'free' | undefined, state: MarkerState = 'uncollected', withImg = true) => {
    const { ctx, images } = stubCtx();
    drawMarker(ctx, 0, 0, typeById('hard_drive'), { ...visual(state, 3), pod }, palette, NO_PULSES, withImg ? img : null);
    return (images as unknown as { fills: string[] }).fills;
  };

  it('draws the power colour for a pod opened with power, the free colour for one that needs nothing', () => {
    expect(fillsOf('power')).toContain(palette.power);
    expect(fillsOf('free')).toContain(palette.free);
    expect(fillsOf('power', 'uncollected', false)).toContain(palette.power);
  });

  it('draws no badge for item pods and checked pods', () => {
    expect(fillsOf(undefined)).not.toContain(palette.power);
    expect(fillsOf('free', 'collected')).not.toContain(palette.free);
  });
});
