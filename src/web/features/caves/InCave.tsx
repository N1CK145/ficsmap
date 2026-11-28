import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { Item } from '../../../shared/dataset.js';
import { UNITS_PER_METER, worldToLatLng } from '../../../shared/geo.js';
import type { WorldCtx } from '../../app/feature.js';
import { Button } from '../../components/Button.js';
import { Panel } from '../../components/Panel.js';
import { caveAt, useCaveModels, useCaveViewer } from './caveModels.js';
import { nearestEntrance, useCaves } from './useCaves.js';

/**
 * For an item inside a cave: says so, how far the nearest known cave entrance is (straight line), and opens the cave's
 * 3D view when the dataset has its model.
 */
export function InCave({ item, ctx }: { item: Item; ctx: WorldCtx }) {
  const { t } = useTranslation();
  const caves = useCaves(ctx.me.datasetVersion, ctx.index.ds.bounds);
  const models = useCaveModels(ctx.me.datasetVersion);
  const view = useCaveViewer(s => s.view);
  const d = caves ? nearestEntrance(item.x, item.y, caves.entrances) : null;
  const cave = useMemo(() => (caves ? caveAt(...worldToLatLng(item.x, item.y, ctx.index.ds.bounds), caves) : null), [caves, item, ctx.index]);
  return (
    <Panel title={t('caves.item.title')}>
      <p>{t('caves.item.inCave')}</p>
      {d !== null && <p className="text-muted">{t('caves.item.nearestEntrance', { distance: Math.round(d / UNITS_PER_METER) })}</p>}
      {cave && models?.has(cave) && (
        <Button size="sm" className="mt-2" onClick={() => view(cave)}>{t('caves.item.view3d')}</Button>
      )}
    </Panel>
  );
}
