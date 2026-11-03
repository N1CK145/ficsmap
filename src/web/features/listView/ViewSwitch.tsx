import { useTranslation } from 'react-i18next';
import { useUiStore } from '../../app/store.js';
import { SegmentedControl } from '../../components/SegmentedControl.js';

/** Sidebar panel: [Map | List] toggles what the main area shows. */
export function ViewSwitch() {
  const { t } = useTranslation();
  const mainView = useUiStore(s => s.mainView);
  const setMainView = useUiStore(s => s.setMainView);
  return (
    <SegmentedControl
      label={t('list.view')}
      options={[{ value: 'map', label: t('list.map') }, { value: 'list', label: t('list.list') }]}
      value={mainView}
      onChange={setMainView}
    />
  );
}
