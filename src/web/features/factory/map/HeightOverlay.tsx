import type { WorldCtx } from '../../../app/feature.js';
import { useIsMobile } from '../../../app/useMediaQuery.js';
import { WINDOW_FRAME } from '../../../components/Window.js';
import { HeightRail } from './HeightSlider.js';
import { useMapData } from './mapData.js';
import { useFactoryMap } from './useFactoryMap.js';
import { useHeight } from './useHeight.js';

/**
 * The height range at the map's left edge while the factory plan is on (wide screens only; on phones the panel in the
 * sheet has it): the compact vertical slider (`HeightRail`), the same range as the panel's.
 */
export function HeightOverlay({ ctx }: { ctx: WorldCtx }) {
  const visible = useFactoryMap(s => s.visible);
  const mobile = useIsMobile();
  return visible && !mobile ? <Rail ctx={ctx} /> : null;
}

function Rail({ ctx }: { ctx: WorldCtx }) {
  const data = useMapData(ctx.worldId, ctx.me.datasetVersion, ctx.index.ds.bounds, true);
  const scene = data.scene;
  const { profile, range } = useHeight(ctx.worldId, scene, { settled: !data.loading });
  if (!scene || !profile) return null;
  const session = scene.snapshot.meta.sessionName;
  return (
    <div className={`${WINDOW_FRAME} pointer-events-auto absolute top-1/2 left-3 z-[800] -translate-y-1/2 py-2`} data-testid="factory-height-overlay">
      <HeightRail profile={profile} value={range} onChange={r => useFactoryMap.getState().setHeight(ctx.worldId, r, session)} />
    </div>
  );
}
