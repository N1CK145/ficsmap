import { useTranslation } from 'react-i18next';
import type { Item } from '../../../shared/dataset.js';
import { UNITS_PER_METER } from '../../../shared/geo.js';
import type { WorldCtx } from '../../app/feature.js';
import { Panel } from '../../components/Panel.js';
import { nearestEntrance, useCaves } from './useCaves.js';

/** For an item inside a cave: says so, and how far the nearest known cave entrance is (straight line). */
export function InCave({ item, ctx }: { item: Item; ctx: WorldCtx }) {
  const { t } = useTranslation();
  const caves = useCaves(ctx.me.datasetVersion, ctx.index.ds.bounds);
  const d = caves ? nearestEntrance(item.x, item.y, caves.entrances) : null;
  return (
    <Panel title={t('caves.item.title')}>
      <p>{t('caves.item.inCave')}</p>
      {d !== null && <p className="text-muted">{t('caves.item.nearestEntrance', { distance: Math.round(d / UNITS_PER_METER) })}</p>}
    </Panel>
  );
}
