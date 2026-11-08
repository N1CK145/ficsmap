import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { WorldCtx } from '../../../app/feature.js';
import { Button } from '../../../components/Button.js';
import { CloseIcon } from '../../../components/icons.js';
import { IconButton } from '../../../components/IconButton.js';
import { WINDOW_FRAME } from '../../../components/Window.js';
import { useFactoryView } from '../view.js';
import { outsideIds, widenTo } from './height.js';
import { useMapData } from './mapData.js';
import { useFactoryMap } from './useFactoryMap.js';
import { useHeight } from './useHeight.js';

/**
 * Feedback for "On the map" (the Fabrik page, the panel's legend): a chip at the top of the map, "6 buildings marked",
 * with a 44 px button that clears the marking. Announced politely when it appears or its count changes. With a height
 * range that leaves some of them out, a second line says how many and "Anzeigen" widens the range to them.
 */
export function HighlightChip({ ctx }: { ctx: WorldCtx }) {
  const { t, i18n } = useTranslation();
  const visible = useFactoryMap(s => s.visible);
  const count = useFactoryView(s => s.highlight.length);
  const hasRange = useFactoryMap(s => s.heights[ctx.worldId] !== undefined);
  const shown = visible && count > 0;
  return (
    <div aria-live="polite" className="pointer-events-none absolute top-3 left-1/2 z-[900] -translate-x-1/2 max-[899px]:top-2">
      {shown && (
        <div className={`${WINDOW_FRAME} pointer-events-auto flex flex-col border-l-2 border-l-fg py-0 pr-0 pl-3`} data-testid="factory-highlight-chip">
          <div className="flex items-center gap-1">
            <span className="text-sm font-semibold whitespace-nowrap tabular-nums">
              {t('factoryMap.highlight.count', { count, n: new Intl.NumberFormat(i18n.language).format(count) })}
            </span>
            <IconButton size="touch" aria-label={t('factoryMap.highlight.clear')} title={t('factoryMap.highlight.clear')} onClick={() => useFactoryView.getState().clearHighlight()}>
              <CloseIcon />
            </IconButton>
          </div>
          {hasRange && <OutsideRange ctx={ctx} />}
        </div>
      )}
    </div>
  );
}

/** How many marked buildings the height range leaves out, and "Anzeigen" to widen it to them. */
function OutsideRange({ ctx }: { ctx: WorldCtx }) {
  const { t, i18n } = useTranslation();
  const ids = useFactoryView(s => s.highlight);
  const data = useMapData(ctx.worldId, ctx.me.datasetVersion, ctx.index.ds.bounds, true);
  const scene = data.scene;
  const { profile, range, shown } = useHeight(ctx.worldId, scene, { settled: !data.loading });
  const outside = useMemo(() => (scene && shown ? outsideIds(scene, shown, ids) : []), [scene, shown, ids]);
  if (!scene || !profile || !range || outside.length === 0) return null;
  const n = outside.length;
  const widen = () => useFactoryMap.getState().setHeight(ctx.worldId, widenTo(range, profile, scene, outside), scene.snapshot.meta.sessionName);
  return (
    <div className="flex items-center gap-2 border-t border-line py-1 pr-1" data-testid="factory-highlight-outside">
      <span className="max-w-72 text-xs text-muted">
        {t('factoryMap.highlight.outside', { count: n, n: new Intl.NumberFormat(i18n.language).format(n) })}
      </span>
      <Button size="sm" variant="secondary" title={t('factoryMap.highlight.showOutsideHint')} onClick={widen}>{t('factoryMap.highlight.showOutside')}</Button>
    </div>
  );
}
