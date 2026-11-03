import { useTranslation } from 'react-i18next';
import { typeById } from '../../../../shared/collectibleTypes.js';
import type { Item } from '../../../../shared/dataset.js';
import { Panel } from '../../../components/Panel.js';

/** Power slugs: how many power shards one yields (spec §10.2), from the dataset. */
export function PowerSlug({ item }: { item: Item }) {
  const { t } = useTranslation();
  const count = item.extra?.shards ?? typeById(item.type).powerShards ?? 0;
  return <Panel title={t('item.powerSlug.title')}><p>{t('item.powerSlug.yields', { count })}</p></Panel>;
}
